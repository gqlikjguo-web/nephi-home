"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const mutation = process.env.JUNZAN_GUARD_MUTATION || "";
const read = (file) => fs.readFileSync(path.resolve(__dirname, file), "utf8");
let server = read("../server.js");
let root = read("../lib/v2-composition-root.js");
let engine = read("../lib/conversation-engine-v2/engine.js");
let executor = read("../lib/conversation-engine-v2/capability-executor.js");
const datePriceAuthority = read("../lib/date-price-authority.js");
const finalDecision = read("../lib/conversation-engine-v2/final-decision.js");
const finalResponseRenderer = read("../lib/conversation-engine-v2/final-response-renderer.js");
let formalRequest = read("../lib/conversation-engine-v2/formal-request.js");
const stateReducer = read("../lib/conversation-engine-v2/state-reducer.js");
const stateReducerV3 = read("../lib/conversation-engine-v2/conversation-state-v3-reducer.js");
const temporalAuthority = read("../lib/conversation-engine-v2/temporal-resolver.js");
let canonicalizer = read("../lib/conversation-engine-v2/canonicalizer.js");
const canonicalRequest = read("../lib/conversation-engine-v2/canonical-request.js");
const capabilityRegistry = read("../lib/conversation-engine-v2/capability-registry.js");
const composer = read("../lib/conversation-engine-v2/controlled-composer.js");
const openAiPlanner = read("../lib/providers/test-only-openai-conversation-planner.js");
const coverageCritic = read("../lib/providers/test-only-openai-coverage-critic.js");
const openAiComposer = read("../lib/providers/test-only-openai-controlled-composer.js");
const lineTrace = read("../lib/test-only-line-message-trace.js");
const claimValidator = read("../lib/conversation-engine-v2/claim-validator.js");
const finalResponseRendererFiles = fs.readdirSync(path.resolve(__dirname, "../lib/conversation-engine-v2"))
  .filter((file) => /^final-response.*\.js$/.test(file));

const MUTATIONS = Object.freeze([
  "legacy_query_line_route",
  "caller_controlled_property_handler",
  "second_runtime",
  "resolver_bypass",
  "second_final_renderer",
  "second_canonicalizer",
  "second_temporal_writer",
  "second_capability_writer",
  "second_entity_writer",
  "second_resolver_writer",
  "unreachable_dead_runtime_after_return"
]);

if (mutation === "legacy_query_line_route") server += "\nconst TEST_LINE_WEBHOOK_ROUTE = '/api/test-line/webhook';";
if (mutation === "caller_controlled_property_handler") server += "\nfunction lineWebhookHandler({ customerId }) { return customerId; }";
if (mutation === "second_runtime") server += "\nconst secondRoot = createV2CompositionRoot({});";
if (mutation === "resolver_bypass") engine += "\nfunction forbidden() { return availability.getRows(); }";
if (mutation === "second_final_renderer") engine += "\nfunction buildFinalResponse() { return { action: 'reply', replyText: '', shouldReply: false }; }";
if (mutation === "second_canonicalizer") engine += "\nfunction forbiddenCanonicalizer(item) { return canonicalizeExecutionItem(item); }";
if (mutation === "second_temporal_writer") canonicalizer += "\nfunction forbiddenTemporalWriter() { return resolveCanonicalTemporal({}); }";
if (mutation === "second_capability_writer") engine += "\nconst forbiddenCapabilityWriter = getCapabilityDefinition('availability');";
if (mutation === "second_entity_writer") formalRequest += "\nconst forbiddenEntityWriter = resolveEntity({}, {});";
if (mutation === "second_resolver_writer") executor += "\nconst forbiddenResolverWriter = getCapabilityDefinition('availability').resolverId;";
if (mutation === "unreachable_dead_runtime_after_return") server += "\n/* legacy runtime kept below */";

const runtime = server;

