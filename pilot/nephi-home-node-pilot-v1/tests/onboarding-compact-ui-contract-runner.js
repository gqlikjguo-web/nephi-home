"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.resolve(__dirname, "../public/onboarding.html"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../public/assets/onboarding.css"), "utf8");
const js = fs.readFileSync(path.resolve(__dirname, "../public/assets/onboarding.js"), "utf8");

const expectedSteps = ["1 基本資料", "2 房型價格", "3 包棟", "4 設備", "5 規則", "6 確認送出"];
for (const label of expectedSteps) {
  assert.ok(html.includes(label), `visible progress must include ${label}`);
}
assert.match(html, /<nav id="steps"[^>]*aria-label="填寫進度"/);
assert.match(js, /aria-current/);
assert.match(js, /data-step-index/);

assert.match(html, /class="basic-grid"/);
assert.match(css, /\.basic-grid\{[^}]*grid-template-columns:repeat\(2/);
assert.match(css, /@media\(max-width:640px\)[\s\S]*\.basic-grid\{grid-template-columns:1fr/);
assert.match(css, /\.actions\{[^}]*position:sticky/);
assert.match(css, /padding-bottom:[^;}]*rem/);

assert.match(js, /<details class="entry-card room-card"/);
assert.match(js, /<details class="entry-card bundle-card"/);
assert.match(js, /<details class="knowledge-card"/);
assert.match(js, /<details class="preview-group"/);
assert.match(js, /<summary>[^<]*房型/);

for (const name of ["propertyName", "aiName", "contactName", "phone", "email", "address", "googleMapsUrl", "checkInTime", "latestArrivalTime", "checkOutTime", "hasOfficialAccount", "contactLink"]) {
  assert.ok(html.includes(`name="${name}"`), `existing field name must remain ${name}`);
}
for (const forbidden of ["Canonical ID", "category", "credential", "token"]) {
  assert.equal(html.includes(forbidden), false, `guest-facing onboarding must not expose ${forbidden}`);
}

console.log("onboarding compact UI contract: PASS");
