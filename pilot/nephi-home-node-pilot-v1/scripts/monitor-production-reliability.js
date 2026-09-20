"use strict";
const { runMonitor } = require("../lib/production-reliability-monitor");

(async () => {
  const env = process.env;
  let databaseClient;
  if (env.PRODUCTION_MONITOR_DATABASE_URL) {
    const { Client } = require("pg");
    databaseClient = new Client({ connectionString: env.PRODUCTION_MONITOR_DATABASE_URL, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000 });
  }
  const report = await runMonitor({ apiKey: env.PRODUCTION_MONITOR_RENDER_API_KEY, ownerId: env.PRODUCTION_MONITOR_OWNER_ID,
    resourceId: env.PRODUCTION_MONITOR_SERVICE_ID, healthUrl: env.PRODUCTION_MONITOR_HEALTH_URL, databaseClient });
  // Only fixed alarm codes, counts and opaque diagnostic references are printed.
  // Do not log exceptions, raw Render logs, SQL rows, guest content or credentials.
  console.log(JSON.stringify(report));
  if (report.status === "ALERT") {
    console.error("::error title=JunZan production reliability::" + [...new Set(report.alerts.map(x => x.code))].join(", "));
    process.exitCode = 1;
  }
})().catch(() => { console.error("MONITOR_EXECUTION_FAILED"); process.exitCode = 1; });
