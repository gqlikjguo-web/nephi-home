"use strict";
// STRUCTURED_CONTRACT_TEST / FAKE_INTEGRATION. No real provider calls.
// Detect lost constraints/descriptions, shared definitions crossing property scope,
// and ineffective wire compaction while holding all upstream output fixed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const file = path.join(__dirname, "new-core-openai-adapter-contract-runner.js");
const fixture = new Module(file, module);
fixture.filename = file;
fixture.paths = Module._nodeModulePaths(__dirname);
fixture._compile(fs.readFileSync(file, "utf8").split("async function main()")[0]
  + "\nmodule.exports={c01,providerOutput,successfulResponse,options};", file);
const f = fixture.exports;
const { callOpenAIUnderstandingV1, openAiUnderstandingV1ProviderSchema } = require("../lib/providers/openai-understanding-v1");

function expand(schema) {
  const used = new Set();
  function visit(value, ancestors = new Set()) {
    if (Array.isArray(value)) return value.map(item => visit(item, ancestors));
    if (!value || typeof value !== "object") return value;
    if (Object.hasOwn(value, "$ref")) {
      assert.deepEqual(Object.keys(value), ["$ref"], "no sibling constraints may be hidden by a reference");
      assert.ok(value.$ref.startsWith("#/$defs/"));
      const name = value.$ref.slice(8);
      assert.ok(Object.hasOwn(schema.$defs, name), "all references resolve in this request");
      assert.equal(ancestors.has(name), false, "sharing does not add recursion");
      used.add(name);
      return visit(schema.$defs[name], new Set([...ancestors, name]));
    }
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$defs")
      .map(([key, item]) => [key, visit(item, ancestors)]));
  }
  const result = visit(schema);
  assert.deepEqual([...used].sort(), Object.keys(schema.$defs).sort(), "no unused definitions");
  return result;
}

async function check(input, correction = false) {
  const originalInput = JSON.stringify(input);
  const baselineSchema = JSON.stringify(openAiUnderstandingV1ProviderSchema(input));
  const requests = [];
  const result = await callOpenAIUnderstandingV1(input, f.options(async (_url, request) => {
    const body = JSON.parse(request.body);
    requests.push(body);
    const output = f.providerOutput();
    output.understandingOutput.turnId = input.turnId;
    if (correction && requests.length === 1) output.understandingOutput.units[0].confidenceBand = "invalid";
    return f.successfulResponse(output);
  }));
  assert.equal(requests.length, correction ? 2 : 1);
  for (const body of requests) {
    const wire = body.text.format.schema;
    assert.ok(wire.$defs, "repeated temporal/slot schemas must be shared on the actual wire request");
    assert.equal(JSON.stringify(expand(wire)), baselineSchema,
      "expanded schema preserves every constraint, description, enum, required field and property order");
    assert.ok(Buffer.byteLength(JSON.stringify(wire)) < Buffer.byteLength(baselineSchema) * 0.6,
      "wire schema must remove substantial repeated bytes without deleting information");
    assert.equal(body.text.format.strict, true);
  }
  if (correction) {
    assert.deepEqual(requests[0].text, requests[1].text, "correction retains the same exact wire schema");
    assert.deepEqual(requests[0].input, requests[1].input.slice(0, 2));
  }
  assert.equal(JSON.stringify(input), originalInput);
  assert.equal(JSON.stringify(openAiUnderstandingV1ProviderSchema(input)), baselineSchema,
    "the formal inline schema builder remains unchanged");
  const expected = f.providerOutput();
  expected.understandingOutput.turnId = input.turnId;
  assert.deepEqual(result.understandingOutput, expected.understandingOutput);
  assert.deepEqual(result.contextLinkCandidates, expected.contextLinkCandidates);
  return requests[0].text.format.schema;
}

(async () => {
  const normal = await check(f.c01());
  await check(f.c01(), true);
  await check(f.c01({ recentConversation: [] }));
  const second = f.c01({
    turnId: "turn-property-b",
    verifiedPropertyBinding: { propertyId: "property-b", channel: "line-b" },
    verifiedConversationScope: { channel: "line-b", userId: "guest-b" },
    recentConversation: [],
    stateV3Snapshot: { scope: { propertyId: "property-b", channel: "line-b", userId: "guest-b" }, referenceableCycles: [] },
    publicCatalog: { propertyId: "property-b", timezone: "Asia/Taipei",
      capabilityCatalog: ["availability", "property_fact"],
      publicSubjectCatalog: [
        { propertyId: "property-b", kind: "property", catalogIdentity: "property-b", publicName: "B" },
        { propertyId: "property-b", kind: "room", catalogIdentity: "room-b", publicName: "Room B" },
        { propertyId: "property-b", kind: "amenity", catalogIdentity: "amenity-b", publicName: "Amenity B" }
      ] }
  });
  const scoped = await check(second);
  assert.equal(JSON.stringify(scoped).includes("room-a"), false);
  assert.equal(JSON.stringify(normal).includes("room-b"), false);
  const originalBytes = Buffer.byteLength(JSON.stringify(openAiUnderstandingV1ProviderSchema(f.c01())));
  console.log(JSON.stringify({ status: "PASS", classification: "STRUCTURED_CONTRACT_TEST_AND_FAKE_INTEGRATION",
    originalBytes, wireBytes: Buffer.byteLength(JSON.stringify(normal)), expandedByteIdentical: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
