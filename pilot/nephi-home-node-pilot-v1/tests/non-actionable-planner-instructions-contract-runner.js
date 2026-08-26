"use strict";

const assert = require("node:assert/strict");

const { instructions } = require("../lib/providers/test-only-openai-conversation-planner");

const generalActionabilityContract = "Only create an actionable task when the guest genuinely asks the system to answer a question or take an action. A status statement, completion notice, or confirmation that keeps the current arrangement unchanged is non-actionable when no safe antecedent is available; do not invent a new request from it.";
const substantiveNotificationContract = "A business notification that reports an operational event or change remains substantive even when it is not phrased as a question; preserve it as a controlled task. A genuine new question remains actionable.";
const nonActionableOutputContract = "For a non-actionable turn, set discourse to acknowledgement and shouldIgnore to true, emit only a generic unknown task required by the schema, and use relation_uncertain rather than new_request for that task.";
const substantiveOutputContract = "For a substantive business notification, set shouldIgnore to false and preserve an actionable controlled task with a new_request relation, even when the message is a statement rather than a question.";
const operationalLifecycleContract = "A statement that reports or requests a change in a transaction or reservation lifecycle and therefore requires operator verification or processing is a substantive notification: emit a human_help task with requestedOutputs handoff, shouldIgnore false, and a new_request relation, regardless of whether it contains a question.";
const lifecycleCompletionContract = "Treat a completion notice as non-actionable only when it does not report a transaction or reservation lifecycle event requiring operator verification; a lifecycle submission or completion remains substantive even when the guest states that it is already done.";

assert.equal(
  instructions().includes(generalActionabilityContract),
  true,
  "Planner instructions must distinguish genuine requests from non-actionable status, completion, and unchanged-arrangement statements"
);
assert.equal(
  instructions().includes(substantiveNotificationContract),
  true,
  "Planner instructions must preserve substantive operational notifications and genuine new questions"
);
assert.equal(instructions().includes(nonActionableOutputContract), true, "non-actionable output fields must not contradict the dialogue act");
assert.equal(instructions().includes(substantiveOutputContract), true, "substantive notification output fields must retain controlled handling");
assert.equal(instructions().includes(operationalLifecycleContract), true, "operator-verifiable lifecycle events must retain controlled handoff");
assert.equal(instructions().includes(lifecycleCompletionContract), true, "lifecycle completion must take precedence over generic completion silence");

console.log("non-actionable planner instructions contract: PASS");
