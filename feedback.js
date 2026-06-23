const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbziU2em4d3y4dAdg8hDzifd-Lk0YQczTes2I214932WAFspRvg6-mLUBb-iSaz3vi0H/exec";

const form = document.querySelector("#feedbackForm");
const thanksPanel = document.querySelector("#thanksPanel");
const submitButton = document.querySelector("#submitButton");
const submitStatus = document.querySelector("#submitStatus");
const goodOtherCheck = document.querySelector("#goodOtherCheck");
const goodOtherWrap = document.querySelector("#goodOtherWrap");
const goodOtherInput = document.querySelector("#goodOther");
const improveOtherCheck = document.querySelector("#improveOtherCheck");
const improveOtherWrap = document.querySelector("#improveOtherWrap");
const improveOtherInput = document.querySelector("#improveOther");

function valuesFor(formData, key) {
  return formData.getAll(key).filter(Boolean);
}

function getFeedbackPayload() {
  const formData = new FormData(form);
  return {
    submittedAt: new Date().toISOString(),
    rating: Number(formData.get("rating") || 0),
    good: valuesFor(formData, "good"),
    goodOther: String(formData.get("goodOther") || "").trim(),
    improve: valuesFor(formData, "improve"),
    improveOther: String(formData.get("improveOther") || "").trim(),
    returnVisit: String(formData.get("returnVisit") || ""),
    comment: String(formData.get("comment") || "").trim(),
    source: "feedback_page_v2"
  };
}

function saveLocalFeedback(payload) {
  const key = "nephi_feedback_submissions";
  const existing = JSON.parse(localStorage.getItem(key) || "[]");
  existing.push(payload);
  localStorage.setItem(key, JSON.stringify(existing));
}

async function submitToGoogleSheet(payload) {
  if (!GOOGLE_SCRIPT_URL) {
    saveLocalFeedback(payload);
    return { ok: true, localOnly: true };
  }

  await fetch(GOOGLE_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });

  return { ok: true };
}

function showThanks() {
  form.hidden = true;
  thanksPanel.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindOtherToggle(check, wrap, input) {
  check.addEventListener("change", () => {
    wrap.hidden = !check.checked;
    if (check.checked) {
      input.focus();
    } else {
      input.value = "";
    }
  });
}

bindOtherToggle(goodOtherCheck, goodOtherWrap, goodOtherInput);
bindOtherToggle(improveOtherCheck, improveOtherWrap, improveOtherInput);

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = getFeedbackPayload();
  submitButton.disabled = true;
  submitStatus.textContent = "送出中...";

  try {
    await submitToGoogleSheet(payload);
    showThanks();
  } catch (error) {
    saveLocalFeedback(payload);
    showThanks();
  }
});
