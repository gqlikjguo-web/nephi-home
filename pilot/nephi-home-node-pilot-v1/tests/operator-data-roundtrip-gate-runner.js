"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { createProviders } = require("../lib/providers/provider-factory");
const { openPostgres } = require("../lib/providers/postgres-client");
const { sessionTokenHash } = require("../lib/admin-auth");
const { createApp } = require("../server");
const { buildPropertyCatalog } = require("../lib/conversation-engine-v2/property-catalog");
const { resolveEntity } = require("../lib/conversation-engine-v2/entity-resolver");
const { buildFormalRequest, buildQueryPlan } = require("../lib/conversation-engine-v2/formal-request");
const { executeQueryPlan } = require("../lib/conversation-engine-v2/capability-executor");
const { buildResponsePlan } = require("../lib/conversation-engine-v2/response-planner");
const { composeControlledReply } = require("../lib/conversation-engine-v2/controlled-composer");
const { validateClaims } = require("../lib/conversation-engine-v2/claim-validator");
const { buildFinalDecision } = require("../lib/conversation-engine-v2/final-decision");

const PROPERTY_ALPHA = "property_alpha";
const PROPERTY_BETA = "property_beta";
const SESSION_TOKEN = "property-alpha-session";
const NOW = "2026-07-27T10:00:00+08:00";

const alphaFacts = Object.freeze([
  {
    canonicalId: "parking",
    category: "amenity",
    status: "conditional",
    appliesTo: "whole_property",
    publicText: "Alpha 停車需事先預約。",
    fees: [{ label: "停車費", amount: 100, currency: "TWD", unit: "vehicle" }],
    advanceNoticeRequired: true,
    reservationRequired: true,
    conditions: ["入住前完成預約"],
    restrictions: ["每房一台"],
    operatingHours: [],
    availablePeriods: [],
    notes: "",
    source: "operator_form",
    updatedAt: "2026-07-27T02:00:00.000Z"
  },
  {
    canonicalId: "bbq",
    category: "policy",
    status: "not_allowed",
    appliesTo: "whole_property",
    publicText: "Alpha 不提供烤肉。",
    fees: [],
    advanceNoticeRequired: false,
    reservationRequired: false,
    conditions: [],
    restrictions: [],
    operatingHours: [],
    availablePeriods: [],
    notes: "",
    source: "operator_form",
    updatedAt: "2026-07-27T02:00:00.000Z"
  },
  {
    canonicalId: "pool",
    category: "amenity",
    status: "allowed",
    appliesTo: "whole_property",
    publicText: "Alpha 設有戲水池。",
    fees: [],
    advanceNoticeRequired: false,
    reservationRequired: false,
    conditions: [],
    restrictions: ["兒童須由成人陪同"],
    operatingHours: [{ label: "每日", start: "09:00", end: "18:00" }],
    availablePeriods: [],
    notes: "",
    source: "operator_form",
    updatedAt: "2026-07-27T02:00:00.000Z"
  },
  {
    canonicalId: "location",
    category: "location",
    status: "allowed",
    appliesTo: "whole_property",
    publicText: "https://maps.app.goo.gl/AlphaProperty",
    fees: [],
    advanceNoticeRequired: false,
    reservationRequired: false,
    conditions: [],
    restrictions: [],
    operatingHours: [],
    availablePeriods: [],
    notes: "",
    source: "operator_form",
    updatedAt: "2026-07-27T02:00:00.000Z"
  },
  {
    canonicalId: "quiet_hours",
    category: "policy",
    status: "conditional",
    appliesTo: "whole_property",
    publicText: "Alpha 晚間請降低音量。",
    fees: [],
    advanceNoticeRequired: false,
    reservationRequired: false,
    conditions: [],
    restrictions: ["22:00 後降低音量"],
    operatingHours: [],
    availablePeriods: [],
    notes: "",
    source: "operator_form",
    updatedAt: "2026-07-27T02:00:00.000Z"
  },
  {
    canonicalId: "elevator",
    category: "amenity",
    status: "allowed",
    appliesTo: "whole_property",
    publicText: "Alpha 設有電梯。",
    fees: [],
    advanceNoticeRequired: false,
    reservationRequired: false,
    conditions: [],
    restrictions: [],
    operatingHours: [],
    availablePeriods: [],
    notes: "",
    source: "operator_form",
    updatedAt: "2026-07-27T02:00:00.000Z"
  },
  {
    canonicalId: "check_in",
    category: "policy",
    status: "allowed",
    appliesTo: "whole_property",
    publicText: "Alpha 入住時間為 15:00。",
    fees: [],
    advanceNoticeRequired: false,
    reservationRequired: false,
    conditions: [],
    restrictions: [],
    operatingHours: [{ label: "入住", start: "15:00", end: "20:00" }],
    availablePeriods: [],
    notes: "",
    source: "operator_form",
    updatedAt: "2026-07-27T02:00:00.000Z"
  },
  {
    canonicalId: "room_overview",
    category: "room_fact",
    status: "allowed",
    appliesTo: "room_only",
    publicText: "Alpha 房型依後台正式房型資料。",
    fees: [],
    advanceNoticeRequired: false,
    reservationRequired: false,
    conditions: [],
    restrictions: [],
    operatingHours: [],
    availablePeriods: [],
    notes: "",
    source: "operator_form",
    updatedAt: "2026-07-27T02:00:00.000Z"
  },
  {
    canonicalId: "room_amenities",
    category: "room_amenity",
    status: "allowed",
    appliesTo: "room_only",
    publicText: "Alpha 房內提供吹風機。",
    fees: [],
    advanceNoticeRequired: false,
    reservationRequired: false,
    conditions: [],
    restrictions: [],
    operatingHours: [],
    availablePeriods: [],
    notes: "",
    source: "operator_form",
    updatedAt: "2026-07-27T02:00:00.000Z"
  },
  {
    canonicalId: "contact",
    category: "contact",
    status: "allowed",
    appliesTo: "whole_property",
    publicText: "Alpha 請使用官方聯絡管道。",
    fees: [],
    advanceNoticeRequired: false,
    reservationRequired: false,
    conditions: [],
    restrictions: [],
    operatingHours: [],
    availablePeriods: [],
    notes: "",
    source: "operator_form",
    updatedAt: "2026-07-27T02:00:00.000Z"
  }
]);