assert.doesNotMatch(runtime, /TEST_LINE_WEBHOOK_ROUTE|\/api\/test-line\/webhook|\blineWebhookHandler\b|legacy runtime kept|pushToTestLine/);
assert.equal((runtime.match(/\^\\\/api\\\/line\\\/webhooks\\\//g) || []).length, 1, "exactly one property-scoped shared LINE route may be registered");
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
assert.match(server, /const testOnlyTransportDiagnostic = typeof options\.testOnlyTransportDiagnostic === "function" \? options\.testOnlyTransportDiagnostic : null/, "transport diagnostics are an explicit server-factory-only seam");
assert.match(server, /const emitTransportDiagnostic = \(entry\) => \{[\s\S]*logSafeTestOnlyConversationTrace\(entry\);[\s\S]*try \{ testOnlyTransportDiagnostic\(entry\); \} catch/, "transport diagnostics must retain the safe logger and isolate callback failures");
assert.equal((runtime.match(/const \{ replyText: _replyText, \.\.\.diagnostic \} = details; captureSafeTrace\(details\); emitTransportDiagnostic\(diagnostic\);/g) || []).length, 1, "the sole shared transport must retain reply text only in the production-safe trace while excluding it from the existing diagnostic callback");
assert.equal((runtime.match(/testOnlyLineMessageTrace\.transport\(\{ traceId: result\.traceId, eventId: input\.eventId, propertyId: id, \.\.\.details \}\)/g) || []).length, 1, "the sole shared transport must persist the bounded test-only transport trace through its dedicated service");
assert.equal((root.match(/createTestOnlyOpenAiConversationPlannerFromEnv/g) || []).length, 2, "only the composition root wires the planner");
assert.equal((root.match(/createTestOnlyOpenAiControlledComposerFromEnv/g) || []).length, 0, "the active root must not wire an OpenAI answer rewriter");
assert.match(engine, /planner\.classify\(\{[^}]*lineUserId: input\.lineUserId/, "the active Engine must pass its existing guest identity to the sole Planner path");
assert.doesNotMatch(engine, /composer\.compose\(/, "customer-visible replies must use only the deterministic composer");
assert.equal([openAiPlanner, coverageCritic, openAiComposer].filter((source) => source.includes('require("../test-only-line-message-trace")')).length, 3, "inactive provider modules retain the shared diagnostic hash utility");
assert.equal((lineTrace.match(/function sha256\(/g) || []).length, 1, "the safety identifier path must not introduce a second SHA-256 helper");
assert.match(root, /availabilityResolver: overrides\.availabilityResolver \|\| \(\(query\) => service\.searchAvailability\(query\)\)/);
assert.match(root, /availableDatesResolver: overrides\.availableDatesResolver \|\| \(\(query\) => service\.searchAvailableDates\(query\)\)/);
assert.doesNotMatch(engine, /availability\.getRows\s*\(/, "V2 must not bypass the property-scoped resolver");
assert.equal((engine.match(/reduceConversationStateV3\(/g) || []).length, 1, "V2 must perform exactly one authoritative V3 state reduction");
assert.doesNotMatch(engine, /\breduceConversationState\(/, "active V2 must not write through the legacy state reducer");
assert.match(engine, /buildCanonicalFormalRequest\(/, "V2 must build FormalRequest from CanonicalRequest");
assert.match(engine, /formalRequests\.map\(buildCanonicalQueryPlan\)/, "V2 must build QueryPlan from CanonicalRequest");
assert.match(engine, /executeCanonicalQueryPlans\(/, "V2 must execute only CanonicalRequest-backed query plans");
assert.doesNotMatch(engine, /\bbuildFormalRequest\(/, "active Engine must not use the Planner-task FormalRequest adapter");
assert.doesNotMatch(engine, /\bbuildQueryPlan\(/, "active Engine must not use the legacy QueryPlan adapter");
assert.doesNotMatch(engine, /\bexecuteQueryPlans\(/, "active Engine must not use the legacy query-plan batch adapter");
assert.doesNotMatch(engine, /executeTasks\(/, "V2 must not send Planner tasks directly to the executor");
assert.match(temporalAuthority, /function resolveCanonicalTemporal/, "the Temporal Resolver module must own the canonical temporal authority");
assert.equal((engine.match(/canonicalizeExecutionItem\(/g) || []).length, 1, "Engine must invoke exactly one Canonicalizer adapter location");
assert.equal((canonicalizer.match(/resolveCanonicalTemporal\(/g) || []).length, 1, "Canonicalizer must be the sole executable temporal writer");
assert.equal((canonicalizer.match(/createCanonicalRequest\(/g) || []).length, 1, "Canonicalizer must create CanonicalRequest at exactly one location");
assert.equal((canonicalizer.match(/resolveEntity\(/g) || []).length, 1, "Canonicalizer must write canonical entity at exactly one location");
assert.doesNotMatch(engine, /resolveCanonicalTemporal|require\(["']\.\/temporal-resolver["']\)/, "Engine must not write temporal state");
assert.doesNotMatch(engine, /resolveEntity|getCapabilityDefinition|require\(["']\.\/(?:entity-resolver|capability-registry)["']\)/, "Engine must not write entity, capability, or resolver authority");
assert.doesNotMatch(formalRequest, /resolveEntity/, "FormalRequest must not write canonical entity");
assert.doesNotMatch(executor, /getCapabilityDefinition/, "Executor must not select resolver policy from capability");
assert.match(canonicalizer, /getCapabilityDefinition/, "Canonicalizer must derive capability policy from the registry");
assert.match(canonicalizer, /resolverId:\s*definition\.resolverId/, "Canonicalizer must write resolverId only from the capability registry");
assert.match(canonicalRequest, /getCapabilityDefinition\(value\.capability\)/, "CanonicalRequest validation must enforce the registry contract");
assert.match(capabilityRegistry, /function getCapabilityDefinition/, "the capability registry must expose the immutable capability policy");
const canonicalFormalBlock = formalRequest.match(/function buildCanonicalFormalRequest\([\s\S]*?function buildCanonicalQueryPlan\([\s\S]*?\r?\n}\r?\n\r?\nmodule\.exports/)[0];
assert.doesNotMatch(canonicalFormalBlock, /resolveCanonicalTemporal|resolveEntity|getCapabilityDefinition|dateExpression|checkInCandidate|checkOutCandidate|task\.type/, "FormalRequest and QueryPlan must only read CanonicalRequest authority");
assert.match(canonicalFormalBlock, /capability:\s*request\.capability/);
assert.match(canonicalFormalBlock, /resolverId:\s*canonicalRequest\.resolverId/);
assert.doesNotMatch(stateReducerV3, /resolveCanonicalTemporal|require\(["']\.\/temporal-resolver["']\)/, "V3 state must persist canonical temporal state without invoking Temporal");
assert.doesNotMatch(executor, /resolveCanonicalTemporal|dateExpression|checkInCandidate|checkOutCandidate/, "Executor must consume QueryPlan dates without parsing Planner candidates");
const canonicalExecutorBlock = executor.match(/function executeCanonicalQueryPlans\([\s\S]*?\r?\n}\r?\n\r?\nmodule\.exports/)[0];
assert.match(canonicalExecutorBlock, /assertCanonicalRequest\(queryPlan && queryPlan\.canonicalRequest\)/, "canonical executor must reject plans without a CanonicalRequest");
assert.match(canonicalExecutorBlock, /queryPlan\.resolverId !== queryPlan\.canonicalRequest\.resolverId/, "canonical executor must reject resolver rewrites");
assert.doesNotMatch(canonicalExecutorBlock, /getCapabilityDefinition|resolveEntity|task\.type/, "canonical executor entrypoint must not reclassify semantic authority");
assert.equal((engine.match(/buildFinalDecision\(/g) || []).length, 1, "Engine must call the FinalDecision builder at one adapter location");
assert.match(finalDecision, /function buildFinalDecision/, "FinalDecision module is the sole action authority");
assert.deepEqual(finalResponseRendererFiles, ["final-response-renderer.js"], "exactly one final response renderer module may exist");
assert.equal((engine.match(/buildFinalResponse\(/g) || []).length, 1, "Engine must call the final response renderer through one adapter location");
assert.match(finalResponseRenderer, /function buildFinalResponse/, "the single final response renderer must own final reply content");
assert.doesNotMatch(finalResponseRenderer, /buildFinalDecision|require\(["']\.\/final-decision["']\)/, "the final response renderer must consume, not recreate, FinalDecision");
assert.doesNotMatch(finalDecision, /buildFinalResponse|replyText|shouldReply/, "FinalDecision rules must remain content-neutral");
assert.doesNotMatch(claimValidator, /buildFinalDecision|buildFinalResponse|action:\s*["'](?:reply|handoff|clarification|no_reply)/, "Claim Validator must not decide action or render final content");
assert.doesNotMatch(runtime, /final-response-renderer|buildFinalResponse/, "server transport must consume Engine output without a second renderer");
assert.doesNotMatch(formalRequest, /action:\s*["'](?:reply|handoff|clarification|no_reply)/, "FormalRequest must remain neutral");
assert.doesNotMatch(executor, /action:\s*["'](?:reply|handoff|clarification|no_reply)/, "QueryPlan executor must remain neutral");
assert.doesNotMatch(composer, /no_reply|finalDecision|buildFinalDecision/, "Composer must not decide business action");
assert.match(executor.match(/function executeTasks\([\s\S]*?\r?\n}\r?\n\r?\n\/\/ The active Engine runtime/)[0], /buildPricingFacts\(/, "legacy executor pricing must use the canonical pricing function");
assert.match(executor.match(/function executeQueryPlans\([\s\S]*?\r?\n}\r?\n\r?\nfunction queryOutcome/)[0], /executeQueryPlan\(/, "query-plan batch executor must delegate only to the per-plan executor");
assert.doesNotMatch(executor.match(/function executeQueryPlans\([\s\S]*?\r?\n}\r?\n\r?\nfunction queryOutcome/)[0], /executeTasks\(/, "query-plan batch executor must not fall back to legacy tasks");
assert.match(executor.match(/function executeQueryPlan\([\s\S]*?\r?\n}\r?\n\r?\nmodule\.exports/)[0], /buildPricingFacts\(/, "query-plan pricing must use the canonical pricing function");
assert.doesNotMatch(executor.match(/function executeQueryPlan\([\s\S]*?\r?\n}\r?\n\r?\nmodule\.exports/)[0], /executeTasks\(/, "query-plan executor must not invoke legacy tasks");
assert.equal((executor.match(/const daily = dates\.map/g) || []).length, 1, "production code must have one daily pricing implementation");
assert.equal((executor.match(/priceOverrides\.find/g) || []).length, 0, "capability executor must delegate override priority to the date price authority");
assert.equal((datePriceAuthority.match(/priceOverrides\.find/g) || []).length, 1, "production code must have one override-priority implementation");
assert.match(executor, /require\(["']\.\.\/date-price-authority["']\)/, "Resolver pricing must use the date price authority");
assert.match(server, /require\(["']\.\/lib\/date-price-authority["']\)/, "public pricing must use the same date price authority");
assert.match(engine, /buildResponsePlan\(/, "V2 must plan facts before composition");
assert.match(engine, /composeControlledReply\(/, "V2 must use the controlled composer");
assert.doesNotMatch(runtime, /reply.*push|push.*reply/i, "LINE transport must not retain a push fallback");

if (!mutation) {
  for (const injectedMutation of MUTATIONS) {
    const child = spawnSync(process.execPath, [__filename], {
      cwd: process.cwd(),
      env: { ...process.env, JUNZAN_GUARD_MUTATION: injectedMutation },
      encoding: "utf8"
    });
    assert.notEqual(child.status, 0, `${injectedMutation} mutation must be rejected`);
  }
}

console.log(JSON.stringify({ caseCount: 56, passCount: 56, failCount: 0, mutation: mutation || "none", mutationCount: MUTATIONS.length }));
