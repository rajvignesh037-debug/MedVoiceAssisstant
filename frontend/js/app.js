/* frontend/js/app.js
   Entry point for MedVoice frontend behavior.
   Wires UI controls, handles recording and analysis actions,
   and preserves the existing application behavior.

   Auth additions: token-gated screen switching, login/signup/logout
   handlers, and Authorization headers on the /api/analyze call.
*/
import { elements, setStatus, getTranscriptText, clearTranscript, renderSummary, clearSummary } from "./ui.js";
import { startMic, stopMic, onRecordingAvailable, getRecordedBlobs, clearRecordingHistory, hasRecordedAudio } from "./audio.js";

const WS_PROTOCOL = window.location.protocol === "https:" ? "wss:" : "ws:";
const ANALYZE_URL = `${window.location.origin}/api/analyze`;
const LOGIN_URL = `${window.location.origin}/api/auth/login`;
const REGISTER_URL = `${window.location.origin}/api/auth/register`;

// ---------------------------------------------------------------------------
// Auth screen elements (not in ui.js's elements map — that module is scoped
// to the app screen's own controls, so we grab these directly here)
// ---------------------------------------------------------------------------
const authScreen = document.getElementById("authScreen");
const appScreen = document.getElementById("appScreen");
const loginTabBtn = document.getElementById("loginTabBtn");
const signupTabBtn = document.getElementById("signupTabBtn");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const loginError = document.getElementById("loginError");
const signupEmail = document.getElementById("signupEmail");
const signupPassword = document.getElementById("signupPassword");
const signupError = document.getElementById("signupError");
const userEmailLabel = document.getElementById("userEmailLabel");
const logoutBtn = document.getElementById("logoutBtn");

// ---------------------------------------------------------------------------
// Screen switching
// ---------------------------------------------------------------------------
function showAppScreen(email) {
  authScreen.style.display = "none";
  appScreen.style.display = "block";
  if (email) {
    userEmailLabel.textContent = email;
  }
}

function showAuthScreen() {
  appScreen.style.display = "none";
  authScreen.style.display = "flex";
}

function getToken() {
  return localStorage.getItem("token");
}

function decodeEmailFromToken(token) {
  // JWT payload is base64url-encoded JSON in the middle segment.
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return decoded.sub || "";
  } catch (error) {
    return "";
  }
}

function initAuthState() {
  const token = getToken();
  if (token) {
    showAppScreen(decodeEmailFromToken(token));
  } else {
    showAuthScreen();
  }
}

function logout() {
  localStorage.removeItem("token");
  showAuthScreen();
  loginForm.reset();
  signupForm.reset();
  loginError.textContent = "";
  signupError.textContent = "";
}

initAuthState();

// ---------------------------------------------------------------------------
// Login / signup tab toggle
// ---------------------------------------------------------------------------
loginTabBtn.addEventListener("click", () => {
  loginTabBtn.classList.add("active");
  signupTabBtn.classList.remove("active");
  loginForm.style.display = "flex";
  signupForm.style.display = "none";
});

signupTabBtn.addEventListener("click", () => {
  signupTabBtn.classList.add("active");
  loginTabBtn.classList.remove("active");
  signupForm.style.display = "flex";
  loginForm.style.display = "none";
});

// ---------------------------------------------------------------------------
// Login / signup / logout handlers
// ---------------------------------------------------------------------------
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";

  try {
    const response = await fetch(LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: loginEmail.value, password: loginPassword.value }),
    });

    const data = await response.json();

    if (!response.ok) {
      loginError.textContent = data.detail || "Login failed.";
      return;
    }

    localStorage.setItem("token", data.access_token);
    showAppScreen(loginEmail.value);
    loginForm.reset();
  } catch (error) {
    loginError.textContent = "Could not reach the server. Is the backend running?";
  }
});

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  signupError.textContent = "";

  try {
    const response = await fetch(REGISTER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: signupEmail.value, password: signupPassword.value }),
    });

    const data = await response.json();

    if (!response.ok) {
      signupError.textContent = data.detail || "Sign up failed.";
      return;
    }

    localStorage.setItem("token", data.access_token);
    showAppScreen(signupEmail.value);
    signupForm.reset();
  } catch (error) {
    signupError.textContent = "Could not reach the server. Is the backend running?";
  }
});

logoutBtn.addEventListener("click", logout);

// ---------------------------------------------------------------------------
// Existing app behavior (mic, transcript, save, process)
// ---------------------------------------------------------------------------
onRecordingAvailable(() => {
  elements.saveBtn.disabled = !hasRecordedAudio();
});

elements.startBtn.addEventListener("click", () => {
  elements.startBtn.disabled = true;
  elements.stopBtn.disabled = false;
  const token = getToken();
  const wsUrl = `${WS_PROTOCOL}//${window.location.host}/ws/transcribe?token=${encodeURIComponent(token || "")}`;
  startMic(wsUrl);
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

  const token = getToken();
  if (!token) {
    setStatus("You're not logged in.");
    showAuthScreen();
    return;
  }

  elements.processBtn.disabled = true;
  const originalLabel = elements.processBtn.textContent;
  elements.processBtn.textContent = "⏳ Analyzing...";

  try {
    const response = await fetch(ANALYZE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ transcript }),
    });

    if (response.status === 401) {
      setStatus("Your session expired. Please log in again.");
      logout();
      return;
    }

    const data = await response.json();

    if (data.error) {
      setStatus("AI analysis error: " + data.error);
      return;
    }

    renderSummary(data);
    setStatus("Summary generated and saved to your history.");
  } catch (error) {
    setStatus("Could not reach the backend at " + ANALYZE_URL + ". Is it running?");
  } finally {
    elements.processBtn.disabled = false;
    elements.processBtn.textContent = originalLabel;
  }
}