"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mutation = process.env.JUNZAN_GUARD_MUTATION || "";
const read = (file) => fs.readFileSync(path.resolve(__dirname, file), "utf8");
let server = read("../server.js");
let root = read("../lib/v2-composition-root.js");
let engine = read("../lib/conversation-engine-v2/engine.js");

if (mutation === "second_runtime") server = server.replace("/* legacy runtime", "const SECOND_TEST_LINE_ROUTE = '/api/test-line/webhook/secondary';\n  /* legacy runtime");
if (mutation === "resolver_bypass") engine += "\nfunction forbidden() { return availability.getRows(); }";

const runtimeEnd = server.indexOf("/* legacy runtime");
assert.notEqual(runtimeEnd, -1, "runtime boundary marker must exist for the active source audit");
const runtime = server.slice(0, runtimeEnd);

assert.match(runtime, /const TEST_LINE_WEBHOOK_ROUTE = "\/api\/test-line\/webhook"/);
assert.equal((runtime.match(/TEST_LINE_WEBHOOK_ROUTE/g) || []).length, 2, "only one active LINE webhook route may be registered");
assert.doesNotMatch(runtime, /SECOND_TEST_LINE_ROUTE|\/api\/junzan-test-line\/webhook|\/api\/test-line\/resolve/);
assert.doesNotMatch(runtime, /ConversationCoordinator|pushToTestLine|lineWebhookHandlerLegacy|ai-first-decision-pipeline|test-only-openai-structured-classifier/);
assert.doesNotMatch(runtime, /line-channel-identity-guard|createLineChannelIdentityGuard|validateLineDestination|validateChannelIdentity|requireChannelSecretSha256/);
assert.equal((root.match(/new ConversationEngineV2\(/g) || []).length, 1, "composition root creates one V2 engine");
assert.equal((root.match(/new ConversationEngineV2Coordinator\(/g) || []).length, 1, "composition root creates one V2 coordinator");
assert.equal((root.match(/createTestOnlyOpenAiConversationPlannerFromEnv/g) || []).length, 2, "only the composition root wires the planner");
assert.equal((root.match(/createTestOnlyOpenAiControlledComposerFromEnv/g) || []).length, 2, "only the composition root wires the controlled composer");
assert.match(root, /availabilityResolver:\s*\(query\) => service\.searchAvailability\(query\)/);
assert.match(root, /availableDatesResolver:\s*\(query\) => service\.searchAvailableDates\(query\)/);
assert.doesNotMatch(engine, /availability\.getRows\s*\(/, "V2 must not bypass the property-scoped resolver");
assert.doesNotMatch(runtime, /reply.*push|push.*reply/i, "LINE transport must not retain a push fallback");

console.log(JSON.stringify({ caseCount: 15, passCount: 15, failCount: 0, mutation: mutation || "none" }));
