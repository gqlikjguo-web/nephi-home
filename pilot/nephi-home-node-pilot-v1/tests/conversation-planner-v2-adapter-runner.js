"use strict";
const assert = require("node:assert/strict");
const { TestOnlyOpenAiConversationPlanner } = require("../lib/providers/test-only-openai-conversation-planner");
const { TestOnlyOpenAiControlledComposer } = require("../lib/providers/test-only-openai-controlled-composer");
const { runtimeConfig } = require("../config/runtime");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { validatePlannerOutput, applyPlannerSemanticContract } = require("../lib/conversation-engine-v2/planner-schema");
const { validateUnderstandingContext } = require("../lib/conversation-engine-v2/understanding-validator");

const output = { schemaVersion: 2, discourse: { relation: "new_request", confidence: 1 }, stateOperations: [], stay: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null }, tasks: [{ taskId: "1", type: "property_fact", sourceText: "你好", requestedOutputs: ["greeting"], dependsOnStayContext: false, entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 }, confidence: 1 }], ambiguities: [], missingInformation: [], needsHuman: false, shouldIgnore: false, reason: "greeting" };
let requestBody;
const planner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", fetchImpl: async (_url, options) => { requestBody = JSON.parse(options.body); return { ok: true, json: async () => ({ output_text: JSON.stringify(output) }) }; } });

