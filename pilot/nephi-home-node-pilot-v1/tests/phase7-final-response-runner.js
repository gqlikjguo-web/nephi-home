"use strict";

const assert = require("node:assert/strict");
const {
  buildFinalResponse
} = require("../lib/conversation-engine-v2/final-response-renderer");

const SAFE_HANDOFF_TEXT = "這次有部分內容無法安全確認，我會請業者協助；您剛才的問題已經記錄。";

const answeredSection = {
  taskId: "parking",
  type: "amenity",
  status: "answered",
  responseMode: "answer",
  facts: { subject: "停車", answer: "民宿旁空地可停車。" },
  allowedFacts: ["停車", "民宿旁空地可停車。"]
};
const clarificationSection = {
  taskId: "availability",
  type: "availability",
  status: "needs_clarification",
  responseMode: "clarification",
  facts: {},
  missingInputs: ["stay.checkIn"],
  allowedFacts: []
};
const handoffSection = {
  taskId: "pet-policy",
  type: "policy",
  status: "needs_human",
  responseMode: "handoff",
  facts: { subject: "寵物規則" },
  allowedFacts: ["寵物規則"],
  needsReview: true
};

function plan(sections) {
  return { schemaVersion: 1, sections, maxLength: 1200 };
}

function decision(action, extra = {}) {
  return {
    action,
    reasonCode: `${action}_test`,
    taskIds: [],
    missingFields: [],
    reviewRequired: action === "handoff",
    executionSummary: {},
    ...extra
  };
}

const cases = [];

const reply = buildFinalResponse({
  finalDecision: decision("reply"),
  responsePlan: plan([answeredSection]),
  validatedReplyText: "民宿旁空地可停車。",
  claimValidation: { ok: true, errors: [] }
});
assert.deepEqual(reply, {
  action: "reply",
  replyText: "民宿旁空地可停車。",
  shouldReply: true
});
cases.push(reply);

const clarification = buildFinalResponse({
  finalDecision: decision("clarification", { missingFields: ["stay.checkIn"] }),
  responsePlan: plan([clarificationSection]),
  validatedReplyText: "請告訴我日期、人數與房型。",
  claimValidation: { ok: true, errors: [] }
});
assert.deepEqual(clarification, {
  action: "clarification",
  replyText: "請提供入住日期。",
  shouldReply: true
});
assert.equal(clarification.replyText.includes("人數"), false);
assert.equal(clarification.replyText.includes("房型"), false);
cases.push(clarification);

const answeredAndClarification = buildFinalResponse({
  finalDecision: decision("clarification", { missingFields: ["stay.checkIn"] }),
  responsePlan: plan([answeredSection, clarificationSection]),
  validatedReplyText: "民宿旁空地可停車。\n請告訴我日期、人數與房型。",
  claimValidation: { ok: true, errors: [] }
});
assert.deepEqual(answeredAndClarification, {
  action: "clarification",
  replyText: "民宿旁空地可停車。\n請提供入住日期。",
  shouldReply: true
});
cases.push(answeredAndClarification);

const invalidClarification = buildFinalResponse({
  finalDecision: decision("clarification", {
    reasonCode: "invalid",
    missingFields: []
  }),
  responsePlan: plan([clarificationSection]),
  validatedReplyText: "請猜一個新的日期。",
  claimValidation: { ok: true, errors: [] }
});
assert.deepEqual(invalidClarification, {
  action: "clarification",
  replyText: "目前提供的資訊無法安全確認。",
  shouldReply: true
});
assert.equal(invalidClarification.replyText.includes("日期"), false);
cases.push(invalidClarification);

const handoff = buildFinalResponse({
  finalDecision: decision("handoff"),
  responsePlan: plan([handoffSection]),
  validatedReplyText: "寵物規則這部分需要請業者確認。",
  claimValidation: { ok: true, errors: [] }
});
assert.deepEqual(handoff, {
  action: "handoff",
  replyText: "寵物規則這部分需要請業者確認。",
  shouldReply: true
});
cases.push(handoff);

const answeredAndHandoff = buildFinalResponse({
  finalDecision: decision("handoff"),
  responsePlan: plan([answeredSection, handoffSection]),
  validatedReplyText: "民宿旁空地可停車。\n寵物規則這部分需要請業者確認。",
  claimValidation: { ok: true, errors: [] }
});
assert.deepEqual(answeredAndHandoff, {
  action: "handoff",
  replyText: "民宿旁空地可停車。\n寵物規則這部分需要請業者確認。",
  shouldReply: true
});
cases.push(answeredAndHandoff);

const rejectedCandidate = "已通知業者，並保證可以入住。";
const claimRejection = buildFinalResponse({
  finalDecision: decision("handoff", { reasonCode: "claim_validation_failed" }),
  responsePlan: plan([answeredSection]),
  validatedReplyText: rejectedCandidate,
  claimValidation: { ok: false, errors: ["forbidden_claim"] }
});
assert.deepEqual(claimRejection, {
  action: "handoff",
  replyText: SAFE_HANDOFF_TEXT,
  shouldReply: true
});
assert.equal(claimRejection.replyText.includes(rejectedCandidate), false);
assert.equal(claimRejection.replyText.includes("已通知業者"), false);
cases.push(claimRejection);

const noReply = buildFinalResponse({
  finalDecision: decision("no_reply"),
  responsePlan: plan([]),
  validatedReplyText: "不得送出",
  claimValidation: { ok: true, errors: [] }
});
assert.deepEqual(noReply, {
  action: "no_reply",
  replyText: "",
  shouldReply: false
});
cases.push(noReply);

const composerException = buildFinalResponse({
  finalDecision: decision("handoff", { reasonCode: "claim_validation_failed" }),
  responsePlan: plan([answeredSection]),
  validatedReplyText: "",
  claimValidation: { ok: false, errors: ["composer_exception"] }
});
assert.deepEqual(composerException, {
  action: "handoff",
  replyText: SAFE_HANDOFF_TEXT,
  shouldReply: true
});
cases.push(composerException);

const rejectedClaims = ["一定有房", "已完成訂房"];
const rejectedSection = {
  taskId: "unsafe-availability",
  type: "availability",
  status: "answered",
  responseMode: "answer",
  facts: { subject: "訂房", answer: rejectedClaims.join("，") },
  allowedFacts: [...rejectedClaims]
};
for (const action of ["reply", "clarification", "handoff"]) {
  const rejectedOutput = buildFinalResponse({
    finalDecision: decision(action, {
      reasonCode: "claim_validation_failed",
      missingFields: action === "clarification" ? ["stay.checkIn"] : []
    }),
    responsePlan: plan([rejectedSection]),
    validatedReplyText: rejectedClaims.join("，"),
    claimValidation: { ok: false, errors: ["forbidden_claim"] }
  });
  for (const rejectedClaim of rejectedClaims) {
    assert.equal(
      rejectedOutput.replyText.includes(rejectedClaim),
      false,
      `${action} must never restore a Claim Validator rejected string`
    );
  }
}

for (const output of cases) {
  assert.ok(["reply", "clarification", "handoff", "no_reply"].includes(output.action));
}
assert.deepEqual(
  cases.map((output) => output.action),
  ["reply", "clarification", "clarification", "clarification", "handoff", "handoff", "handoff", "no_reply", "handoff"],
  "final response action must always remain the FinalDecision action"
);

console.log("phase7 final response: PASS (9 scenarios + action consistency)");
