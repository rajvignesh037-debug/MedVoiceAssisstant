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

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

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


app = FastAPI(title="MedVoice API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this before deploying beyond localhost
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "whisper_model": WHISPER_MODEL,
        "gpt_model": GPT_MODEL,
        "openai_configured": openai_client is not None,
    }


@app.websocket("/ws/transcribe")
async def transcribe_ws(websocket: WebSocket):
    """
    Client sends one binary WebM/Opus audio blob per speech chunk (already
    VAD-segmented client-side). We transcribe each chunk independently and
    return {"chunk_index": n, "text": "..."} as JSON.
    """
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


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    if openai_client is None:
        return {
            "error": "OPENAI_API_KEY is not set on the server. Add it to backend/.env"
        }

    if not req.transcript.strip():
        return {"error": "Transcript is empty."}

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
        return {"error": "Could not parse model output as JSON.", "raw": raw_text}

    return parsed


# ---------------------------------------------------------------------------
# Serve the frontend at http://localhost:8000/
# Mounted LAST so it never shadows the /api/... and /ws/... routes above.
# ---------------------------------------------------------------------------
app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")