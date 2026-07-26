"use strict";

const { composeSection } = require("./controlled-composer");

const SAFE_HANDOFF_TEXT = "這次有部分內容無法安全確認，我會請業者協助；您剛才的問題已經記錄。";
const SAFE_CLARIFICATION_TEXT = "目前提供的資訊無法安全確認。";
const MISSING_FIELD_QUESTIONS = Object.freeze({
  "stay.checkIn": "請補充入住日期。",
  "stay.checkOut": "請補充退房日期。",
  "stay.nights": "請補充住宿晚數。",
  "stay.guests": "請補充入住人數。",
  "stay.guestCount": "請補充入住人數。",
  "inventory.entityId": "請補充想詢問的房型。",
  "inventory.features": "請補充需要的房間條件。",
  entity: "請補充想詢問的房型。"
});

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sectionsFor(responsePlan, responseMode) {
  return (responsePlan && Array.isArray(responsePlan.sections)
    ? responsePlan.sections
    : [])
    .filter((section) => section && section.responseMode === responseMode)
    .map(composeSection)
    .map((text) => String(text || "").trim())
    .filter(Boolean);
}

function clarificationQuestions(missingFields) {
  return unique((Array.isArray(missingFields) ? missingFields : []).map((field) => (
    MISSING_FIELD_QUESTIONS[String(field)] || "請補充尚缺的資訊。"
  )));
}

function withinLimit(parts, responsePlan) {
  return unique(parts).join("\n").slice(0, responsePlan && responsePlan.maxLength || 1200);
}

function buildFinalResponse({
  finalDecision,
  responsePlan,
  validatedReplyText,
  claimValidation
} = {}) {
  const action = finalDecision && finalDecision.action;
  if (!["reply", "clarification", "handoff", "no_reply"].includes(action)) {
    throw new TypeError("final_decision_action_required");
  }
  if (action === "no_reply") {
    return { action, replyText: "", shouldReply: false };
  }
  if (action === "reply") {
    const replyText = claimValidation && claimValidation.ok === true
      ? String(validatedReplyText || "").trim().slice(0, responsePlan && responsePlan.maxLength || 1200)
      : "";
    return { action, replyText, shouldReply: true };
  }
  const answered = sectionsFor(responsePlan, "answer");
  if (action === "clarification") {
    const questions = clarificationQuestions(finalDecision.missingFields);
    return {
      action,
      replyText: withinLimit([
        ...answered,
        ...(questions.length ? questions : [SAFE_CLARIFICATION_TEXT])
      ], responsePlan),
      shouldReply: true
    };
  }
  const handoff = sectionsFor(responsePlan, "handoff");
  return {
    action,
    replyText: withinLimit([
      ...answered,
      ...(handoff.length ? handoff : [SAFE_HANDOFF_TEXT])
    ], responsePlan),
    shouldReply: true
  };
}

module.exports = {
  SAFE_HANDOFF_TEXT,
  buildFinalResponse
};
