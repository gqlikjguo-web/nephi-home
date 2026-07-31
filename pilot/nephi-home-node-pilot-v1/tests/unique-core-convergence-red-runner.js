"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const plannerSchema = fs.readFileSync(
  path.join(__dirname, "../lib/conversation-engine-v2/planner-schema.js"),
  "utf8"
);

assert.doesNotMatch(
  plannerSchema,
  /function uniquelyResolvedCatalogEntityFromSource\(/,
  "Planner semantic normalization must not route catalog entities by scanning the full source text for aliases"
);

for (const canonicalId of ["parking", "pool", "location"]) {
  assert.doesNotMatch(
    plannerSchema,
    new RegExp(`canonicalCandidate === ["']${canonicalId}["']\\) \\{`),
    `Planner semantic normalization must not contain a ${canonicalId}-specific route`
  );
}

console.log(JSON.stringify({
  suite: "unique-core-convergence-red",
  caseCount: 4,
  passCount: 4,
  failCount: 0
}));