const betaFacts = Object.freeze([{
  ...alphaFacts[0],
  publicText: "Beta 提供免費停車。",
  fees: [],
  reservationRequired: false
}]);

function taskFor(fact, index = 0) {
  const category = fact.category === "policy" ? "policy" : fact.category === "location" ? "transport" : "amenity";
  const type = fact.category === "policy" ? "policy" : fact.category === "location" ? "property_fact" : "amenity";
  return {
    candidateIndex: index,
    taskId: `${fact.canonicalId}-${index}`,
    type,
    detailIntent: "general",
    requestedOutputs: ["answer"],
    entity: {
      category,
      rawText: fact.canonicalId,
      canonicalCandidate: fact.canonicalId
    }
  };
}

function executeFact(property, fact) {
  const catalog = buildPropertyCatalog(property);
  const task = taskFor(fact);
  const resolvedEntity = resolveEntity(catalog, task.entity);
  const temporalResult = {
    resolutionStatus: "absent",
    checkIn: null,
    checkOut: null,
    nights: null,
    searchRange: null,
    fields: {}
  };
  const formalRequest = buildFormalRequest({
    property,
    task,
    requestCycleId: `cycle-${task.taskId}`,
    temporalResult,
    confirmedInputs: {
      stay: {},
      inventory: { mode: "any", entityId: null, entityIds: [], features: [] },
      topic: { detailIntent: "general" }
    },
    resolvedEntity
  });
  const queryPlan = buildQueryPlan(formalRequest);
  const outcome = executeQueryPlan({ property, catalog, queryPlan });
  const taskResult = {
    taskId: outcome.taskId,
    type: outcome.type,
    status: outcome.outcome === "answered" ? "answered" : "needs_human",
    facts: outcome.facts,
    review: outcome.outcome !== "answered"
  };
  const responsePlan = buildResponsePlan({
    propertyId: property.propertyId,
    taskResults: [taskResult],
    inputTaskIds: [task.taskId],
    reviewActions: []
  });
  const replyText = composeControlledReply(responsePlan);
  const claimValidation = validateClaims(replyText, responsePlan, [task.taskId]);
  const finalDecision = buildFinalDecision({ executionOutcomes: [outcome], claimValidation });
  return { catalog, task, formalRequest, queryPlan, outcome, responsePlan, replyText, claimValidation, finalDecision };
}

