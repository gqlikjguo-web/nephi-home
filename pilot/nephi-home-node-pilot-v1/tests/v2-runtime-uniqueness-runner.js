"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mutation = process.env.JUNZAN_GUARD_MUTATION || "";
const read = (file) => fs.readFileSync(path.resolve(__dirname, file), "utf8");
let server = read("../server.js");
let root = read("../lib/v2-composition-root.js");
let engine = read("../lib/conversation-engine-v2/engine.js");
const executor = read("../lib/conversation-engine-v2/capability-executor.js");
const finalDecision = read("../lib/conversation-engine-v2/final-decision.js");
const formalRequest = read("../lib/conversation-engine-v2/formal-request.js");
const composer = read("../lib/conversation-engine-v2/controlled-composer.js");

if (mutation === "second_runtime") server = server.replace("/* legacy runtime", "const secondRoot = createV2CompositionRoot({});\n  /* legacy runtime");
if (mutation === "resolver_bypass") engine += "\nfunction forbidden() { return availability.getRows(); }";

const runtimeEnd = server.indexOf("/* legacy runtime");
assert.notEqual(runtimeEnd, -1, "runtime boundary marker must exist for the active source audit");
const runtime = server.slice(0, runtimeEnd);

assert.match(runtime, /const TEST_LINE_WEBHOOK_ROUTE = "\/api\/test-line\/webhook"/);
assert.equal((runtime.match(/TEST_LINE_WEBHOOK_ROUTE/g) || []).length, 2, "only one active LINE webhook route may be registered");
assert.equal((runtime.match(/createV2CompositionRoot\(/g) || []).length, 1, "runtime may invoke exactly one composition root");
assert.doesNotMatch(runtime, /SECOND_TEST_LINE_ROUTE|\/api\/junzan-test-line\/webhook|\/api\/test-line\/resolve/);
assert.doesNotMatch(runtime, /new ConversationEngineV2\(|new ConversationEngineV2Coordinator\(/, "runtime must not construct a parallel engine or coordinator");
assert.doesNotMatch(runtime, /ConversationCoordinator|pushToTestLine|lineWebhookHandlerLegacy|ai-first-decision-pipeline|test-only-openai-structured-classifier|createTestOnlyOpenAiConversationPlannerFromEnv|createTestOnlyOpenAiControlledComposerFromEnv|composeControlledReply/);
assert.doesNotMatch(runtime, /line-channel-identity-guard|createLineChannelIdentityGuard|validateLineDestination|validateChannelIdentity|requireChannelSecretSha256/);
assert.equal((root.match(/new ConversationEngineV2\(/g) || []).length, 1, "composition root creates one V2 engine");
assert.equal((root.match(/new ConversationEngineV2Coordinator\(/g) || []).length, 1, "composition root creates one V2 coordinator");
assert.match(root, /new ConversationEngineV2Coordinator\(\{ engine, debounceMs, externalReplyToken: true \}\)/, "the LINE transport owns reply tokens, so the V2 coordinator must not suppress a valid reply when no reply token is injected");
assert.match(root, /testOnlyOverrides = null/, "test-only overrides are an explicit composition-root seam");
assert.match(server, /testOnlyOverrides: options\.testOnlyOverrides \|\| null/, "only the server factory may pass test-only overrides into the active root");
assert.equal((root.match(/createTestOnlyOpenAiConversationPlannerFromEnv/g) || []).length, 2, "only the composition root wires the planner");
assert.equal((root.match(/createTestOnlyOpenAiControlledComposerFromEnv/g) || []).length, 2, "only the composition root wires the controlled composer");
assert.match(root, /availabilityResolver: overrides\.availabilityResolver \|\| \(\(query\) => service\.searchAvailability\(query\)\)/);
assert.match(root, /availableDatesResolver: overrides\.availableDatesResolver \|\| \(\(query\) => service\.searchAvailableDates\(query\)\)/);
assert.doesNotMatch(engine, /availability\.getRows\s*\(/, "V2 must not bypass the property-scoped resolver");
assert.match(engine, /reduceConversationState\(/, "V2 must use the single state reducer");
assert.match(engine, /buildFormalRequest\(/, "V2 must establish a formal request before execution");
assert.match(engine, /buildQueryPlan/, "V2 must establish a query plan before execution");
assert.match(engine, /executeQueryPlans\(/, "V2 must execute only resolver-backed query plans");
assert.doesNotMatch(engine, /executeTasks\(/, "V2 must not send Planner tasks directly to the executor");
assert.equal((engine.match(/buildFinalDecision\(/g) || []).length, 1, "Engine must call the FinalDecision builder at one adapter location");
assert.match(finalDecision, /function buildFinalDecision/, "FinalDecision module is the sole action authority");
assert.doesNotMatch(formalRequest, /action:\s*["'](?:reply|handoff|clarification|no_reply)/, "FormalRequest must remain neutral");
assert.doesNotMatch(executor, /action:\s*["'](?:reply|handoff|clarification|no_reply)/, "QueryPlan executor must remain neutral");
assert.doesNotMatch(composer, /no_reply|finalDecision|buildFinalDecision/, "Composer must not decide business action");
assert.match(executor.match(/function executeTasks\([\s\S]*?\n}\n\n\/\/ The active Engine runtime/)[0], /buildPricingFacts\(/, "legacy executor pricing must use the canonical pricing function");
assert.match(executor.match(/function executeQueryPlans\([\s\S]*?\n}\n\nfunction queryOutcome/)[0], /executeQueryPlan\(/, "query-plan batch executor must delegate only to the per-plan executor");
assert.doesNotMatch(executor.match(/function executeQueryPlans\([\s\S]*?\n}\n\nfunction queryOutcome/)[0], /executeTasks\(/, "query-plan batch executor must not fall back to legacy tasks");
assert.match(executor.match(/function executeQueryPlan\([\s\S]*?\n}\n\nmodule\.exports/)[0], /buildPricingFacts\(/, "query-plan pricing must use the canonical pricing function");
assert.doesNotMatch(executor.match(/function executeQueryPlan\([\s\S]*?\n}\n\nmodule\.exports/)[0], /executeTasks\(/, "query-plan executor must not invoke legacy tasks");
assert.equal((executor.match(/const daily = dates\.map/g) || []).length, 1, "production code must have one daily pricing implementation");
assert.equal((executor.match(/priceOverrides\.find/g) || []).length, 1, "production code must have one override-priority implementation");
assert.match(engine, /buildResponsePlan\(/, "V2 must plan facts before composition");
assert.match(engine, /composeControlledReply\(/, "V2 must use the controlled composer");
assert.doesNotMatch(runtime, /reply.*push|push.*reply/i, "LINE transport must not retain a push fallback");

console.log(JSON.stringify({ caseCount: 21, passCount: 21, failCount: 0, mutation: mutation || "none" }));
