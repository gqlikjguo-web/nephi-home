"use strict";

const INTERNAL = /(?:review queue|resolver|conversation state|內部備註|Bearer\s+|sk-[A-Za-z0-9_-]+)/i;
const UNAUTHORIZED_PROMISE = /(?:已(?:經)?(?:替|幫)你保留|已完成訂房|一定(?:有房|可以提早入住|可以延後退房|退款)|免費加人|可以折扣|業者已同意|真人已看過|已通知業者)/u;
function validateClaims(reply, plan, claimedTaskIds) {
  const text = String(reply || "");
  const errors = [];
  if (!text.trim()) errors.push("empty_reply");
  if (text.length > (plan.maxLength || 1200)) errors.push("length");
  if (INTERNAL.test(text)) errors.push("internal_content");
  if (UNAUTHORIZED_PROMISE.test(text)) errors.push("forbidden_claim");
  for (const claim of plan.forbiddenClaims || []) if (text.includes(claim)) errors.push("forbidden_claim");
  if (claimedTaskIds) {
    const available = new Set((plan.sections || []).map((section) => section.taskId));
    if (!Array.isArray(claimedTaskIds) || claimedTaskIds.some((id) => !available.has(id))) errors.push("unknown_fact_reference");
  }
  return { ok: errors.length === 0, errors };
}

module.exports = { validateClaims };
