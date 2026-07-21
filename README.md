# MedVoice

MedVoice is a real-time medical transcription and clinical summarization tool. A doctor speaks, the audio is transcribed live in the browser, and a single click generates a structured clinical summary (patient info, complaints, symptoms, and clinical impression) using an LLM.

Built as a portfolio project demonstrating a full speech-to-structured-data pipeline: browser audio capture → WebSocket streaming → cloud transcription → LLM-based extraction → UI rendering.

## Features

- **Live transcription** — client-side voice activity detection (VAD) auto-chunks speech on pauses and streams audio over a WebSocket for near real-time transcription via the OpenAI Whisper API
- **Structured clinical summaries** — the full transcript is sent to a GPT model with JSON-mode output, extracting patient name, age, gender, chief complaints, symptoms, and clinical impression
- **Single-server demo** — FastAPI serves both the API and the static frontend, so the whole app runs from one process with no separate frontend server
- **Responsive UI** — two-column layout (live transcript / AI summary) that adapts down to mobile widths

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python, FastAPI, WebSockets |
| Frontend | Plain HTML / CSS / JavaScript (no framework, no build step) |
| Speech-to-text | OpenAI Whisper API (`whisper-1`) |
| Clinical extraction | OpenAI Chat Completions (`gpt-4o-mini`), JSON mode |

## Project Structure

```
MedVoice/
├── backend/
│   ├── main.py            FastAPI app: health check, transcription WS, analysis endpoint
│   ├── requirements.txt
│   ├── .env               OPENAI_API_KEY (not committed)
│   └── .env.example       Template for required environment variables
└── frontend/
    └── index.html         Single-file UI: mic controls, live transcript, summary panel
```

## API Overview

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Returns service status and configured model names |
| `/ws/transcribe` | WebSocket | Accepts binary audio chunks, returns transcribed text per chunk |
| `/api/analyze` | POST | Accepts `{ "transcript": "..." }`, returns structured clinical summary JSON |

## Requirements

- Python 3.11+
- An OpenAI API key with access to Whisper and chat completion models

## Setup

**1. Install dependencies**

```powershell
cd backend
python -m pip install -r requirements.txt
```

**2. Configure environment variables**

Copy `.env.example` to `.env` in `backend/` and fill in your key:

```dotenv
OPENAI_API_KEY=your_openai_api_key_here
WHISPER_MODEL=whisper-1
GPT_MODEL=gpt-4o-mini
```

**3. Run the server**

```powershell
uvicorn main:app --reload --port 8000
```

**4. Open the app**

Navigate to [http://localhost:8000/](http://localhost:8000/) — the backend serves the frontend directly, so no separate dev server is needed.

## Deployment (Render)

This project is set up for a straightforward deploy to [Render](https://render.com):

1. Push the repository to GitHub (confirm `.env` is **not** included — see `.gitignore`)
2. On Render: **New → Web Service**, connect the repo
3. Configure:
   - **Root Directory:** `backend`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add the `OPENAI_API_KEY` environment variable in the Render dashboard
5. Deploy

> **Note:** on Render's free tier, the service sleeps after ~15 minutes of inactivity. The first request after idling will take 30–60 seconds to wake up.

## Known Limitations

- CORS is currently open (`allow_origins=["*"]`) — fine for a local demo or portfolio deployment, but should be restricted before handling real patient data
- This is a prototype, not a HIPAA-compliant clinical tool — no data persistence, authentication, or encryption at rest is implemented

## License

This project is provided as-is for demonstration purposes.