(async () => {
  const result = await planner.classify({ currentMessage: "你好", currentMessages: ["你好"], eventTimestamp: 1, catalog: { propertyId: "p1", rooms: [] }, conversationState: { schemaVersion: 2 } });
  assert.equal(result.schemaVersion, 2);
  assert.equal(requestBody.text.format.name, "junzan_conversation_plan_v2");
  assert.equal(requestBody.text.format.strict, true);
  assert.equal(requestBody.text.format.schema.properties.tasks.minItems, 1);
  const plannerInstructions = requestBody.input[0].content[0].text;
  const taskSchema = requestBody.text.format.schema.properties.tasks.items;
  assert.match(plannerInstructions, /monetary lodging (?:amount|charge|rate)/i, "planner grammar must define price semantically instead of relying on question wording");
  assert.match(plannerInstructions, /type price.*requestedOutputs price.*dependsOnStayContext true/i, "generic and scoped monetary lodging requests must retain the inventory price contract");
  assert.match(plannerInstructions, /policy.*rules or conditions.*not.*monetary/i, "planner grammar must keep property rules separate from price requests");
  assert.match(plannerInstructions, /access credentials.*authentication secrets.*type high_risk.*never.*policy/i, "sensitive access disclosure must remain a high-risk handoff capability");
  assert.match(plannerInstructions, /before returning.*verify.*substantive request.*matching task/i, "planner must self-check semantic task coverage before returning structured output");
  assert.match(taskSchema.properties.type.description, /monetary lodging.*price/i, "the strict task schema must carry the shared price-vs-policy grammar into structured generation");
  assert.match(taskSchema.properties.type.description, /access credentials.*high_risk/i, "the strict task schema must preserve sensitive-access routing");
  assert.match(taskSchema.properties.requestedOutputs.description, /price task.*price/i, "the strict task schema must keep price output coupled to a price task");
  assert.match(taskSchema.properties.stayCandidate.description, /dependsOnStayContext is true.*structured object.*empty candidate fields/i, "stay-dependent tasks must retain an explicit empty candidate when dates are missing");
  assert.match(plannerInstructions, /preserve every stated nights, guest count, and feature even when a date is missing/i);
  assert.match(plannerInstructions, /explicit calendar expression/i);
  assert.match(plannerInstructions, /direct requests for the property's location, address, map, or navigation/i, "planner must recognize direct property location requests");
  assert.match(plannerInstructions, /relationship between the property and (?:an|any) external place/i, "planner must recognize location relationships as one shared semantic concept");
  assert.match(plannerInstructions, /proximity, near, far, distance, duration, directions, navigation, or nearby existence/i, "planner must cover proximity semantics rather than a fixed list of place names");
  assert.match(plannerInstructions, /never search for, recommend, invent, or identify a nearby place/i, "planner must not create unapproved nearby-place facts");
  assert.match(plannerInstructions, /every coordinated subject or requested fact/i, "planner must retain each subject in a multi-question message");
  assert.match(plannerInstructions, /coverageRepair.*only.*missing.*preserv/i, "a bounded repair round must supplement missing tasks without reinterpreting preserved tasks");
  assert.match(plannerInstructions, /pure social acknowledgement/i, "planner must classify non-actionable acknowledgements without inventing a task");
  assert.match(requestBody.input[0].content[0].text, /punctuation or emoji/i, "planner must classify non-semantic punctuation and emoji by dialogue act");
  assert.match(requestBody.input[0].content[0].text, /price or total price/i, "planner must distinguish pricing from availability and policy");
  assert.match(requestBody.input[0].content[0].text, /replace or remove a prior stay or room condition/i, "planner must express multi-turn replacement through the formal context relation");
  assert.match(requestBody.input[0].content[0].text, /new_request must have zero request-cycle references/i, "planner must not attach stale state to a new request");
  assert.equal(JSON.stringify(requestBody).includes("test-key"), false);
  const coverageCatalog = buildPropertyCatalog({
    propertyId: "coverage-property",
    displayName: "Coverage Property",
    timezone: "Asia/Taipei",
    rooms: [],
    commonAnswers: {},
    propertyFacts: [{ canonicalId: "pool", category: "amenity", status: "available", publicText: "Pool information." }],
    faqs: [{ knowledgeKey: "pool", question: "戲水池", answer: "正式戲水池資料" }],
    semanticCatalog: { aliases: { pool: ["戲水池"] } }
  });
  const omittedPool = JSON.parse(JSON.stringify(output));
  omittedPool.tasks[0] = { ...omittedPool.tasks[0], candidateIndex: 0, taskId: "price", type: "price", sourceText: "想問價格", detailIntent: "general", requestedOutputs: ["price"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: true, entity: { category: "bundle", rawText: "包棟", canonicalCandidate: null, confidence: 1 }, stayCandidate: { dateExpression: { rawText: "", kind: "none", anchor: "none" }, checkInCandidate: null, checkOutCandidate: null, nightsCandidate: null, guestCountCandidate: null } };
  omittedPool.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "coverage", messageRef: "", startOffset: 0, endOffset: 4, quote: "想問價格" }] }];
  const repairedPool = JSON.parse(JSON.stringify(output));
  repairedPool.tasks[0] = { ...repairedPool.tasks[0], candidateIndex: 0, taskId: "pool", type: "amenity", sourceText: "有戲水池嗎", detailIntent: "general", requestedOutputs: ["answer"], eligibilityEvidence: { kind: "none", sourceText: "" }, dependsOnStayContext: false, entity: { category: "amenity", rawText: "戲水池", canonicalCandidate: "pool", confidence: 1 }, stayCandidate: null };
  repairedPool.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "coverage", messageRef: "", startOffset: 9, endOffset: 14, quote: "有戲水池嗎" }] }];
  let coverageCalls = 0;
  const coverageBodies = [];
  const coveragePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async (_url, options) => {
    coverageCalls += 1;
    coverageBodies.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ output_text: JSON.stringify(coverageCalls === 1 ? omittedPool : repairedPool) }) };
  } });
  const coverageResult = await coveragePlanner.classify({ currentMessage: "想問價格，也想確認有戲水池嗎", currentMessages: ["想問價格，也想確認有戲水池嗎"], sourceEvents: [{ eventId: "coverage", messageText: "想問價格，也想確認有戲水池嗎" }], eventTimestamp: 1, catalog: coverageCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(coverageCalls, 2, "one bounded repair attempt may fill a missing formal subject");
  assert.equal(coverageResult.tasks.length, 2, "repair must merge with rather than replace the first valid task collection");
  assert.deepEqual(coverageResult.tasks[0], omittedPool.tasks[0], "the first attempt's valid price task must survive byte-for-byte");
  assert.equal(coverageResult.tasks[1].entity.canonicalCandidate, "pool");
  assert.deepEqual(validatePlannerOutput(coverageResult).errors, [], "the task-level merge must remain a valid Planner contract");
  const coverageDiagnostic = coverageResult[Symbol.for("junzan.plannerProviderDiagnostic")];
  assert.equal(coverageDiagnostic.providerAttemptCount, 2);
  assert.equal(coverageDiagnostic.retryPerformed, false, "a semantic coverage supplement is not a provider-error retry");
  assert.equal(coverageDiagnostic.retrySucceeded, false, "coverage repair must not be reported as a recovered provider failure");
  assert.equal(coverageDiagnostic.coverageRepairPerformed, true);
  assert.equal(coverageDiagnostic.coverageRepairSucceeded, true);
  assert.equal(coverageDiagnostic.coverageRepairFallback, false);
  const repairInput = JSON.parse(coverageBodies[1].input[1].content[0].text);
  assert.deepEqual(repairInput.coverageRepair.missingCanonicalIds, ["pool"]);
  assert.deepEqual(repairInput.coverageRepair.preservedTaskIds, ["price"]);

  const wholeMessageText = "Ask the lodging price and confirm the pool";
  const wholeMessageCatalog = buildPropertyCatalog({
    propertyId: "whole-message-property",
    displayName: "Whole Message Property",
    timezone: "Asia/Taipei",
    rooms: [],
    commonAnswers: {},
    propertyFacts: [{ canonicalId: "pool", category: "amenity", status: "available", publicText: "Pool information." }],
    semanticCatalog: { aliases: { pool: ["pool"] } }
  });
  const wholeMessagePrice = JSON.parse(JSON.stringify(omittedPool));
  wholeMessagePrice.tasks[0] = { ...wholeMessagePrice.tasks[0], sourceText: wholeMessageText, entity: { ...wholeMessagePrice.tasks[0].entity, rawText: "lodging" } };
  wholeMessagePrice.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "whole-message", messageRef: "", startOffset: 0, endOffset: wholeMessageText.length, quote: wholeMessageText }] }];
  const wholeMessagePool = JSON.parse(JSON.stringify(repairedPool));
  wholeMessagePool.tasks[0] = { ...wholeMessagePool.tasks[0], sourceText: wholeMessageText, entity: { ...wholeMessagePool.tasks[0].entity, rawText: "pool", canonicalCandidate: "pool" } };
  wholeMessagePool.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "whole-message", messageRef: "", startOffset: 0, endOffset: wholeMessageText.length, quote: wholeMessageText }] }];
  let wholeMessageCalls = 0;
  const wholeMessagePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    wholeMessageCalls += 1;
    return { ok: true, json: async () => ({ output_text: JSON.stringify(wholeMessageCalls === 1 ? wholeMessagePrice : wholeMessagePool) }) };
  } });
  const wholeMessageResult = await wholeMessagePlanner.classify({ currentMessage: wholeMessageText, currentMessages: [wholeMessageText], sourceEvents: [{ eventId: "whole-message", messageText: wholeMessageText }], eventTimestamp: 1, catalog: wholeMessageCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(wholeMessageCalls, 2, "a whole-message price task must not suppress an omitted independent formal subject");
  assert.equal(wholeMessageResult.tasks.length, 2);
  assert.deepEqual(wholeMessageResult.tasks[1], { ...wholeMessagePool.tasks[0], candidateIndex: 1 }, "the additive result may only remap the verified repair task's collection index");
  const contradictoryWholeMessagePrice = JSON.parse(JSON.stringify(wholeMessagePrice));
  contradictoryWholeMessagePrice.tasks[0].entity.canonicalCandidate = "pool";
  let contradictoryWholeMessageCalls = 0;
  const contradictoryWholeMessagePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    contradictoryWholeMessageCalls += 1;
    return { ok: true, json: async () => ({ output_text: JSON.stringify(contradictoryWholeMessageCalls === 1 ? contradictoryWholeMessagePrice : wholeMessagePool) }) };
  } });
  const contradictoryWholeMessageResult = await contradictoryWholeMessagePlanner.classify({ currentMessage: wholeMessageText, currentMessages: [wholeMessageText], sourceEvents: [{ eventId: "whole-message", messageText: wholeMessageText }], eventTimestamp: 1, catalog: wholeMessageCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(contradictoryWholeMessageCalls, 2, "an incompatible pool canonical candidate on a lodging-price task must not suppress the independent pool sibling");
  assert.deepEqual(contradictoryWholeMessageResult.tasks[0], contradictoryWholeMessagePrice.tasks[0], "coverage repair must preserve the lodging-price task despite its contradictory canonical candidate");
  assert.equal(contradictoryWholeMessageResult.tasks.length, 2);

  const multiFormalText = "Ask the fee for the pool and confirm parking";
  const multiFormalCatalog = buildPropertyCatalog({
    propertyId: "multi-formal-property",
    displayName: "Multi Formal Property",
    timezone: "Asia/Taipei",
    rooms: [],
    commonAnswers: {},
    propertyFacts: [
      { canonicalId: "pool", category: "amenity", status: "available", publicText: "Pool information." },
      { canonicalId: "parking", category: "amenity", status: "available", publicText: "Parking information." }
    ],
    semanticCatalog: { aliases: { pool: ["pool"], parking: ["parking"] } }
  });
  const multiFormalPrice = JSON.parse(JSON.stringify(wholeMessagePrice));
  multiFormalPrice.tasks[0] = { ...multiFormalPrice.tasks[0], sourceText: multiFormalText, entity: { category: "policy", rawText: "pool", canonicalCandidate: "pool", confidence: 1 } };
  multiFormalPrice.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "multi-formal", messageRef: "", startOffset: 0, endOffset: multiFormalText.length, quote: multiFormalText }] }];
  const multiFormalRepair = JSON.parse(JSON.stringify(repairedPool));
  multiFormalRepair.tasks = [
    { ...multiFormalRepair.tasks[0], candidateIndex: 0, taskId: "repair-pool", sourceText: "pool", entity: { ...multiFormalRepair.tasks[0].entity, rawText: "pool", canonicalCandidate: "pool" } },
    { ...multiFormalRepair.tasks[0], candidateIndex: 1, taskId: "repair-parking", sourceText: "parking", entity: { ...multiFormalRepair.tasks[0].entity, rawText: "parking", canonicalCandidate: "parking" } }
  ];
  multiFormalRepair.contextRelationCandidates = [
    { candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "multi-formal", messageRef: "", startOffset: 20, endOffset: 24, quote: "pool" }] },
    { candidateIndex: 1, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "multi-formal", messageRef: "", startOffset: 37, endOffset: 44, quote: "parking" }] }
  ];
  let multiFormalCalls = 0;
  const multiFormalPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    multiFormalCalls += 1;
    return { ok: true, json: async () => ({ output_text: JSON.stringify(multiFormalCalls === 1 ? multiFormalPrice : multiFormalRepair) }) };
  } });
  const multiFormalResult = await multiFormalPlanner.classify({ currentMessage: multiFormalText, currentMessages: [multiFormalText], sourceEvents: [{ eventId: "multi-formal", messageText: multiFormalText }], eventTimestamp: 1, catalog: multiFormalCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(multiFormalCalls, 2);
  assert.deepEqual(multiFormalResult.tasks[0], multiFormalPrice.tasks[0]);
  assert.deepEqual(new Set(multiFormalResult.tasks.slice(1).map((task) => task.entity.canonicalCandidate)), new Set(["pool", "parking"]), "one fee-drift task must not suppress another formal subject in the same source");

  let incompleteCalls = 0;
  const incompletePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    incompleteCalls += 1;
    return { ok: true, json: async () => ({ output_text: JSON.stringify(omittedPool) }) };
  } });
  const incompleteResult = await incompletePlanner.classify({ currentMessage: "想問價格，也想確認有戲水池嗎", currentMessages: ["想問價格，也想確認有戲水池嗎"], sourceEvents: [{ eventId: "coverage", messageText: "想問價格，也想確認有戲水池嗎" }], eventTimestamp: 1, catalog: coverageCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(incompleteCalls, 2);
  assert.deepEqual(incompleteResult.tasks[0], omittedPool.tasks[0], "an incomplete second attempt must not erase the first valid task");
  assert.equal(incompleteResult.tasks.some((task) => task.type === "human_help" && task.sourceText.includes("戲水池")), true, "an unrepaired substantive subject must become an explicit scoped handoff task");
  assert.deepEqual(validatePlannerOutput(incompleteResult).errors, [], "the scoped handoff fallback must remain structurally executable beside preserved tasks");
  assert.equal(incompleteResult[Symbol.for("junzan.plannerProviderDiagnostic")].coverageRepairFallback, true);

  const partialMessage = "Ask the lodging price; arrange an unsupported request";
  const partialOutput = JSON.parse(JSON.stringify(omittedPool));
  partialOutput.tasks[0] = {
    ...partialOutput.tasks[0],
    sourceText: "Ask the lodging price",
    entity: { ...partialOutput.tasks[0].entity, rawText: "lodging" }
  };
  partialOutput.tasks.push({
    ...repairedPool.tasks[0],
    candidateIndex: 1,
    taskId: "invalid-sibling",
    type: "unsupported_task",
    sourceText: "arrange an unsupported request",
    entity: { category: "other", rawText: "unsupported request", canonicalCandidate: null, confidence: 1 }
  });
  partialOutput.contextRelationCandidates = [
    { candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "partial", messageRef: "", startOffset: 0, endOffset: 21, quote: "Ask the lodging price" }] },
    { candidateIndex: 1, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "partial", messageRef: "", startOffset: 23, endOffset: partialMessage.length, quote: "arrange an unsupported request" }] }
  ];
  assert.equal(validatePlannerOutput(partialOutput).ok, false, "the provider fixture must begin with one structurally invalid sibling");
  let partialCalls = 0;
  const partialPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    partialCalls += 1;
    return { ok: true, json: async () => ({ output_text: JSON.stringify(partialOutput) }) };
  } });
  const partialInput = { currentMessage: partialMessage, currentMessages: [partialMessage], sourceEvents: [{ eventId: "partial", messageText: partialMessage }], eventTimestamp: 1, catalog: coverageCatalog, contextSnapshot: { scope: {}, cycles: [] } };
  const partialResult = await partialPlanner.classify(partialInput);
  assert.equal(partialCalls, 1, "a local task-contract failure must not retry the provider");
  assert.deepEqual(partialResult.tasks[0], partialOutput.tasks[0], "a structurally valid source-bound task must survive an invalid sibling byte-for-byte");
  assert.equal(partialResult.tasks[1].type, "human_help", "only the invalid source-bound sibling must become a scoped handoff");
  assert.equal(partialResult.tasks[1].sourceText, "arrange an unsupported request");
  assert.deepEqual(validatePlannerOutput(partialResult).errors, [], "the task-level fallback collection must be structurally executable");
  assert.equal(validateUnderstandingContext(partialResult, partialInput.contextSnapshot, { sourceEvents: partialInput.sourceEvents }).ok, true, "the task-level fallback collection must retain verified source authority");
  const partialDiagnostic = partialResult[Symbol.for("junzan.plannerProviderDiagnostic")];
  assert.equal(partialDiagnostic.retryPerformed, false);
  assert.equal(partialDiagnostic.taskCollectionRepairPerformed, true);
  assert.equal(partialDiagnostic.preservedTaskCount, 1);
  assert.equal(partialDiagnostic.fallbackTaskCount, 1);

  const copiedSourceOutput = JSON.parse(JSON.stringify(partialOutput));
  copiedSourceOutput.tasks[1].sourceText = partialOutput.tasks[0].sourceText;
  copiedSourceOutput.contextRelationCandidates[1].evidenceRefs = JSON.parse(JSON.stringify(partialOutput.contextRelationCandidates[0].evidenceRefs));
  const copiedSourcePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(copiedSourceOutput) }) }) });
  const copiedSourceResult = await copiedSourcePlanner.classify(partialInput);
  assert.equal(copiedSourceResult.tasks[1].type, "human_help");
  assert.notEqual(copiedSourceResult.tasks[1].sourceText, partialOutput.tasks[0].sourceText, "an invalid task must not borrow a valid sibling's source clause");
  assert.equal(copiedSourceResult.tasks[1].sourceText, "arrange an unsupported request", "an unbound candidate may use only the event span left unclaimed by preserved siblings");
  assert.equal(copiedSourceResult.contextRelationCandidates[1].evidenceRefs[0].startOffset, 23);
  assert.equal(copiedSourceResult.missingInformation.includes("unscoped_task_contract_failure"), true, "the inferred unclaimed span must remain explicitly marked unscoped");

  const duplicateClauseMessage = "Repeat this request; Repeat this request";
  const duplicateClauseOutput = JSON.parse(JSON.stringify(partialOutput));
  duplicateClauseOutput.tasks[0].sourceText = "Repeat this request";
  duplicateClauseOutput.tasks[0].entity.rawText = "request";
  duplicateClauseOutput.tasks[1].sourceText = "Repeat this request";
  duplicateClauseOutput.contextRelationCandidates = [
    { candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "duplicate-clause", messageRef: "", startOffset: 0, endOffset: 19, quote: "Repeat this request" }] },
    { candidateIndex: 1, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "duplicate-clause", messageRef: "", startOffset: 21, endOffset: 40, quote: "Repeat this request" }] }
  ];
  const duplicateClauseInput = { currentMessage: duplicateClauseMessage, currentMessages: [duplicateClauseMessage], sourceEvents: [{ eventId: "duplicate-clause", messageText: duplicateClauseMessage }], eventTimestamp: 1, catalog: coverageCatalog, contextSnapshot: { scope: {}, cycles: [] } };
  const duplicateClausePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(duplicateClauseOutput) }) }) });
  const duplicateClauseResult = await duplicateClausePlanner.classify(duplicateClauseInput);
  assert.equal(duplicateClauseResult.tasks[1].sourceText, "Repeat this request", "a repeated clause must stay scoped by its independently verified evidence offset");
  assert.equal(duplicateClauseResult.contextRelationCandidates[1].evidenceRefs[0].startOffset, 21);

  const containedEvidenceOutput = JSON.parse(JSON.stringify(partialOutput));
  containedEvidenceOutput.tasks[0].sourceText = partialMessage;
  containedEvidenceOutput.contextRelationCandidates[0].evidenceRefs = [{ eventId: "partial", messageRef: "", startOffset: 0, endOffset: partialMessage.length, quote: partialMessage }];
  const containedEvidencePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(containedEvidenceOutput) }) }) });
  const containedEvidenceResult = await containedEvidencePlanner.classify(partialInput);
  assert.equal(containedEvidenceResult.tasks[1].type, "unsupported_task", "a contained invalid evidence span must leave the whole collection fail-closed for the engine validator");
  assert.equal(validatePlannerOutput(containedEvidenceResult).ok, false);
  assert.notEqual(containedEvidenceResult[Symbol.for("junzan.plannerProviderDiagnostic")].taskCollectionRepairPerformed, true);

  const partialOverlapMessage = "Preserved overlap tail request";
  const partialOverlapOutput = JSON.parse(JSON.stringify(partialOutput));
  partialOverlapOutput.tasks[0].sourceText = "Preserved overlap";
  partialOverlapOutput.tasks[0].entity.rawText = "Preserved";
  partialOverlapOutput.tasks[1].sourceText = "overlap tail request";
  partialOverlapOutput.contextRelationCandidates = [
    { candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "partial-overlap", messageRef: "", startOffset: 0, endOffset: 17, quote: "Preserved overlap" }] },
    { candidateIndex: 1, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "partial-overlap", messageRef: "", startOffset: 10, endOffset: partialOverlapMessage.length, quote: "overlap tail request" }] }
  ];
  const partialOverlapInput = { currentMessage: partialOverlapMessage, currentMessages: [partialOverlapMessage], sourceEvents: [{ eventId: "partial-overlap", messageText: partialOverlapMessage }], eventTimestamp: 1, catalog: coverageCatalog, contextSnapshot: { scope: {}, cycles: [] } };
  const partialOverlapPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(partialOverlapOutput) }) }) });
  const partialOverlapResult = await partialOverlapPlanner.classify(partialOverlapInput);
  assert.equal(partialOverlapResult.tasks[1].sourceText, "tail request", "an overlapping candidate may retain only the event span not claimed by a preserved sibling");
  assert.equal(partialOverlapResult.contextRelationCandidates[1].evidenceRefs[0].startOffset, 18);
  assert.equal(partialOverlapResult.missingInformation.includes("unscoped_task_contract_failure"), true);

  const crossIdentityOutput = JSON.parse(JSON.stringify(partialOverlapOutput));
  crossIdentityOutput.contextRelationCandidates[0].evidenceRefs[0] = { ...crossIdentityOutput.contextRelationCandidates[0].evidenceRefs[0], messageRef: "", eventId: "cross-identity" };
  crossIdentityOutput.contextRelationCandidates[1].evidenceRefs[0] = { ...crossIdentityOutput.contextRelationCandidates[1].evidenceRefs[0], messageRef: "cross-identity-ref", eventId: "" };
  const crossIdentityInput = { ...partialOverlapInput, sourceEvents: [{ eventId: "cross-identity", messageRef: "cross-identity-ref", messageText: partialOverlapMessage }] };
  const crossIdentityPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(crossIdentityOutput) }) }) });
  const crossIdentityResult = await crossIdentityPlanner.classify(crossIdentityInput);
  assert.equal(crossIdentityResult.tasks[1].sourceText, "tail request", "eventId-only and messageRef-only refs for the same source must still enforce interval overlap");
  assert.equal(crossIdentityResult.contextRelationCandidates[1].evidenceRefs[0].startOffset, 18);
  assert.equal(crossIdentityResult.missingInformation.includes("unscoped_task_contract_failure"), true);

  const breakfastCatalog = buildPropertyCatalog({
    propertyId: "breakfast-property",
    displayName: "Breakfast Property",
    timezone: "Asia/Taipei",
    rooms: [],
    commonAnswers: { breakfastRule: "Breakfast is provided." },
    faqs: [{ knowledgeKey: "breakfast", question: "Is breakfast provided?", answer: "Yes." }],
    semanticCatalog: { aliases: { breakfast: ["早餐", "breakfast"] } }
  });
  const faqOnlyBreakfastCatalog = buildPropertyCatalog({
    propertyId: "faq-breakfast-property",
    displayName: "FAQ Breakfast Property",
    timezone: "Asia/Taipei",
    rooms: [],
    commonAnswers: {},
    faqs: [{ knowledgeKey: "breakfast", question: "Is breakfast provided?", answer: "Yes." }],
    semanticCatalog: { aliases: { breakfast: ["早餐", "breakfast"] } }
  });
  for (const [externalMessage, externalCatalog] of [["附近早餐店在哪裡", breakfastCatalog], ["早餐店推薦", faqOnlyBreakfastCatalog]]) {
    const externalOutput = JSON.parse(JSON.stringify(output));
    externalOutput.tasks[0] = {
      ...externalOutput.tasks[0],
      candidateIndex: 0,
      taskId: "external-place",
      type: "human_help",
      sourceText: externalMessage,
      detailIntent: "general",
      requestedOutputs: ["answer"],
      eligibilityEvidence: { kind: "none", sourceText: "" },
      dependsOnStayContext: false,
      entity: { category: "other", rawText: "", canonicalCandidate: null, confidence: 1 },
      stayCandidate: null
    };
    externalOutput.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "external-place", messageRef: "", startOffset: 0, endOffset: externalMessage.length, quote: externalMessage }] }];
    let externalCalls = 0;
    const externalPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
      externalCalls += 1;
      return { ok: true, json: async () => ({ output_text: JSON.stringify(externalOutput) }) };
    } });
    const externalResult = await externalPlanner.classify({ currentMessage: externalMessage, currentMessages: [externalMessage], sourceEvents: [{ eventId: "external-place", messageText: externalMessage }], eventTimestamp: 1, catalog: externalCatalog, contextSnapshot: { scope: {}, cycles: [] } });
    assert.equal(externalCalls, 1, "an external place phrase must not start formal property-fact coverage repair");
    assert.equal(externalResult.tasks.some((task) => task.entity && task.entity.canonicalCandidate === "breakfast"), false);
  }

  const mismatchedEvidencePool = JSON.parse(JSON.stringify(repairedPool));
  mismatchedEvidencePool.contextRelationCandidates[0].evidenceRefs[0] = { eventId: "coverage", messageRef: "", startOffset: 0, endOffset: 4, quote: "想問價格" };
  let mismatchedEvidenceCalls = 0;
  const mismatchedEvidencePlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    mismatchedEvidenceCalls += 1;
    return { ok: true, json: async () => ({ output_text: JSON.stringify(mismatchedEvidenceCalls === 1 ? omittedPool : mismatchedEvidencePool) }) };
  } });
  const mismatchedEvidenceResult = await mismatchedEvidencePlanner.classify({ currentMessage: "想問價格，也想確認有戲水池嗎", currentMessages: ["想問價格，也想確認有戲水池嗎"], sourceEvents: [{ eventId: "coverage", messageText: "想問價格，也想確認有戲水池嗎" }], eventTimestamp: 1, catalog: coverageCatalog, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(mismatchedEvidenceResult.tasks[1].type, "human_help", "repair evidence for another clause must not authorize a formal-subject task");
  assert.deepEqual(mismatchedEvidenceResult.tasks[0], omittedPool.tasks[0]);

  const invalidRelationPool = JSON.parse(JSON.stringify(repairedPool));
  invalidRelationPool.contextRelationCandidates[0].kind = "supplement_existing";
  invalidRelationPool.contextRelationCandidates[0].candidateRequestCycleRefs = ["invented-cycle"];
  let invalidRelationCalls = 0;
  const invalidRelationPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    invalidRelationCalls += 1;
    return { ok: true, json: async () => ({ output_text: JSON.stringify(invalidRelationCalls === 1 ? omittedPool : invalidRelationPool) }) };
  } });
  const invalidRelationInput = { currentMessage: "想問價格，也想確認有戲水池嗎", currentMessages: ["想問價格，也想確認有戲水池嗎"], sourceEvents: [{ eventId: "coverage", messageText: "想問價格，也想確認有戲水池嗎" }], eventTimestamp: 1, catalog: coverageCatalog, contextSnapshot: { scope: {}, cycles: [] } };
  const invalidRelationResult = await invalidRelationPlanner.classify(invalidRelationInput);
  assert.equal(invalidRelationResult.tasks[1].type, "human_help", "a repair with an invented cycle must be discarded for a scoped handoff");
  assert.equal(validateUnderstandingContext(invalidRelationResult, invalidRelationInput.contextSnapshot, { sourceEvents: invalidRelationInput.sourceEvents }).ok, true, "repair fallback must preserve the complete context contract");

  const wrongTaskCanonical = JSON.parse(JSON.stringify(omittedPool));
  wrongTaskCanonical.tasks[0].entity.canonicalCandidate = "pool";
  let wrongTaskCalls = 0;
  const wrongTaskPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    wrongTaskCalls += 1;
    return { ok: true, json: async () => ({ output_text: JSON.stringify(wrongTaskCalls === 1 ? wrongTaskCanonical : repairedPool) }) };
  } });
  const wrongTaskResult = await wrongTaskPlanner.classify(invalidRelationInput);
  assert.equal(wrongTaskCalls, 2, "a canonical candidate attached to another task source must not suppress formal-subject repair");
  assert.equal(wrongTaskResult.tasks[1].entity.canonicalCandidate, "pool");

  const capacityOutput = JSON.parse(JSON.stringify(omittedPool));
  capacityOutput.tasks = Array.from({ length: 12 }, (_, index) => ({ ...omittedPool.tasks[0], candidateIndex: index, taskId: `price-${index}` }));
  capacityOutput.contextRelationCandidates = Array.from({ length: 12 }, (_, index) => ({ ...omittedPool.contextRelationCandidates[0], candidateIndex: index }));
  let capacityCalls = 0;
  const capacityPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    capacityCalls += 1;
    return { ok: true, json: async () => ({ output_text: JSON.stringify(capacityOutput) }) };
  } });
  const capacityResult = await capacityPlanner.classify(invalidRelationInput);
  assert.equal(capacityResult.tasks.length, 13, "bounded additive merge must retain all preserved tasks and add an executable scoped handoff");
  assert.equal(capacityResult.tasks[12].type, "human_help");
  assert.equal(capacityResult.tasks.slice(0, 12).every((taskValue, index) => taskValue.taskId === `price-${index}`), true);
  assert.deepEqual(validatePlannerOutput(capacityResult).errors, []);

  const twoSubjectCatalog = buildPropertyCatalog({
    propertyId: "two-subject-property",
    displayName: "Two Subject Property",
    timezone: "Asia/Taipei",
    rooms: [],
    commonAnswers: {},
    propertyFacts: [
      { canonicalId: "pool", category: "amenity", status: "available", publicText: "Pool information." },
      { canonicalId: "parking", category: "amenity", status: "available", publicText: "Parking information." }
    ],
    faqs: [
      { knowledgeKey: "pool", question: "戲水池", answer: "正式戲水池資料" },
      { knowledgeKey: "parking", question: "停車場", answer: "正式停車資料" }
    ],
    semanticCatalog: { aliases: { pool: ["戲水池"], parking: ["停車場"] } }
  });
  const elevenTaskOutput = JSON.parse(JSON.stringify(capacityOutput));
  elevenTaskOutput.tasks = elevenTaskOutput.tasks.slice(0, 11);
  elevenTaskOutput.contextRelationCandidates = elevenTaskOutput.contextRelationCandidates.slice(0, 11);
  const twoSubjectMessage = "想問價格，也想確認有戲水池和停車場嗎";
  const twoSubjectInput = { currentMessage: twoSubjectMessage, currentMessages: [twoSubjectMessage], sourceEvents: [{ eventId: "two-subject", messageText: twoSubjectMessage }], eventTimestamp: 1, catalog: twoSubjectCatalog, contextSnapshot: { scope: {}, cycles: [] } };
  elevenTaskOutput.contextRelationCandidates.forEach((relation) => {
    relation.evidenceRefs = [{ eventId: "two-subject", messageRef: "", startOffset: 0, endOffset: 4, quote: "想問價格" }];
  });
  let twoSubjectCalls = 0;
  const twoSubjectPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    twoSubjectCalls += 1;
    return { ok: true, json: async () => ({ output_text: JSON.stringify(elevenTaskOutput) }) };
  } });
  const twoSubjectResult = await twoSubjectPlanner.classify(twoSubjectInput);
  assert.equal(twoSubjectResult.tasks.length, 13, "both missing subjects must become executable scoped handoffs without evicting eleven tasks");
  assert.equal(twoSubjectResult.tasks.slice(11).every((taskValue) => taskValue.type === "human_help"), true);
  assert.deepEqual(validatePlannerOutput(twoSubjectResult).errors, []);

  const blankRawPool = JSON.parse(JSON.stringify(repairedPool));
  const blankRawMessage = "戲水池要收費嗎？";
  blankRawPool.tasks[0] = { ...omittedPool.tasks[0], sourceText: blankRawMessage, entity: { category: "policy", rawText: "", canonicalCandidate: "pool", confidence: 1 } };
  blankRawPool.contextRelationCandidates = [{ candidateIndex: 0, kind: "new_request", candidateRequestCycleRefs: [], evidenceRefs: [{ eventId: "blank-raw", messageRef: "", startOffset: 0, endOffset: blankRawMessage.length, quote: blankRawMessage }] }];
  let blankRawCalls = 0;
  const blankRawPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async () => {
    blankRawCalls += 1;
    return { ok: true, json: async () => ({ output_text: JSON.stringify(blankRawPool) }) };
  } });
  const blankRawInput = { currentMessage: blankRawMessage, currentMessages: [blankRawMessage], sourceEvents: [{ eventId: "blank-raw", messageText: blankRawMessage }], eventTimestamp: 1, catalog: coverageCatalog, contextSnapshot: { scope: {}, cycles: [] } };
  const blankRawResult = await blankRawPlanner.classify(blankRawInput);
  assert.equal(blankRawCalls, 1, "a verified formal subject that Semantic Contract can normalize must not trigger a duplicate repair sibling");
  const blankRawSemantic = applyPlannerSemanticContract(blankRawResult, { catalog: coverageCatalog, sourceEvents: blankRawInput.sourceEvents });
  assert.notEqual(blankRawSemantic.tasks[0].type, "price", "the malformed stateful shape must normalize to the formal property subject without inventing lodging price");
  assert.equal(blankRawSemantic.tasks[0].entity.canonicalCandidate, "pool");
  const missingTaskDate = JSON.parse(JSON.stringify(omittedPool));
  missingTaskDate.tasks[0] = { ...missingTaskDate.tasks[0], sourceText: "7/20想問價格" };
  let temporalCalls = 0;
  const temporalPlanner = new TestOnlyOpenAiConversationPlanner({ apiKey: "test-key", model: "test-model", retryDelayMs: 0, fetchImpl: async (_url, options) => {
    temporalCalls += 1;
    return { ok: true, json: async () => ({ output_text: JSON.stringify(missingTaskDate) }) };
  } });
  const temporalResult = await temporalPlanner.classify({ currentMessage: "7/20想問價格", currentMessages: ["7/20想問價格"], sourceEvents: [{ eventId: "temporal", messageText: "7/20想問價格" }], eventTimestamp: Date.parse("2026-08-06T08:00:00Z"), catalog: { propertyId: "temporal-property", rooms: [], policies: [], amenities: [], transportFacts: [], aliases: {} }, contextSnapshot: { scope: {}, cycles: [] } });
  assert.equal(temporalCalls, 1, "temporal candidates must be validated by the canonical temporal authority, not by retrying the Planner provider");
  assert.equal(temporalResult.tasks[0].stayCandidate.dateExpression.kind, "none");
  assert.equal(runtimeConfig({ TEST_ONLY_CONVERSATION_ENGINE_V2: "true" }).testOnlyConversationEngineV2, true);
  assert.equal(runtimeConfig({}).testOnlyConversationEngineV2, false);
  let composerRequest;
  const composerOutput = { sections: [{ taskId: "1", responseMode: "answer", text: "已確認住宿資訊。" }] };
  const composer = new TestOnlyOpenAiControlledComposer({ apiKey: "test-key", model: "test-model", fetchImpl: async (_url, options) => { composerRequest = JSON.parse(options.body); return { ok: true, json: async () => ({ output_text: JSON.stringify(composerOutput) }) }; } });
  const composed = await composer.compose({ sections: [{ taskId: "1", responseMode: "answer", facts: { answer: "已確認住宿資訊。" } }] });
  assert.deepEqual(composed, composerOutput);
  assert.equal(composerRequest.text.format.name, "junzan_controlled_reply_v2");
  assert.deepEqual(composerRequest.text.format.schema.properties.sections.items.properties.responseMode.enum, ["answer", "clarification", "handoff"]);
  assert.deepEqual(JSON.parse(composerRequest.input[1].content[0].text), {
    sections: [{ taskId: "1", responseMode: "answer", exactText: "已確認住宿資訊。" }]
  });
  assert.deepEqual(composerRequest.text.format.schema.properties.sections.items.properties.text.enum, ["已確認住宿資訊。"]);
  assert.match(composerRequest.input[0].content[0].text, /copy taskId, responseMode, and exactText without changing/i);
  assert.equal(JSON.stringify(composerRequest).includes("test-key"), false);
  console.log("conversation planner v2 adapter: PASS");
})().catch((error) => { console.error(error); process.exitCode = 1; });
