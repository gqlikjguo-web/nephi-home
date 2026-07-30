"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  ConversationEngineV2Coordinator
} = require("../lib/conversation-engine-v2/coordinator");
const {
  ConversationEngineV2
} = require("../lib/conversation-engine-v2/engine");
const { JsonFileRepository } = require("../lib/json-repository");

function parkingPlan(sourceEvents) {
  const source = sourceEvents[0];
  return {
    schemaVersion: 2,
    discourse: { relation: "new_request", confidence: 1 },
    stateOperations: [],
    stay: {
      dateExpression: { rawText: "", kind: "none", anchor: "none" },
      checkInCandidate: null,
      checkOutCandidate: null,
      nightsCandidate: null,
      guestCountCandidate: null
    },
    tasks: [{
      candidateIndex: 0,
      taskId: "parking",
      type: "amenity",
      sourceText: source.messageText,
      detailIntent: "general",
      requestedOutputs: ["answer"],
      eligibilityEvidence: { kind: "none", sourceText: "" },
      dependsOnStayContext: false,
      entity: {
        category: "amenity",
        rawText: source.messageText,
        canonicalCandidate: "parking",
        confidence: 1
      },
      stayCandidate: null,
      confidence: 1
    }],
    contextRelationCandidates: [{
      candidateIndex: 0,
      kind: "new_request",
      candidateRequestCycleRefs: [],
      evidenceRefs: [{
        eventId: source.eventId,
        startOffset: 0,
        endOffset: source.messageText.length,
        quote: source.messageText
      }]
    }],
    ambiguities: [],
    missingInformation: [],
    needsHuman: false,
    shouldIgnore: false,
    reason: "event replay integration"
  };
}

(async () => {
  let scheduled = null;
  let engineCalls = 0;
  let stateWrites = 0;
  const coordinator = new ConversationEngineV2Coordinator({
    engine: {
      process: async () => {
        engineCalls += 1;
        stateWrites += 1;
        return { shouldReply: true, noReply: false };
      }
    },
    externalReplyToken: true,
    schedule: (run) => {
      scheduled = run;
      return 1;
    },
    cancel: () => {}
  });
  const input = {
    customerId: "property-alpha",
    channelId: "line-alpha",
    lineUserId: "Ualpha",
    eventId: "event-replayed",
    messageText: "availability"
  };
  const first = coordinator.enqueue(input);
  await scheduled();
  await first;
  const replay = await coordinator.enqueue(input);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.shouldReply, false);
  assert.equal(engineCalls, 1);
  assert.equal(stateWrites, 1);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-replay-"));
  try {
    const seedFile = path.join(tempDir, "seed.json");
    const dataFile = path.join(tempDir, "data.json");
    const property = {
      customerId: "property-alpha",
      propertyId: "property-alpha",
      displayName: "Alpha",
      timezone: "Asia/Taipei",
      currency: "TWD",
      rooms: [],
      commonAnswers: {
        parkingRule: "On-site parking is available."
      },
      semanticCatalog: {
        aliases: { parking: ["parking"] },
        amenities: []
      }
    };
    fs.writeFileSync(seedFile, JSON.stringify({
      testOnly: true,
      seedDays: 1,
      homestays: [property],
      messageLogs: { "property-alpha": [] }
    }));
    const repository = new JsonFileRepository({
      dataFile,
      seedFile,
      now: () => new Date("2026-07-30T07:00:00.000Z")
    });
    let actualStateWrites = 0;
    const persistence = {
      getConversationState: (...args) =>
        repository.getConversationState(...args),
      setConversationState: (...args) => {
        actualStateWrites += 1;
        return repository.setConversationState(...args);
      },
      appendMessageLog: (...args) => repository.appendMessageLog(...args),
      updateMessageEvent: (...args) =>
        repository.updateMessageEvent(...args)
    };
    const actualEngine = new ConversationEngineV2({
      planner: { classify: async ({ sourceEvents }) => parkingPlan(sourceEvents) },
      persistence,
      getProperty: () => property,
      availabilityResolver: () => {
        throw new Error("parking must not call availability");
      },
      listPriceOverrides: () => [],
      now: () => new Date("2026-07-30T07:00:00.000Z")
    });
    let actualScheduled = null;
    const coordinatorOptions = {
      engine: actualEngine,
      externalReplyToken: true,
      schedule: (run) => {
        actualScheduled = run;
        return 1;
      },
      cancel: () => {}
    };
    const actualCoordinator = new ConversationEngineV2Coordinator(
      coordinatorOptions
    );
    const actualInput = {
      customerId: "property-alpha",
      channelId: "line-alpha",
      lineUserId: "Ualpha",
      eventId: "event-actual-replay",
      eventTimestamp: "2026-07-30T07:00:00.000Z",
      messageText: "parking"
    };
    const dispatch = (activeCoordinator) => {
      const claim = repository.claimMessageEvent(
        actualInput.customerId,
        actualInput.channelId,
        actualInput.eventId,
        {
          lineUserId: actualInput.lineUserId,
          eventTimestamp: actualInput.eventTimestamp,
          guestMessage: actualInput.messageText
        }
      );
      if (!claim.claimed) {
        return Promise.resolve({
          shouldReply: false,
          noReply: true,
          duplicate: true
        });
      }
      return activeCoordinator.enqueue(actualInput);
    };

    const inFlight = dispatch(actualCoordinator);
    const concurrentReplay = await dispatch(actualCoordinator);
    assert.equal(
      concurrentReplay.duplicate,
      true,
      "the persisted atomic event claim must reject a replay while processing"
    );
    await actualScheduled();
    await inFlight;
    assert.equal(actualStateWrites, 1);
    assert.equal(
      repository.getConversationState(
        actualInput.customerId,
        actualInput.channelId,
        actualInput.lineUserId
      ).revision,
      1
    );

    let restartScheduled = false;
    const restartedCoordinator = new ConversationEngineV2Coordinator({
      ...coordinatorOptions,
      schedule: () => {
        restartScheduled = true;
        return 2;
      }
    });
    const afterRestart = await dispatch(restartedCoordinator);
    assert.equal(afterRestart.duplicate, true);
    assert.equal(restartScheduled, false);
    assert.equal(actualStateWrites, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    suite: "event-replay-state-contract",
    caseCount: 10,
    passCount: 10,
    failCount: 0
  }));
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
