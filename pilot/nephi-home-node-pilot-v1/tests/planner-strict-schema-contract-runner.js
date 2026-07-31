"use strict";

const assert = require("node:assert/strict");

const { plannerJsonSchema } = require("../lib/conversation-engine-v2/planner-schema");
const { validateUnderstandingContext } = require("../lib/conversation-engine-v2/understanding-validator");

function auditStrictObjects(node, path = "$") {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  const types = Array.isArray(node.type) ? node.type : [node.type];
  if (types.includes("object")) {
    assert.equal(node.additionalProperties, false, `${path}: object must set additionalProperties=false`);
    assert.ok(node.properties && typeof node.properties === "object" && !Array.isArray(node.properties), `${path}: object must declare fixed properties`);
    assert.ok(Array.isArray(node.required), `${path}: object must declare required`);
    assert.deepEqual(
      [...node.required].sort(),
      Object.keys(node.properties).sort(),
      `${path}: required must contain every properties key`
    );
  }
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === "object") auditStrictObjects(value, `${path}.${key}`);
  }
}

function minimalPlannerOutput(evidenceRef) {
  return {
    tasks: [{ candidateIndex: 0 }],
    contextRelationCandidates: [{
      candidateIndex: 0,
      kind: "new_request",
      candidateRequestCycleRefs: [],
      evidenceRefs: [evidenceRef]
    }]
  };
}

function snapshot() {
  return {
    scope: { propertyId: "strict-schema-property", channelId: "strict-schema-channel", userId: "strict-schema-user" },
    generatedAt: "2026-07-26T00:00:00.000Z",
    cycles: []
  };
}

function main() {
  const schema = plannerJsonSchema();
  auditStrictObjects(schema);

  const evidenceSchema = schema.properties.contextRelationCandidates.items.properties.evidenceRefs.items;
  assert.deepEqual(
    [...evidenceSchema.required].sort(),
    ["endOffset", "eventId", "messageRef", "quote", "startOffset"],
    "evidenceRef must always contain eventId and messageRef"
  );
  assert.deepEqual(evidenceSchema.properties.startOffset, { type: "integer", minimum: 0 });
  assert.deepEqual(evidenceSchema.properties.endOffset, { type: "integer", minimum: 0 });
  assert.deepEqual(evidenceSchema.properties.quote, { type: "string", minLength: 1, maxLength: 500 });

  const sourceEvents = [{
    eventId: "event-a",
    messageRef: "message-a",
    messageText: "Need availability"
  }];
  const eventOnlyEvidence = {
    eventId: "event-a",
    messageRef: "",
    startOffset: 5,
    endOffset: 17,
    quote: "availability"
  };
  const messageOnlyEvidence = {
    eventId: "",
    messageRef: "message-a",
    startOffset: 5,
    endOffset: 17,
    quote: "availability"
  };
  assert.ok(Object.hasOwn(eventOnlyEvidence, "eventId") && Object.hasOwn(eventOnlyEvidence, "messageRef"));
  assert.ok(Object.hasOwn(messageOnlyEvidence, "eventId") && Object.hasOwn(messageOnlyEvidence, "messageRef"));
  assert.equal(validateUnderstandingContext(minimalPlannerOutput(eventOnlyEvidence), snapshot(), { sourceEvents }).ok, true);
  assert.equal(validateUnderstandingContext(minimalPlannerOutput(messageOnlyEvidence), snapshot(), { sourceEvents }).ok, true);

  console.log("planner strict schema contract: PASS");
}

main();
