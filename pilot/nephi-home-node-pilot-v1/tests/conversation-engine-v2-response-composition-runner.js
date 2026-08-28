"use strict";

const assert = require("node:assert/strict");
const { buildResponsePlan } = require("../lib/conversation-engine-v2/response-planner");
const { composeSection, composeControlledReply, mergeComposedSections } = require("../lib/conversation-engine-v2/controlled-composer");

function buildApprovedPlan(options) {
  return buildResponsePlan(options);
}

const taskResults = [
  { taskId: "equipment", type: "amenity", status: "answered", facts: { subject: "設備", answer: "設備資訊" } },
  { taskId: "policy", type: "policy", status: "answered", facts: { subject: "規則", answer: "規則資訊" } },
  { taskId: "price", type: "price", status: "answered", facts: { subject: "價格", answer: "價格資訊" } },
  { taskId: "capacity", type: "capacity", status: "answered", facts: { subject: "容量", answer: "容量資訊" } },
  { taskId: "stay", type: "availability", status: "answered", facts: { subject: "住宿", answer: "住宿資訊" } }
];

const plan = buildApprovedPlan({
  propertyId: "property_alpha",
  taskResults,
  inputTaskIds: taskResults.map((item) => item.taskId),
  reviewActions: []
});

assert.deepEqual(
  plan.sections.map((section) => section.taskId),
  ["equipment", "policy", "price", "capacity", "stay"],
  "回答必須維持客人提問順序"
);
assert.ok(plan.sections.every((section) => section.responseMode === "answer"));

const composed = mergeComposedSections(plan, {
  sections: [
    { taskId: "policy", responseMode: "answer", text: "規則資訊。" },
    { taskId: "equipment", responseMode: "answer", text: "設備資訊。" },
    { taskId: "stay", responseMode: "answer", text: "住宿資訊。" },
    { taskId: "price", responseMode: "answer", text: "價格資訊。" },
    { taskId: "capacity", responseMode: "answer", text: "容量資訊。" }
  ]
});
assert.equal(composed.ok, true);
assert.deepEqual(composed.factTaskIds, ["equipment", "policy", "price", "capacity", "stay"]);
assert.equal(composed.replyText, "設備資訊。\n規則資訊。\n價格資訊。\n容量資訊。\n住宿資訊。");
assert.equal(composed.replyText.includes("請問您指的是哪一項"), false);

const missing = mergeComposedSections(plan, {
  sections: [{ taskId: "stay", responseMode: "answer", text: "住宿資訊。" }]
});
assert.equal(missing.ok, false);
assert.deepEqual(missing.missingTaskIds, ["equipment", "policy", "price", "capacity"]);

const unnecessaryClarification = mergeComposedSections(plan, {
  sections: plan.sections.map((section) => ({
    taskId: section.taskId,
    responseMode: section.taskId === "stay" ? "clarification" : "answer",
    text: section.taskId === "stay" ? "請問您指的是哪一項服務？" : `${section.taskId}資訊。`
  }))
});
assert.equal(unnecessaryClarification.ok, false);
assert.ok(unnecessaryClarification.errors.includes("response_mode_mismatch"));

const availableDatedPrice = composeSection({
  status: "answered",
  facts: {
    availability: "available",
    checkIn: "2026-09-29",
    prices: [{
      inventory: { publicName: "302四人房" },
      total: 2200,
      currency: "TWD"
    }, {
      inventory: { publicName: "401雙人房" },
      total: 1700,
      currency: "TWD"
    }]
  }
});
assert.equal(availableDatedPrice, "2026-09-29 入住\n目前可預訂。\n302四人房共 2,200 元。\n401雙人房共 1,700 元。");

const availableUsdPrice = composeSection({
  status: "answered",
  facts: {
    availability: "available",
    checkIn: "2026-09-29",
    prices: [{
      inventory: { publicName: "海外房型" },
      total: 1500,
      currency: "USD"
    }]
  }
});
assert.equal(availableUsdPrice, "2026-09-29 入住\n目前可預訂。\n海外房型共 1,500 USD。");

const unavailableDatedPrice = composeSection({
  status: "answered",
  facts: {
    availability: "full",
    checkIn: "2026-10-12",
    prices: []
  }
});
assert.equal(unavailableDatedPrice, "2026-10-12 入住目前已滿房。");

const incompleteDatedPrice = composeSection({
  status: "property_data_missing",
  facts: {
    availability: "available",
    checkIn: "2026-10-12",
    prices: [{
      inventory: { publicName: "海景套房" },
      total: null,
      currency: "TWD"
    }]
  }
});
assert.equal(incompleteDatedPrice, "這部分需要請業者確認。");

const handoffPlan = buildApprovedPlan({
  propertyId: "property_alpha",
  taskResults: [{ taskId: "handoff", type: "unknown", status: "needs_human", facts: {}, review: true }],
  inputTaskIds: ["handoff"],
  reviewActions: [{ reviewId: "review-1", created: true }]
});
const deterministicHandoff = composeControlledReply(handoffPlan);
assert.equal(deterministicHandoff, "這部分需要請業者確認。");
for (const unsafeText of [":-(", ".", ".\"", ".NET開發者需要人工協助。"]) {
  const rejected = mergeComposedSections(handoffPlan, {
    sections: [{ taskId: "handoff", responseMode: "handoff", text: unsafeText }]
  });
  assert.equal(rejected.ok, false, `${unsafeText} 不得通過 handoff composition validation`);
  assert.ok(rejected.errors.includes("handoff_deterministic_boundary"));
}

const groundedPlan = buildApprovedPlan({
  propertyId: "property_alpha",
  taskResults: [{ taskId: "parking", type: "amenity", status: "answered", facts: { subject: "停車", answer: "民宿旁空地可停車。", source: "property_catalog", propertyId: "property_alpha" } }],
  inputTaskIds: ["parking"]
});
assert.ok(groundedPlan.allowedFacts.includes("民宿旁空地可停車。"));
const grounded = mergeComposedSections(groundedPlan, {
  sections: [{ taskId: "parking", responseMode: "answer", text: "民宿旁空地可停車。" }]
});
assert.equal(grounded.ok, true, "grounded 非 handoff composition 仍須可採用");

const invented = mergeComposedSections(groundedPlan, {
  sections: [{ taskId: "parking", responseMode: "answer", text: "民宿旁空地可停車，並由 .NET 開發者即時管理。" }]
});
assert.equal(invented.ok, false);
assert.ok(invented.errors.includes("ungrounded_section_text"));

for (const taskResult of [
  { taskId: "unknown-inventory", type: "availability", status: "needs_human", reason: "inventory_entity_unknown", facts: { subject: "雙人房" }, review: true },
  { taskId: "unreliable-availability", type: "availability", status: "needs_human", reason: "availability_unreliable", facts: {}, review: true }
]) {
  const safetyPlan = buildApprovedPlan({ propertyId: "property_alpha", taskResults: [taskResult], inputTaskIds: [taskResult.taskId] });
  const safeReply = composeControlledReply(safetyPlan);
  assert.ok(safeReply.includes("需要請業者確認"));
  assert.equal(safeReply.includes("沒有空房"), false);
  const unsafeHandoff = mergeComposedSections(safetyPlan, { sections: [{ taskId: taskResult.taskId, responseMode: "handoff", text: "外部工程師已確認沒有房間。" }] });
  assert.equal(unsafeHandoff.ok, false);
  assert.ok(unsafeHandoff.errors.includes("handoff_deterministic_boundary"));
}

console.log("conversation engine v2 response composition: PASS");
