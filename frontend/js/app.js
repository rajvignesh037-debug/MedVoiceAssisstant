/* frontend/js/app.js
   Entry point for MedVoice frontend behavior.
   Wires UI controls, handles recording and analysis actions,
   and preserves the existing application behavior.
*/
import { elements, setStatus, getTranscriptText, clearTranscript, renderSummary, clearSummary } from "./ui.js";
import { startMic, stopMic, onRecordingAvailable, getRecordedBlobs, clearRecordingHistory, hasRecordedAudio } from "./audio.js";

const WS_PROTOCOL = window.location.protocol === "https:" ? "wss:" : "ws:";
const WS_URL = `${WS_PROTOCOL}//${window.location.host}/ws/transcribe`;
const ANALYZE_URL = `${window.location.origin}/api/analyze`;

onRecordingAvailable(() => {
  elements.saveBtn.disabled = !hasRecordedAudio();
});

elements.startBtn.addEventListener("click", () => {
  elements.startBtn.disabled = true;
  elements.stopBtn.disabled = false;
  startMic(WS_URL);
});

elements.stopBtn.addEventListener("click", () => {
  stopMic();
  elements.startBtn.disabled = false;
  elements.stopBtn.disabled = true;
  setStatus("Stopped. Click Start Mic to resume, or Process Transcript with AI when ready.");
});

elements.clearBtn.addEventListener("click", () => {
  clearTranscript();
  clearRecordingHistory();
  elements.saveBtn.disabled = true;
  setStatus("Ready — click Start Mic and speak naturally. VAD will auto-chunk your speech.");
});

elements.saveBtn.addEventListener("click", saveRecording);
elements.processBtn.addEventListener("click", processTranscript);
elements.summaryClearBtn.addEventListener("click", clearSummary);

function saveRecording() {
  const recordedBlobs = getRecordedBlobs();
  if (recordedBlobs.length === 0) {
    return;
  }

  const fullBlob = new Blob(recordedBlobs, { type: "audio/webm" });
  const url = URL.createObjectURL(fullBlob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `recording-${Date.now()}.webm`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

async function processTranscript() {
  const transcript = getTranscriptText();
  if (!transcript) {
    return;
  }

  elements.processBtn.disabled = true;
  const originalLabel = elements.processBtn.textContent;
  elements.processBtn.textContent = "⏳ Analyzing...";

  try {
    const response = await fetch(ANALYZE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript }),
    });

    const data = await response.json();

    if (data.error) {
      setStatus("AI analysis error: " + data.error);
      return;
    }

    renderSummary(data);
    setStatus("Summary generated.");
  } catch (error) {
    setStatus("Could not reach the backend at " + ANALYZE_URL + ". Is it running?");
  } finally {
    elements.processBtn.disabled = false;
    elements.processBtn.textContent = originalLabel;
  }
}
