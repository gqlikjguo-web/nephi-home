"use strict";

const assert = require("node:assert/strict");
const { buildResponsePlan } = require("../lib/conversation-engine-v2/response-planner");
const { mergeComposedSections } = require("../lib/conversation-engine-v2/controlled-composer");

const taskResults = [
  { taskId: "equipment", type: "amenity", status: "answered", facts: { subject: "設備", answer: "設備資訊" } },
  { taskId: "policy", type: "policy", status: "answered", facts: { subject: "規則", answer: "規則資訊" } },
  { taskId: "price", type: "price", status: "answered", facts: { subject: "價格", answer: "價格資訊" } },
  { taskId: "capacity", type: "capacity", status: "answered", facts: { subject: "容量", answer: "容量資訊" } },
  { taskId: "stay", type: "availability", status: "answered", facts: { subject: "住宿", answer: "住宿資訊" } }
];

const plan = buildResponsePlan({
  propertyId: "property_alpha",
  taskResults,
  inputTaskIds: taskResults.map((item) => item.taskId),
  reviewActions: []
});

assert.deepEqual(
  plan.sections.map((section) => section.taskId),
  ["stay", "capacity", "price", "equipment", "policy"],
  "住宿主需求、住宿條件、價格、設備、政策必須依優先級排序"
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
assert.deepEqual(composed.factTaskIds, ["stay", "capacity", "price", "equipment", "policy"]);
assert.equal(composed.replyText, "住宿資訊。\n容量資訊。\n價格資訊。\n設備資訊。\n規則資訊。");
assert.equal(composed.replyText.includes("請問您指的是哪一項"), false);

const missing = mergeComposedSections(plan, {
  sections: [{ taskId: "stay", responseMode: "answer", text: "住宿資訊。" }]
});
assert.equal(missing.ok, false);
assert.deepEqual(missing.missingTaskIds, ["capacity", "price", "equipment", "policy"]);

const unnecessaryClarification = mergeComposedSections(plan, {
  sections: plan.sections.map((section) => ({
    taskId: section.taskId,
    responseMode: section.taskId === "stay" ? "clarification" : "answer",
    text: section.taskId === "stay" ? "請問您指的是哪一項服務？" : `${section.taskId}資訊。`
  }))
});
assert.equal(unnecessaryClarification.ok, false);
assert.ok(unnecessaryClarification.errors.includes("response_mode_mismatch"));

console.log("conversation engine v2 response composition: PASS");
