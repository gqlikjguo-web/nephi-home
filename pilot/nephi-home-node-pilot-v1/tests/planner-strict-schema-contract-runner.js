"use strict";

const assert = require("node:assert/strict");

const { plannerJsonSchema } = require("../lib/conversation-engine-v2/planner-schema");
const { validateUnderstandingContext } = require("../lib/conversation-engine-v2/understanding-validator");
const { TestOnlyOpenAiConversationPlanner } = require("../lib/providers/test-only-openai-conversation-planner");

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

async function providerSchemaForCatalog(catalog) {
  let capturedSchema = null;
  const planner = new TestOnlyOpenAiConversationPlanner({
    apiKey: "test-only-key",
    model: "test-only-model",
    fetchImpl: async (_url, options) => {
      capturedSchema = JSON.parse(options.body).text.format.schema;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ output_text: "{}" })
      };
    }
  });
  await planner.requestOnce({
    currentMessage: "想詢問房型",
    currentMessages: ["想詢問房型"],
    sourceEvents: [],
    eventTimestamp: "2026-08-11T00:00:00.000Z",
    catalog,
    contextSnapshot: { scope: {}, cycles: [] }
  }, 1);
  return capturedSchema;
}

async function main() {
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

  const catalogA = {
    rooms: [{ canonicalId: "room_catalog_a", category: "room" }],
    amenities: [
      { canonicalId: "amenity_catalog_a", category: "amenity" },
      { canonicalId: "parking", category: "amenity" },
      { canonicalId: "bbq", category: "activity" }
    ],
    policies: [],
    faqs: [],
    propertyFacts: [],
    transportFacts: []
  };
  const catalogB = {
    rooms: [{ canonicalId: "room_catalog_b", category: "room" }],
    amenities: [],
    policies: [],
    faqs: [],
    propertyFacts: [],
    transportFacts: []
  };
  const schemaA = await providerSchemaForCatalog(catalogA);
  const schemaB = await providerSchemaForCatalog(catalogB);
  const candidateBranches = (schema) => schema.properties.semanticCandidates.items.anyOf
    || [schema.properties.semanticCandidates.items];
  const unionIdentitySchema = (schema, propertyName) => ({
    enum: [...new Set(candidateBranches(schema).flatMap((branch) => branch.properties[propertyName].enum || []))]
  });
  const identitySchemas = (schema) => ({
    task: schema.properties.tasks.items.properties.entity.properties.canonicalCandidate,
    semantic: unionIdentitySchema(schema, "canonicalIdentityCandidate"),
    property: unionIdentitySchema(schema, "propertyCatalogIdentity")
  });
  const identitiesA = identitySchemas(schemaA);
  const identitiesB = identitySchemas(schemaB);
  for (const [name, identitySchema] of Object.entries(identitiesA)) {
    assert.ok(Array.isArray(identitySchema.enum), `${name} identity must be provider-schema bounded`);
    assert.ok(identitySchema.enum.includes(null), `${name} identity must preserve legitimate null`);
    assert.ok(identitySchema.enum.includes("room_catalog_a"), `${name} identity must accept the supplied catalog identity`);
    assert.equal(identitySchema.enum.includes("fabricated_property_identity"), false, `${name} identity must reject fabricated identities`);
    assert.equal(identitySchema.enum.includes("room_catalog_b"), false, `${name} identity must not leak another property's catalog`);
  }
  for (const identitySchema of Object.values(identitiesB)) {
    assert.ok(identitySchema.enum.includes("room_catalog_b"));
    assert.equal(identitySchema.enum.includes("room_catalog_a"), false);
  }

  const branchesA = schemaA.properties.semanticCandidates.items.anyOf;
  assert.ok(Array.isArray(branchesA), "semantic candidates must use provider-supported anyOf capability/identity branches");
  const branchForIdentity = (identity) => branchesA.find((branch) =>
    (branch.properties.propertyCatalogIdentity.enum || []).includes(identity));
  const roomBranch = branchForIdentity("room_catalog_a");
  const amenityBranch = branchForIdentity("amenity_catalog_a");
  const parkingBranch = branchForIdentity("parking");
  const bbqBranch = branchForIdentity("bbq");
  assert.ok(roomBranch && amenityBranch && parkingBranch && bbqBranch, "every catalog identity must have an authoritative compatibility branch");
  assert.ok(roomBranch.properties.capability.enum.includes("availability"));
  assert.ok(roomBranch.properties.capability.enum.includes("price"));
  assert.equal(roomBranch.properties.capability.enum.includes("amenity"), false, "room identity must reject an incompatible amenity capability");
  assert.ok(amenityBranch.properties.capability.enum.includes("amenity"));
  assert.equal(amenityBranch.properties.capability.enum.includes("price"), false, "amenity identity must reject an incompatible price capability");
  assert.equal(parkingBranch.properties.capability.enum.includes("availability"), false, "parking identity must reject the room-inventory availability capability");
  assert.ok(parkingBranch.properties.capability.enum.includes("amenity"), "parking identity must preserve the amenity candidate type");
  assert.ok(parkingBranch.properties.capability.enum.includes("property_fact"), "parking identity must preserve the property-fact candidate type");
  assert.equal(parkingBranch.properties.capability.enum.includes("price"), false);
  assert.ok(bbqBranch.properties.capability.enum.includes("policy"), "an unrelated registry entry must remain authoritative");

  console.log("planner strict schema contract: PASS");
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
