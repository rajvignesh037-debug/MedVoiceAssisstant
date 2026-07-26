/* frontend/js/history.js
   Handles the standalone history page: lists a user's past patient records,
   shows detail for a selected record, and supports deleting records.
   Mirrors the auth patterns used in app.js (token in localStorage, redirect
   to a "please log in" message rather than a dedicated login page).
*/

const RECORDS_URL = `${window.location.origin}/api/records`;

const noAuthScreen = document.getElementById("noAuthScreen");
const historyScreen = document.getElementById("historyScreen");
const userEmailLabel = document.getElementById("userEmailLabel");
const logoutBtn = document.getElementById("logoutBtn");
const recordsList = document.getElementById("recordsList");
const detailEmpty = document.getElementById("detailEmpty");
const detailContent = document.getElementById("detailContent");
const detailPatientName = document.getElementById("detailPatientName");
const detailAge = document.getElementById("detailAge");
const detailGender = document.getElementById("detailGender");
const detailClinicalSummary = document.getElementById("detailClinicalSummary");
const detailChiefComplaints = document.getElementById("detailChiefComplaints");
const detailSymptoms = document.getElementById("detailSymptoms");
const detailClinicalImpression = document.getElementById("detailClinicalImpression");
const deleteRecordBtn = document.getElementById("deleteRecordBtn");

let selectedRecordId = null;

function getToken() {
  return localStorage.getItem("token");
}

function decodeEmailFromToken(token) {
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return decoded.sub || "";
  } catch (error) {
    return "";
  }
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

function showNoAuth() {
  historyScreen.style.display = "none";
  noAuthScreen.style.display = "flex";
}

function showHistory(email) {
  noAuthScreen.style.display = "none";
  historyScreen.style.display = "block";
  if (email) {
    userEmailLabel.textContent = email;
  }
}

function logout() {
  localStorage.removeItem("token");
  showNoAuth();
}

logoutBtn.addEventListener("click", logout);

function renderTags(container, items, emptyText) {
  if (!items || items.length === 0) {
    container.innerHTML = `<div class="placeholder">${emptyText}</div>`;
    return;
  }
  const tags = items.map((item) => `<span class="tag">${item}</span>`).join("");
  container.innerHTML = `<div class="tag-list">${tags}</div>`;
}

function formatDate(isoString) {
  try {
    return new Date(isoString).toLocaleString();
  } catch (error) {
    return isoString;
  }
}

async function loadRecords() {
  const token = getToken();
  recordsList.innerHTML = `<div class="placeholder">Loading records…</div>`;

  try {
    const response = await fetch(RECORDS_URL, { headers: authHeaders(token) });

    if (response.status === 401) {
      logout();
      return;
    }

    const records = await response.json();

    if (!Array.isArray(records) || records.length === 0) {
      recordsList.innerHTML = `<div class="placeholder">No past records yet. Process a transcript in the app to save one here.</div>`;
      return;
    }

    recordsList.innerHTML = "";
    records.forEach((record) => {
      const item = document.createElement("div");
      item.className = "record-item";
      item.dataset.id = record.id;
      item.innerHTML = `
        <div class="record-item-main">
          <div class="record-item-name">${record.patient_name || "Unnamed patient"}</div>
          <div class="record-item-meta">
            ${record.age ? `Age ${record.age}` : ""}${record.age && record.gender ? " · " : ""}${record.gender || ""}
          </div>
          <div class="record-item-impression">${record.clinical_impression || "No impression recorded"}</div>
        </div>
        <div class="record-item-date">${formatDate(record.created_at)}</div>
      `;
      item.addEventListener("click", () => loadRecordDetail(record.id, item));
      recordsList.appendChild(item);
    });
  } catch (error) {
    recordsList.innerHTML = `<div class="placeholder">Could not reach the server. Is the backend running?</div>`;
  }
}

async function loadRecordDetail(recordId, itemEl) {
  const token = getToken();

  document.querySelectorAll(".record-item").forEach((el) => el.classList.remove("selected"));
  if (itemEl) {
    itemEl.classList.add("selected");
  }

  try {
    const response = await fetch(`${RECORDS_URL}/${recordId}`, { headers: authHeaders(token) });

    if (response.status === 401) {
      logout();
      return;
    }

    if (response.status === 404) {
      detailEmpty.textContent = "That record could not be found.";
      detailEmpty.style.display = "block";
      detailContent.style.display = "none";
      return;
    }

    const record = await response.json();
    selectedRecordId = record.id;

    detailPatientName.textContent = record.patient_name || "—";
    detailAge.textContent = record.age || "—";
    detailGender.textContent = record.gender || "—";
    detailClinicalSummary.textContent = record.clinical_summary || "No summary recorded.";
    renderTags(detailChiefComplaints, record.chief_complaints, "No complaints recorded");
    renderTags(detailSymptoms, record.symptoms, "No symptoms recorded");
    detailClinicalImpression.innerHTML = record.clinical_impression
      ? `<div class="summary-box">${record.clinical_impression}</div>`
      : '<div class="placeholder">No diagnosis inferred</div>';

    detailEmpty.style.display = "none";
    detailContent.style.display = "block";
  } catch (error) {
    detailEmpty.textContent = "Could not reach the server. Is the backend running?";
    detailEmpty.style.display = "block";
    detailContent.style.display = "none";
  }
}

deleteRecordBtn.addEventListener("click", async () => {
  if (selectedRecordId === null) {
    return;
  }

  const confirmed = window.confirm("Delete this record? This cannot be undone.");
  if (!confirmed) {
    return;
  }

  const token = getToken();

  try {
    const response = await fetch(`${RECORDS_URL}/${selectedRecordId}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });

    if (response.status === 401) {
      logout();
      return;
    }

    if (!response.ok) {
      window.alert("Could not delete the record.");
      return;
    }

    selectedRecordId = null;
    detailEmpty.textContent = "Select a record from the list to see its details.";
    detailEmpty.style.display = "block";
    detailContent.style.display = "none";
    loadRecords();
  } catch (error) {
    window.alert("Could not reach the server. Is the backend running?");
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
const token = getToken();
if (!token) {
  showNoAuth();
} else {
  showHistory(decodeEmailFromToken(token));
  loadRecords();
}