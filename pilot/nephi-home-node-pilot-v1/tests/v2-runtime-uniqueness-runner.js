"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
const runtime = source.slice(0, source.indexOf("/* legacy runtime"));
const root = fs.readFileSync(path.resolve(__dirname, "../lib/v2-composition-root.js"), "utf8");

assert.match(runtime, /const TEST_LINE_WEBHOOK_ROUTE = "\/api\/test-line\/webhook"/);
assert.equal((runtime.match(/TEST_LINE_WEBHOOK_ROUTE/g) || []).length, 2, "only one LINE webhook route may be registered");
assert.doesNotMatch(runtime, /JUNZAN_TEST_LINE_WEBHOOK_ROUTE|\/api\/junzan-test-line\/webhook|\/api\/test-line\/resolve/);
assert.doesNotMatch(runtime, /ConversationCoordinator|pushToTestLine|line-channel-identity-guard|ai-first-decision-pipeline|test-only-openai-structured-classifier/);
assert.equal((root.match(/new ConversationEngineV2\(/g) || []).length, 1, "composition root creates one V2 engine");
assert.equal((root.match(/new ConversationEngineV2Coordinator\(/g) || []).length, 1, "composition root creates one V2 coordinator");
assert.doesNotMatch(runtime, /reply.*push|push.*reply/i, "LINE transport must not retain a push fallback");
console.log(JSON.stringify({ caseCount: 7, passCount: 7, failCount: 0 }));
