"use strict";
const { analyze, runMonitor } = require("../lib/production-reliability-monitor");

(async () => {
  const env = process.env;
  const alertTest = env.PRODUCTION_MONITOR_ALERT_TEST === "true";
  let databaseClient;
  if (!alertTest && env.PRODUCTION_MONITOR_DATABASE_URL) {
    const { Client } = require("pg");
    databaseClient = new Client({ connectionString: env.PRODUCTION_MONITOR_DATABASE_URL, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000 });
  }
  // Explicit manual drill: synthetic metadata only, no network or DB access.
  const drill = alertTest ? analyze({ rows: [{ ref: "synthetic-alert-drill", property_id: "monitor-test", processing_status: "reply_failed", created_at: new Date().toISOString() }] }) : null;
  const report = alertTest ? { ...drill, testOnly: true, status: drill.alerts.length ? "ALERT" : "NO_ALERT" } : await runMonitor({ apiKey: env.PRODUCTION_MONITOR_RENDER_API_KEY, ownerId: env.PRODUCTION_MONITOR_OWNER_ID,
    resourceId: env.PRODUCTION_MONITOR_SERVICE_ID, healthUrl: env.PRODUCTION_MONITOR_HEALTH_URL, databaseClient });
  // Only fixed alarm codes, counts and opaque diagnostic references are printed.
  // Do not log exceptions, raw Render logs, SQL rows, guest content or credentials.
  console.log(JSON.stringify(report));
  if (report.status === "ALERT") {
    console.error("::error title=" + (alertTest ? "JunZan monitor alert drill (synthetic; production unaffected)" : "JunZan production reliability") + "::" + [...new Set(report.alerts.map(x => x.code))].join(", "));
    process.exitCode = 1;
  }
})().catch(() => { console.error("MONITOR_EXECUTION_FAILED"); process.exitCode = 1; });
