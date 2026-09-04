"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.resolve(__dirname, "../public/admin.html"), "utf8");

assert.doesNotMatch(html, /<button[^>]+data-admin-tab="custom-replies"[^>]*>/, "desktop navigation must hide custom replies");
assert.doesNotMatch(html, /<option[^>]+value="custom-replies"[^>]*>/, "mobile navigation must hide custom replies");

const desktopTabs = [...html.matchAll(/<button[^>]+data-admin-tab="([^"]+)"[^>]*>/g)].map((match) => match[1]);
const mobileNavigation = html.match(/<select id="adminTabSelect">([\s\S]*?)<\/select>/);
assert.ok(mobileNavigation, "mobile navigation select must remain present");
const mobileTabs = [...mobileNavigation[1].matchAll(/<option[^>]+value="([^"]+)"[^>]*>/g)].map((match) => match[1]);
assert.deepEqual(desktopTabs, ["availability", "pricing", "bundles", "other"], "desktop tab order must remain unchanged apart from custom replies");
assert.deepEqual(mobileTabs, ["availability", "pricing", "bundles", "other"], "mobile tab order must remain unchanged apart from custom replies");

assert.match(html, /<section class="card custom-replies-card">/, "custom reply panel and its existing data flow must remain present");

console.log("admin custom reply navigation: PASS");
