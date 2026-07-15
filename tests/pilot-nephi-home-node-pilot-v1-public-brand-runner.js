"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const { createPublicBrand } = require(path.join(root, "config/public-brand"));
const { renderPublicHtml } = require(path.join(root, "lib/public-brand-html"));

const checks = [];
function check(name, value) {
  assert.ok(value, name);
  checks.push(name);
}

const brand = createPublicBrand({ PUBLIC_BASE_URL: "https://example.junzan.ai/" });
check("集中品牌名稱", brand.brandName === "JunZan AI");
check("公開基底網址正規化", brand.publicBaseUrl === "https://example.junzan.ai");

const banned = [/Nephi Home/i, /nephi-home/i, /Node Pilot/i, /test-only/i];
for (const file of ["onboarding.html", "admin-onboarding.html", "admin.html", "guest.html", "admin-setup.html"]) {
  const source = fs.readFileSync(path.join(root, "public", file), "utf8");
  const html = renderPublicHtml(source, brand);
  check(`${file} 顯示 JunZan AI`, html.includes("JunZan AI"));
  check(`${file} 無禁用平台名稱`, banned.every((pattern) => !pattern.test(html)));
  check(`${file} 無未解析品牌標記`, !html.includes("{{PUBLIC_"));
}

const guestHtml = renderPublicHtml(fs.readFileSync(path.join(root, "public/guest.html"), "utf8"), brand);
check("客人頁保留業者名稱容器", guestHtml.includes('id="propertyName"'));

console.log(`${checks.length}/${checks.length} PASS`);
