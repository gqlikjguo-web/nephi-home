"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { createProviders } = require("../lib/providers/provider-factory");

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nephi-line-trace-pg-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "db") };
  let providers;
  try {
    const migration = await migratePostgres(connection);
    assert.equal(migration.files.at(-1), "021_test_only_line_message_traces.sql");
    assert.equal(migration.files.filter((file) => file.startsWith("021_")).length, 1);

    providers = createProviders({ databaseUrl: "pglite:test", postgresConnection: connection });
    const base = {
      propertyId: "nephi_home",
      channelIdHash: "a".repeat(64),
      eventId: "event-a",
      eventTimestamp: "2026-08-01T11:59:59.000Z",
      lineUserHash: "b".repeat(64),
      messageTextHash: "c".repeat(64),
      traceId: "trace-a",
      stages: { planner: { parserSucceeded: true } },
      expiresAt: "2026-08-04T12:00:00.000Z",
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-01T12:00:00.000Z"
    };

    providers.persistence.upsertTestOnlyLineTrace(base);
    providers.persistence.upsertTestOnlyLineTrace({
      ...base,
      stages: { final_decision: { action: "reply" } },
      updatedAt: "2026-08-01T12:01:00.000Z"
    });
    providers.persistence.upsertTestOnlyLineTrace({
      ...base,
      propertyId: "other_property",
      eventId: "event-b",
      traceId: "trace-b",
      lineUserHash: "d".repeat(64)
    });

    const active = providers.persistence.listTestOnlyLineTraces({
      propertyId: "nephi_home",
      now: "2026-08-01T12:01:00.000Z",
      messageTextHash: "c".repeat(64),
      limit: 20
    });
    assert.equal(active.length, 1);
    assert.equal(active[0].eventId, "event-a");
    assert.equal(active[0].lineUserHash, "b".repeat(64));
    assert.deepEqual(active[0].stages, {
      planner: { parserSucceeded: true },
      final_decision: { action: "reply" }
    });
    assert.equal(active[0].updatedAt, "2026-08-01T12:01:00.000Z");

    assert.equal(providers.persistence.listTestOnlyLineTraces({
      propertyId: "other_property",
      eventId: "event-a",
      now: "2026-08-01T12:01:00.000Z"
    }).length, 0, "property scope must be mandatory");
    assert.equal(providers.persistence.listTestOnlyLineTraces({
      propertyId: "nephi_home",
      now: "2026-08-04T12:00:00.001Z"
    }).length, 0, "expired traces must not be returned");

    console.log("test-only LINE message trace PostgreSQL: PASS");
  } finally {
    if (providers) await providers.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
