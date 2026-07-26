"""
MedVoice backend
- WebSocket endpoint: receives short audio chunks (already VAD-segmented on the
  client), transcribes each via the OpenAI Whisper cloud API, streams text back.
- REST endpoint: takes the full transcript and asks Claude to extract a
  structured clinical summary (patient info, complaints, symptoms, impression).

Run with:  uvicorn main:app --reload --port 8000
"""

import json
import os
import tempfile
from datetime import datetime
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import (
    create_access_token,
    decode_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from database import PatientRecord, User, get_db, init_db

load_dotenv()

# ---------------------------------------------------------------------------
# Whisper (cloud, via OpenAI's API — no local model, no ffmpeg dependency)
# ---------------------------------------------------------------------------
from openai import OpenAI

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "whisper-1")  # OpenAI's hosted Whisper model

openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
if openai_client is None:
    print("WARNING: OPENAI_API_KEY not set — transcription will fail until it's added to .env")

# ---------------------------------------------------------------------------
# GPT (same OpenAI client, used here for structured clinical extraction)
# ---------------------------------------------------------------------------
GPT_MODEL = os.getenv("GPT_MODEL", "gpt-4o-mini")  # good balance of quality/cost for extraction

EXTRACTION_SYSTEM_PROMPT = """You are a clinical scribe assistant. You will be given a raw \
transcript of a doctor-patient conversation (possibly messy, informal, with filler words). \
Extract structured information and respond with ONLY a valid JSON object, no markdown fences, \
no commentary, matching exactly this shape:

{
  "patient_name": string | null,
  "age": string | null,
  "gender": string | null,
  "clinical_summary": string,        // 2-4 sentence plain-language summary of the encounter
  "chief_complaints": string[],      // short phrases, e.g. "Fever for 3 days"
  "symptoms": string[],              // short phrases, e.g. "Dry cough", "Fatigue"
  "clinical_impression": string | null  // likely diagnosis/impression if inferable, else null
}

Rules:
- Only include information actually present or clearly implied in the transcript. Never invent details.
- If a field cannot be determined, use null (for strings) or an empty array (for lists).
- Keep clinical_summary factual and concise, written the way a clinician would note it in a chart.
- This is a documentation aid, not a diagnosis. Do not overstate certainty in clinical_impression.
"""


class AnalyzeRequest(BaseModel):
    transcript: str


class RegisterRequest(BaseModel):
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class RecordSummary(BaseModel):
    id: int
    patient_name: Optional[str]
    age: Optional[str]
    gender: Optional[str]
    clinical_impression: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class RecordDetail(BaseModel):
    id: int
    patient_name: Optional[str]
    age: Optional[str]
    gender: Optional[str]
    clinical_summary: Optional[str]
    chief_complaints: Optional[List[str]]
    symptoms: Optional[List[str]]
    clinical_impression: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


app = FastAPI(title="MedVoice API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this before deploying beyond localhost
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "whisper_model": WHISPER_MODEL,
        "gpt_model": GPT_MODEL,
        "openai_configured": openai_client is not None,
    }


@app.post("/api/auth/register", response_model=TokenResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == req.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="An account with this email already exists.")

    user = User(email=req.email, hashed_password=hash_password(req.password))
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.email)
    return TokenResponse(access_token=token)


@app.post("/api/auth/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")

    token = create_access_token(user.email)
    return TokenResponse(access_token=token)


@app.websocket("/ws/transcribe")
async def transcribe_ws(websocket: WebSocket, token: str = ""):
    """
    Client sends one binary WebM/Opus audio blob per speech chunk (already
    VAD-segmented client-side). We transcribe each chunk independently and
    return {"chunk_index": n, "text": "..."} as JSON.

    Auth: browsers can't send custom headers during the WebSocket handshake,
    so the token is passed as a query param instead:
      ws://.../ws/transcribe?token=<jwt>
    """
    # Validate the token BEFORE accepting the connection
    try:
        decode_access_token(token)
    except HTTPException:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()

    if openai_client is None:
        await websocket.send_json({"error": "OPENAI_API_KEY is not set on the server."})
        await websocket.close()
        return

    chunk_index = 0
    try:
        while True:
            data = await websocket.receive_bytes()

            # OpenAI's transcription endpoint wants a file-like object with a filename
            with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
                tmp.write(data)
                tmp_path = tmp.name

            try:
                with open(tmp_path, "rb") as audio_file:
                    result = openai_client.audio.transcriptions.create(
                        model=WHISPER_MODEL,
                        file=audio_file,
                        language="en",
                    )
                text = (result.text or "").strip()
            except Exception as e:
                text = ""
                await websocket.send_json({"chunk_index": chunk_index, "error": str(e)})
            finally:
                os.unlink(tmp_path)

            if text:
                await websocket.send_json({"chunk_index": chunk_index, "text": text})
                chunk_index += 1

    except WebSocketDisconnect:
        pass


@app.post("/api/analyze", response_model=RecordDetail)
def analyze(
    req: AnalyzeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if openai_client is None:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not set on the server.")

    if not req.transcript.strip():
        raise HTTPException(status_code=400, detail="Transcript is empty.")

    completion = openai_client.chat.completions.create(
        model=GPT_MODEL,
        messages=[
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": req.transcript},
        ],
        response_format={"type": "json_object"},
    )

    raw_text = completion.choices[0].message.content.strip()

    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="Could not parse model output as JSON.")

    record = PatientRecord(
        user_id=current_user.id,
        patient_name=parsed.get("patient_name"),
        age=parsed.get("age"),
        gender=parsed.get("gender"),
        clinical_summary=parsed.get("clinical_summary"),
        chief_complaints=parsed.get("chief_complaints") or [],
        symptoms=parsed.get("symptoms") or [],
        clinical_impression=parsed.get("clinical_impression"),
        raw_transcript=req.transcript,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return record


@app.get("/api/records", response_model=List[RecordSummary])
def list_records(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    records = (
        db.query(PatientRecord)
        .filter(PatientRecord.user_id == current_user.id)
        .order_by(PatientRecord.created_at.desc())
        .all()
    )
    return records


@app.get("/api/records/{record_id}", response_model=RecordDetail)
def get_record(
    record_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = (
        db.query(PatientRecord)
        .filter(PatientRecord.id == record_id, PatientRecord.user_id == current_user.id)
        .first()
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Record not found.")
    return record


@app.delete("/api/records/{record_id}")
def delete_record(
    record_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    record = (
        db.query(PatientRecord)
        .filter(PatientRecord.id == record_id, PatientRecord.user_id == current_user.id)
        .first()
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Record not found.")

    db.delete(record)
    db.commit()
    return {"status": "deleted", "id": record_id}


# ---------------------------------------------------------------------------
# Serve the frontend at http://localhost:8000/
# Mounted LAST so it never shadows the /api/... and /ws/... routes above.
# ---------------------------------------------------------------------------
app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")