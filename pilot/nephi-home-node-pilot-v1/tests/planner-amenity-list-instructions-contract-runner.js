"use strict";

const assert = require("node:assert/strict");
const { instructions } = require("../lib/providers/test-only-openai-conversation-planner");

const prompt = instructions();

assert.ok(
  prompt.includes("A broad request for the collection or list of a property facility or amenity category must emit exactly one amenity_list task"),
  "Planner capability grammar must map a broad category collection request to exactly one amenity_list task"
);
assert.ok(
  prompt.includes("Explicit requests about distinct named subjects, statuses, fees, or conditions must remain separate individual tasks"),
  "Planner capability grammar must preserve explicit per-subject questions as individual tasks"
);

console.log("planner amenity_list instructions contract: PASS");
