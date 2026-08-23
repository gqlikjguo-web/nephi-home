"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMvpService } = require("../lib/mvp-service");
const { formatSafeTestOnlyConversationTrace } = require("../server");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createPostgresProviders } = require("../lib/providers/postgres-providers");

async function insertLogs(client, propertyId, count) {
  await client.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)", [propertyId, propertyId]);
  await client.query(
    `INSERT INTO message_logs(property_id,channel_id,event_id,review_id,line_user_id,processing_status,status,needs_review,payload,created_at,updated_at)
     SELECT $1,'line','event-'||n,'review-'||n,'user-'||n,'reply_succeeded',
       CASE WHEN n % 2 = 0 THEN 'pending' ELSE 'resolved' END,
       n % 2 = 0,
       jsonb_build_object(
         'reviewId','review-'||n,
         'guestId','guest-'||n,
         'lineUserId','user-'||n,
         'guestMessage','question-'||n,
         'replyText','reply-'||n,
         'reviewNote','review-note-'||n,
         'decisionReason','decision-'||n,
         'processingStatus','reply_succeeded',
         'status',CASE WHEN n % 2 = 0 THEN 'pending' ELSE 'resolved' END,
         'createdAt',(timestamp '2026-08-01 00:00:00+00' + n * interval '1 second')::text,
         'padding',repeat('x',4096),
         'token','must-not-be-returned',
         'rawOpenAiPrompt','must-not-be-returned'
       ),
       timestamp '2026-08-01 00:00:00+00' + n * interval '1 second',
       timestamp '2026-08-01 00:00:00+00' + n * interval '1 second'
     FROM generate_series(1,$2::integer) AS n`,
    [propertyId, count]
  );
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "admin-reviews-bounded-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "database") };
  let providers;
  try {
    await migratePostgres(connection);
    const client = await openPostgres(connection);
    await insertLogs(client, "nephi_home", 1500);
    await insertLogs(client, "other_home", 120);
    await client.query(
      `UPDATE message_logs
       SET payload=jsonb_set(payload,'{safeTrace}',(
         SELECT jsonb_agg(jsonb_build_object(
           'scope','conversation-engine-v2',
           'traceId','11111111-1111-4111-8111-111111111111',
           'propertyId',$1,
           'stage','planner',
           'taskCount',stage_number,
           'rawOpenAiPrompt','must-not-be-returned',
           'credential','must-not-be-returned',
           'rawOpenAiResponse','must-not-be-returned'
         ) ORDER BY stage_number)
         FROM generate_series(1,45) AS stages(stage_number)
       ))
       WHERE property_id=$1 AND review_id='review-1500'`,
      ["nephi_home"]
    );
    await client.query(
      `UPDATE message_logs
       SET payload=jsonb_set(payload,'{safeTrace,44}',jsonb_build_object(
         'scope','conversation-engine-v2',
         'traceId','11111111-1111-4111-8111-111111111111',
         'propertyId',$1,
         'stage','claim_validator',
         'errors',jsonb_build_array('forbidden_claim','ungrounded_section_text','unknown-private-value',42,jsonb_build_object('token','must-not-be-returned')),
         'coveredTaskIds',jsonb_build_array('task-a'),
         'missingTaskIds',jsonb_build_array('task-b'),
         'unexpectedTaskIds',jsonb_build_array('task-c'),
         'guestMessage','must-not-be-returned',
         'replyText','must-not-be-returned',
         'answer','must-not-be-returned',
         'sourceText','must-not-be-returned',
         'evidence','must-not-be-returned',
         'credential','must-not-be-returned'
       ))
       WHERE property_id=$1 AND review_id='review-1500'`,
      ["nephi_home"]
    );
    await client.close();

    providers = createPostgresProviders(connection);
    const service = createMvpService(providers, { safeTraceFormatter: formatSafeTestOnlyConversationTrace });

    const defaults = service.listReviews("nephi_home", "all");
    assert.equal(defaults.length, 50, "reviews must default to a bounded 50-row provider query");
    assert.equal(defaults[0].reviewId, "review-1500", "reviews must be ordered by created_at DESC in persistence");
    assert.equal(defaults.at(-1).reviewId, "review-1451", "the provider limit must apply after descending order");

    const pending = service.listReviews("nephi_home", "pending", 1000);
    assert.equal(pending.length, 100, "reviews must clamp the requested limit to 100");
    assert.ok(pending.every((item) => item.status === "pending"), "status filtering must occur in persistence");
    assert.equal(pending[0].reviewId, "review-1500");
    assert.equal(pending.at(-1).reviewId, "review-1302");

    const isolated = service.listReviews("other_home", "all", 100);
    assert.equal(isolated.length, 100, "the bounded query must retain property isolation");
    assert.equal(isolated[0].reviewId, "review-120");

    assert.deepEqual(
      Object.keys(defaults[0]).sort(),
      ["availableActions", "createdAt", "decisionReason", "guestId", "guestMessage", "lineUserId", "ownerAction", "processingStatus", "replyText", "reviewId", "reviewReason", "safeTrace", "status"].sort(),
      "reviews must expose only the existing admin fields plus safe processing diagnostics"
    );
    assert.equal(defaults[0].safeTrace.length, 40, "reviews must cap persisted safe traces at the newest 40 stages");
    assert.equal(defaults[0].safeTrace[0].taskCount, 6, "reviews must retain the newest bounded stages");
    assert.deepEqual(defaults[0].safeTrace.at(-1), {
      scope: "conversation-engine-v2",
      traceId: "11111111-1111-4111-8111-111111111111",
      propertyId: "nephi_home",
      stage: "claim_validator",
      sectionCount: undefined,
      coveredTaskIds: ["task-a"],
      missingTaskIds: ["task-b"],
      replyLength: undefined,
      composerSource: "",
      validationResult: "",
      errors: ["forbidden_claim", "ungrounded_section_text"]
    }, "reviews must retain only allowlisted claim-validator errors and existing safe coverage fields");
    const serialized = JSON.stringify(defaults);
    for (const forbidden of ["must-not-be-returned", "rawOpenAiPrompt", "rawOpenAiResponse", "credential", "padding"]) {
      assert.equal(serialized.includes(forbidden), false, `reviews leaked ${forbidden}`);
    }

    console.log(JSON.stringify({ caseCount: 4, passCount: 4, failCount: 0 }));
    console.log("admin reviews bounded query: PASS");
  } finally {
    if (providers) await providers.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
