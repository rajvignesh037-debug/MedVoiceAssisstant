/* frontend/js/ui.js
   DOM helpers and rendering utilities for the MedVoice application.
   This module holds transcript state, status updates, and summary rendering.
*/
const elements = {
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  clearBtn: document.getElementById("clearBtn"),
  saveBtn: document.getElementById("saveBtn"),
  processBtn: document.getElementById("processBtn"),
  summaryClearBtn: document.getElementById("summaryClearBtn"),
  transcriptBox: document.getElementById("transcriptBox"),
  statusBox: document.getElementById("statusBox"),
  wordCount: document.getElementById("wordCount"),
  chunkCount: document.getElementById("chunkCount"),
  patientName: document.getElementById("patientName"),
  patientAge: document.getElementById("patientAge"),
  patientGender: document.getElementById("patientGender"),
  clinicalSummary: document.getElementById("clinicalSummary"),
  chiefComplaints: document.getElementById("chiefComplaints"),
  symptoms: document.getElementById("symptoms"),
  clinicalImpression: document.getElementById("clinicalImpression"),
};

let fullTranscript = "";
let chunkCount = 0;

function updateCounts() {
  const words = fullTranscript.trim().split(/\s+/).filter(Boolean).length;
  elements.wordCount.textContent = `📝 Words: ${words}`;
  elements.chunkCount.textContent = `🔄 Chunks: ${chunkCount}`;
}

export function appendTranscript(text) {
  fullTranscript += fullTranscript ? ` ${text}` : text;
  elements.transcriptBox.textContent = fullTranscript;
  chunkCount += 1;
  updateCounts();
  elements.processBtn.disabled = fullTranscript.trim().length === 0;
}

export function clearTranscript() {
  fullTranscript = "";
  chunkCount = 0;
  elements.transcriptBox.textContent = "";
  updateCounts();
  elements.processBtn.disabled = true;
}

export function getTranscriptText() {
  return fullTranscript.trim();
}

export function setStatus(text) {
  elements.statusBox.textContent = text;
}

export function renderSummary(data = {}) {
  elements.patientName.textContent = data.patient_name || "—";
  elements.patientAge.textContent = data.age || "—";
  elements.patientGender.textContent = data.gender || "—";

  elements.clinicalSummary.innerHTML = data.clinical_summary
    ? data.clinical_summary
    : '<span class="placeholder">AI-generated clinical summary will appear here…</span>';

  elements.chiefComplaints.innerHTML = renderTags(data.chief_complaints, "No complaints extracted yet");
  elements.symptoms.innerHTML = renderTags(data.symptoms, "No symptoms extracted yet");

  elements.clinicalImpression.innerHTML = data.clinical_impression
    ? `<div class="summary-box">${data.clinical_impression}</div>`
    : '<div class="placeholder">No diagnosis inferred</div>';
}

export function clearSummary() {
  renderSummary({});
}

function renderTags(items, emptyText) {
  if (!items || items.length === 0) {
    return `<div class="placeholder">${emptyText}</div>`;
  }

  const tags = items.map((item) => `<span class="tag">${item}</span>`).join("");
  return `<div class="tag-list">${tags}</div>`;
}

export { elements };
