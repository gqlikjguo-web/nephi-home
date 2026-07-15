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
check("預設正式公開基底網址", createPublicBrand({}).publicBaseUrl === "https://app.junzanai.com");

const banned = [/Nephi Home/i, /nephi-home/i, /Node Pilot/i, /test-only/i];
for (const file of ["home.html", "onboarding.html", "admin-onboarding.html", "admin.html", "guest.html", "admin-setup.html"]) {
  const source = fs.readFileSync(path.join(root, "public", file), "utf8");
  const html = renderPublicHtml(source, brand);
  check(`${file} 顯示 JunZan AI`, html.includes("JunZan AI"));
  check(`${file} 無禁用平台名稱`, banned.every((pattern) => !pattern.test(html)));
  check(`${file} 無未解析品牌標記`, !html.includes("{{PUBLIC_"));
}

const guestHtml = renderPublicHtml(fs.readFileSync(path.join(root, "public/guest.html"), "utf8"), brand);
check("客人頁保留業者名稱容器", guestHtml.includes('id="propertyName"'));

const homeHtml = renderPublicHtml(fs.readFileSync(path.join(root, "public/home.html"), "utf8"), brand);
check("首頁提供業者登入", homeHtml.includes('href="/admin"'));
check("首頁提供新業者導入", homeHtml.includes('href="/onboarding"'));
check("首頁不含單一業者資料", !/尼腓的家|nephi_home|301|302|401|402/.test(homeHtml));

const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
check("根路由與客人查房分離", serverSource.includes('pathname === "/") return sendStatic(response, "home.html"') && serverSource.includes('pathname === "/guest") return sendStatic(response, "guest.html"'));
const adminOnboardingSource = fs.readFileSync(path.join(root, "public/assets/admin-onboarding.js"), "utf8");
check("對外邀請網址不使用瀏覽器來源硬編碼", !adminOnboardingSource.includes("location.origin"));

const renderYaml = fs.readFileSync(path.resolve(root, "../../render.yaml"), "utf8");
check("Render 設定正式公開基底網址", /key:\s*PUBLIC_BASE_URL\s+[\s\S]*?value:\s*https:\/\/app\.junzanai\.com/.test(renderYaml));

console.log(`${checks.length}/${checks.length} PASS`);
