"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public/admin.html"), "utf8");
const script = fs.readFileSync(path.join(root, "public/assets/admin.js"), "utf8");

assert.match(html, /id="guestFrontendLink"[^>]*>查看我的前台<\/a>/);
assert.match(html, /id="copyGuestFrontendLink"[^>]*>複製前台連結<\/button>/);
assert.doesNotMatch(html, /id="firstSetupForm"|第一次登入／設定密碼|寄送設定密碼連結/);
assert.match(script, /new URL\(`\/\$\{encodeURIComponent\(propertyId\)\}`\s*,\s*location\.origin\)/, "guest URL uses the selected session property and existing guest slug route");
assert.match(script, /configureGuestFrontendLinks\(value\.propertyId\)/, "the link updates after the authenticated property is selected");
assert.match(script, /navigator\.clipboard\.writeText\(guestFrontendUrl\(session\.propertyId\)\)/, "copy uses the same selected-property URL");
assert.doesNotMatch(script, /dream171|nephi_home/, "no property is hard-coded");
assert.doesNotMatch(script, /firstSetupForm|\/api\/admin\/setup-link/, "removed login UI has no client handler");

console.log("admin guest frontend link: PASS");
