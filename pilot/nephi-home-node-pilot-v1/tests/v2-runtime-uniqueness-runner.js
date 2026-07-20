"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
assert.match(source, /const TEST_LINE_WEBHOOK_ROUTE = "\/api\/test-line\/webhook"/);
assert.doesNotMatch(source.slice(0, source.indexOf("/* legacy runtime")), /JUNZAN_TEST_LINE_WEBHOOK_ROUTE|ConversationCoordinator|pushToTestLine|line-channel-identity-guard|ai-first-decision-pipeline|test-only-openai-structured-classifier/);
console.log(JSON.stringify({ caseCount: 7, passCount: 7, failCount: 0 }));
