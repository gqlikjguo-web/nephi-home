"use strict";

const { detailLabel } = require("./detail-intent");

function money(value) { return new Intl.NumberFormat("zh-TW").format(value); }
function composeSection(section) {
  const facts = section.facts || {};
  if (facts.customReply) {
    const officialFacts = { ...facts };
    delete officialFacts.customReply;
    delete officialFacts.customReplyRuleId;
    delete officialFacts.customReplySource;
    const official = composeSection({ ...section, facts: officialFacts });
    return [facts.customReply, official].filter(Boolean).join("\n");
  }
  if (facts.detailNeedsConfirmation) {
    const known = facts.answer ? `${facts.answer}\n` : "";
    return `${known}${detailLabel(facts.detailIntent)}目前沒有正式資料，需由業者依當日狀況確認。`;
  }
  if (section.status === "needs_clarification") return section.question || "可以再補充一下嗎？";
  if (["needs_human", "property_data_missing", "failed"].includes(section.status)) return facts.subject ? `${facts.subject}這部分需要請業者確認。` : "這部分需要請業者確認。";
  if (facts.prices) {
    if (facts.availability === "full") return `${facts.checkIn} 入住目前已滿房。`;
    const prices = facts.prices.map((item) => item.total === null ? `${item.inventory.publicName}價格需要請業者確認。` : `${item.inventory.publicName}共 ${money(item.total)} ${item.currency === "TWD" ? "元" : item.currency}。`).join("\n");
    return facts.availability === "available"
      ? `${facts.checkIn} 入住\n目前可預訂。\n${prices}`
      : prices;
  }
  if (facts.availableInventory) return facts.availableInventory.length ? `${facts.checkIn} 入住可選：${facts.availableInventory.map((item) => item.publicName).join("、")}。` : `${facts.checkIn} 入住目前沒有符合條件的空房。`;
  if (facts.availableDates) return facts.availableDates.length ? `這段期間可查詢的日期有：${facts.availableDates.join("、")}。` : "這段期間目前沒有可售日期。";
  if (Number.isInteger(facts.maxGuests) && facts.maxGuests > 0 && facts.subject) return `${facts.subject} 最多可住 ${facts.maxGuests} 人。`;
  if (facts.amenities) return facts.amenities.length ? `目前確認的主要設備有：${facts.amenities.join("、")}。` : "設備資料需要請業者確認。";
  if (facts.locationAddress) return [`\u5730\u5740\uff1a${facts.locationAddress}`, facts.locationMapUrl ? `Google \u5730\u5716\uff1a${facts.locationMapUrl}` : ""].filter(Boolean).join("\n");
  if (facts.locationMapUrl) return `Google 地圖：${facts.locationMapUrl}\n請直接開啟地圖查看路線與周邊位置。`;
  if (facts.status === "confirmed_yes") return facts.answer || `${facts.subject}有提供。`;
  if (facts.status === "confirmed_no") return `${facts.subject}目前沒有提供。`;
  if (facts.answer) return facts.answer;
  return "這部分需要請業者確認。";
}
function composeControlledReply(plan) { const reply = plan.sections.map(composeSection).filter(Boolean).join("\n"); return (reply || "這個問題需要請業者確認，我會為您轉交。").slice(0, plan.maxLength || 1200); }

function normalizedMeaning(value) { return String(value || "").normalize("NFKC").toLocaleLowerCase("zh-TW").replace(/[^\p{L}\p{N}]+/gu, ""); }
function meaningfulCharacterCount(value) { return (String(value || "").match(/[\p{L}\p{N}]/gu) || []).length; }
function validateComposedSection(section, text) {
  const value = String(text || "").trim();
  const errors = [];
  if (!value) errors.push("empty_task_reply");
  if (meaningfulCharacterCount(value) < 3) errors.push("meaningless_section_text");
  if (section.responseMode === "handoff") errors.push("handoff_deterministic_boundary");
  if (section.responseMode !== "handoff" && value) {
    const expected = composeSection(section);
    const proposedMeaning = normalizedMeaning(value);
    const expectedMeaning = normalizedMeaning(expected);
    const requiredFacts = (section.allowedFacts || []).map(normalizedMeaning).filter((fact) => fact && expectedMeaning.includes(fact));
    if (requiredFacts.some((fact) => !proposedMeaning.includes(fact))) errors.push("allowed_fact_missing");
    if (proposedMeaning !== expectedMeaning) errors.push(section.responseMode === "clarification" ? "response_mode_semantic_mismatch" : "ungrounded_section_text");
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

function mergeComposedSections(plan, composed) {
  const expected = (plan.sections || []).map((section) => section.taskId);
  const items = composed && Array.isArray(composed.sections) ? composed.sections : [];
  const occurrences = new Map();
  const errors = [];
  for (const item of items) {
    if (!item || !expected.includes(item.taskId)) { errors.push("unexpected_task"); continue; }
    if (occurrences.has(item.taskId)) { errors.push("duplicate_task"); continue; }
    occurrences.set(item.taskId, item);
  }
  const missingTaskIds = expected.filter((taskId) => !occurrences.has(taskId));
  if (missingTaskIds.length) errors.push("incomplete_task_coverage");
  const ordered = [];
  for (const section of plan.sections || []) {
    const item = occurrences.get(section.taskId);
    if (!item) continue;
    if (item.responseMode !== section.responseMode) errors.push("response_mode_mismatch");
    const text = String(item.text || "").trim();
    errors.push(...validateComposedSection(section, text).errors);
    ordered.push({ taskId: section.taskId, responseMode: item.responseMode, text });
  }
  const factTaskIds = ordered.flatMap((item) => {
    const section = (plan.sections || []).find((candidate) => candidate.taskId === item.taskId);
    return Array.isArray(section && section.coveredTaskIds) && section.coveredTaskIds.length
      ? section.coveredTaskIds
      : [item.taskId];
  });
  return { ok: errors.length === 0, errors: [...new Set(errors)], replyText: ordered.map((item) => item.text).join("\n").slice(0, plan.maxLength || 1200), factTaskIds, sections: ordered, missingTaskIds };
}

module.exports = { composeSection, composeControlledReply, meaningfulCharacterCount, validateComposedSection, mergeComposedSections };
