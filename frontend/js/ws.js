/* frontend/js/ws.js
   WebSocket utility module for MedVoice.
   Manages the transcription socket and forwards received chunks to the backend.
*/
let ws = null;

export function connectWebSocket(url, onTranscriptReceived, onError) {
  closeWebSocket();

  ws = new WebSocket(url);

  ws.onopen = () => console.log("WebSocket connected");

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.text) {
        onTranscriptReceived(data.text);
      }
    } catch (error) {
      console.error("Bad message from server:", event.data);
    }
  };

  ws.onerror = () => {
    onError?.("WebSocket error — is the backend running on localhost:8000?");
  };

  ws.onclose = () => {
    console.log("WebSocket closed");
    ws = null;
  };
}

export function sendChunkToServer(blob) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    blob.arrayBuffer().then((buffer) => ws.send(buffer));
    return;
  }

  console.warn("WebSocket is not open; cannot send audio chunk.");
}

export function closeWebSocket() {
  if (ws) {
    ws.close();
    ws = null;
  }
}
