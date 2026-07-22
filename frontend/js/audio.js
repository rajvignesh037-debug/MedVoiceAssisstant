/* frontend/js/audio.js
   Audio capture and voice activity detection module for MedVoice.
   This module splits microphone input into chunks, records them,
   and sends finalized chunks to the backend via WebSocket.
*/
import { setStatus, appendTranscript } from "./ui.js";
import { connectWebSocket, sendChunkToServer, closeWebSocket } from "./ws.js";

let mediaStream = null;
let mediaRecorder = null;
let audioContext = null;
let analyser = null;
let vadRafId = null;
let currentChunkParts = [];
let allRecordedBlobs = [];
let isSpeaking = false;
let silenceStartedAt = null;
let chunkStartedAt = null;
let recordingAvailableCallback = null;

const SILENCE_THRESHOLD = 0.02;
const SILENCE_DURATION_MS = 700;
const MIN_CHUNK_MS = 400;

export function onRecordingAvailable(callback) {
  recordingAvailableCallback = callback;
}

export function hasRecordedAudio() {
  return allRecordedBlobs.length > 0;
}

export function getRecordedBlobs() {
  return [...allRecordedBlobs];
}

export function clearRecordingHistory() {
  allRecordedBlobs = [];
}

export async function startMic(wsUrl) {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    setStatus("Could not access microphone: " + error.message);
    return;
  }

  connectWebSocket(wsUrl, handleServerTranscript, handleWebSocketError);
  setStatus("Listening — speak naturally. Pauses will auto-chunk your speech.");

  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioContext.createMediaStreamSource(mediaStream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  startNewRecorderSegment();
  runVadLoop();
}

function handleServerTranscript(text) {
  appendTranscript(text);
  setStatus("Listening — speak naturally. Pauses will auto-chunk your speech.");
}

function handleWebSocketError(message) {
  setStatus(message);
}

function startNewRecorderSegment() {
  currentChunkParts = [];
  chunkStartedAt = Date.now();
  mediaRecorder = new MediaRecorder(mediaStream, { mimeType: "audio/webm;codecs=opus" });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      currentChunkParts.push(event.data);
    }
  };

  mediaRecorder.start();
}

function runVadLoop() {
  const buffer = new Uint8Array(analyser.fftSize);

  function tick() {
    analyser.getByteTimeDomainData(buffer);

    let sumSquares = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const normalized = (buffer[i] - 128) / 128;
      sumSquares += normalized * normalized;
    }

    const rms = Math.sqrt(sumSquares / buffer.length);

    if (rms > SILENCE_THRESHOLD) {
      isSpeaking = true;
      silenceStartedAt = null;
    } else if (isSpeaking) {
      if (silenceStartedAt === null) {
        silenceStartedAt = Date.now();
      }

      const silenceElapsed = Date.now() - silenceStartedAt;
      const chunkElapsed = Date.now() - chunkStartedAt;

      if (silenceElapsed >= SILENCE_DURATION_MS && chunkElapsed >= MIN_CHUNK_MS) {
        finalizeChunk();
        isSpeaking = false;
        silenceStartedAt = null;
      }
    }

    vadRafId = requestAnimationFrame(tick);
  }

  tick();
}

function finalizeChunk() {
  if (!mediaRecorder || mediaRecorder.state !== "recording") {
    return;
  }

  mediaRecorder.onstop = () => {
    const blob = new Blob(currentChunkParts, { type: "audio/webm" });

    if (blob.size > 0) {
      allRecordedBlobs.push(blob);
      sendChunkToServer(blob);
      recordingAvailableCallback?.();
    }

    if (mediaStream && mediaStream.active) {
      startNewRecorderSegment();
    }
  };

  mediaRecorder.stop();
}

export function stopMic() {
  if (vadRafId) {
    cancelAnimationFrame(vadRafId);
    vadRafId = null;
  }

  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.onstop = () => {
      const blob = new Blob(currentChunkParts, { type: "audio/webm" });
      if (blob.size > 0) {
        allRecordedBlobs.push(blob);
        sendChunkToServer(blob);
        recordingAvailableCallback?.();
      }
    };
    mediaRecorder.stop();
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  closeWebSocket();

  isSpeaking = false;
  silenceStartedAt = null;
  chunkStartedAt = null;
}