async function api(url, route, options = {}) {
  const response = await fetch(`${url}${route}`, {
    ...options,
    headers: {
      cookie: `nephi_admin_session=${SESSION_TOKEN}`,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  return { response, body };
}

(async () => {
  const runtime = path.join(__dirname, "../.runtime");
  fs.mkdirSync(runtime, { recursive: true });
  const temp = fs.mkdtempSync(path.join(runtime, "operator-roundtrip-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "db") };
  let providers;
  let app;
  try {
    await migratePostgres(connection);
    const client = await openPostgres(connection);
    await client.query(
      "INSERT INTO properties(property_id,display_name) VALUES($1,$2),($3,$4)",
      [PROPERTY_ALPHA, "Property Alpha", PROPERTY_BETA, "Property Beta"]
    );
    await client.query(
      "INSERT INTO property_settings(property_id,settings) VALUES($1,$2::jsonb),($3,$4::jsonb)",
      [PROPERTY_ALPHA, JSON.stringify({ commonAnswers: {} }), PROPERTY_BETA, JSON.stringify({ commonAnswers: {} })]
    );
    await client.query(
      "INSERT INTO room_types(property_id,room_id,name,capacity,type,description,position) VALUES($1,'alpha-room','Alpha Room',2,'double','',0),($2,'beta-room','Beta Room',2,'double','',0)",
      [PROPERTY_ALPHA, PROPERTY_BETA]
    );
    await client.close();

    providers = createProviders({ databaseUrl: "pglite:test", postgresConnection: connection });
    providers.persistence.getAdminSession = async (hash) => hash === sessionTokenHash(SESSION_TOKEN)
      ? { propertyId: PROPERTY_ALPHA, username: "owner" }
      : null;
    app = createApp({
      providers,
      adminAuthRequired: true,
      now: () => new Date(NOW),
      lineChannelIdentityGuardRequired: false,
      lineBindingEnv: {}
    });
    const running = await app.start(0, "127.0.0.1");

    const saveAlpha = await api(running.url, "/api/property-facts", {
      method: "PUT",
      body: JSON.stringify({ propertyId: PROPERTY_ALPHA, facts: alphaFacts })
    });
    assert.equal(saveAlpha.response.status, 200, "the operator payload must reach the property-scoped API");
    assert.deepEqual(saveAlpha.body.data.facts, alphaFacts);

    const forgedScope = await api(running.url, "/api/property-facts", {
      method: "PUT",
      body: JSON.stringify({ propertyId: PROPERTY_BETA, facts: betaFacts })
    });
    assert.equal(forgedScope.response.status, 403, "a property admin cannot forge another propertyId");

    const inspection = await openPostgres(connection);
    const alphaStored = await inspection.query(
      "SELECT settings->'propertyFacts' AS facts FROM property_settings WHERE property_id=$1",
      [PROPERTY_ALPHA]
    );
    assert.deepEqual(alphaStored.rows[0].facts, alphaFacts, "the normalized payload must be stored in PostgreSQL JSONB");
    await inspection.close();
    providers.customerSettings.updatePropertyFacts(PROPERTY_BETA, betaFacts);

    const readBack = await api(running.url, `/api/property-facts?propertyId=${PROPERTY_ALPHA}`);
    assert.equal(readBack.response.status, 200);
    assert.deepEqual(readBack.body.data.facts, alphaFacts, "read-back must return the stored property-scoped facts");

    const alpha = providers.customerSettings.getProperty(PROPERTY_ALPHA);
    const beta = providers.customerSettings.getProperty(PROPERTY_BETA);
    assert.deepEqual(alpha.propertyFacts, alphaFacts);
    assert.deepEqual(beta.propertyFacts, betaFacts);

    for (const fact of alphaFacts) {
      const result = executeFact(alpha, fact);
      assert.equal(result.task.entity.canonicalCandidate, fact.canonicalId);
      assert.equal(result.formalRequest.readiness.status, "ready");
      assert.equal(result.queryPlan.propertyId, PROPERTY_ALPHA);
      assert.equal(result.outcome.outcome, "answered");
      assert.equal(result.outcome.facts.source, "property_catalog");
      assert.equal(result.outcome.facts.propertyId, PROPERTY_ALPHA);
      assert.equal(result.outcome.facts.answer, fact.publicText);
      assert.equal(result.claimValidation.ok, true);
      assert.equal(result.finalDecision.action, "reply");
      assert.equal(
        fact.status === "not_allowed"
          ? result.replyText.includes("目前沒有提供")
          : result.replyText.includes(fact.publicText),
        true,
        `${fact.canonicalId} reply must reflect its property-scoped fact`
      );
      assert.equal(result.replyText.includes("Beta"), false);
    }

    const betaParking = executeFact(beta, betaFacts[0]);
    assert.equal(betaParking.replyText.includes("Beta 提供免費停車"), true);
    assert.equal(betaParking.replyText.includes("Alpha"), false);

    const updatedAlpha = alphaFacts.map((fact) => fact.canonicalId === "parking"
      ? { ...fact, publicText: "Alpha 更新後僅提供一個預約車位。" }
      : fact);
    const update = await api(running.url, "/api/property-facts", {
      method: "PUT",
      body: JSON.stringify({ propertyId: PROPERTY_ALPHA, facts: updatedAlpha })
    });
    assert.equal(update.response.status, 200);
    assert.equal(
      executeFact(providers.customerSettings.getProperty(PROPERTY_ALPHA), updatedAlpha[0]).replyText.includes("更新後"),
      true,
      "updated operator data must replace the old answer"
    );
    assert.equal(
      executeFact(providers.customerSettings.getProperty(PROPERTY_BETA), betaFacts[0]).replyText.includes("Beta 提供免費停車"),
      true,
      "updating Alpha must not change Beta"
    );

    const cleared = await api(running.url, "/api/property-facts", {
      method: "PUT",
      body: JSON.stringify({ propertyId: PROPERTY_ALPHA, facts: [] })
    });
    assert.equal(cleared.response.status, 200);
    assert.deepEqual(cleared.body.data.facts, []);
    assert.equal(
      buildPropertyCatalog(providers.customerSettings.getProperty(PROPERTY_ALPHA))
        .amenities.some((item) => item.canonicalId === "parking" && item.status === "confirmed_yes"),
      false,
      "clearing a fact must not leave a confirmed answer"
    );

    const invalid = await api(running.url, "/api/property-facts", {
      method: "PUT",
      body: JSON.stringify({
        propertyId: PROPERTY_ALPHA,
        facts: [{ ...alphaFacts[0], canonicalId: "invalid id with spaces", status: "invented" }]
      })
    });
    assert.equal(invalid.response.status, 400, "invalid structured facts must be rejected");

    console.log("operator data roundtrip gate: PASS");
  } finally {
    if (app) await app.stop();
    if (providers) await providers.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
