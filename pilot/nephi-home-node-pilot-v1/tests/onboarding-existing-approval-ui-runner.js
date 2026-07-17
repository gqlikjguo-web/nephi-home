"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const assetPath = path.resolve(__dirname, "../public/assets/admin-onboarding.js");
const asset = fs.readFileSync(assetPath, "utf8");
const checks = [];

function check(name, condition) {
  assert.ok(condition, name);
  checks.push(name);
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName).toUpperCase();
    this.childNodes = [];
    this.dataset = {};
    this.className = "";
    this.value = "";
    this.placeholder = "";
    this.disabled = false;
    this.hidden = false;
    this._text = "";
  }
  append(...nodes) {
    for (const node of nodes) {
      const child = typeof node === "string" ? new FakeText(node) : node;
      if (child) { child.parentNode = this; this.childNodes.push(child); }
    }
  }
  replaceChildren(...nodes) { this.childNodes = []; this._text = ""; this.append(...nodes); }
  set textContent(content) { this._text = String(content ?? ""); this.childNodes = []; }
  get textContent() { return this._text + this.childNodes.map((node) => node.textContent).join(""); }
  querySelectorAll(selector) {
    const match = selector.match(/^\[data-target-field="([^"]+)"\]$/), found = [];
    const visit = (node) => { if (match && node.dataset && node.dataset.targetField === match[1]) found.push(node); for (const child of node.childNodes || []) visit(child); };
    for (const child of this.childNodes) visit(child);
    return found;
  }
  focus() {}
  scrollIntoView() {}
}

class FakeText extends FakeElement {
  constructor(content) { super("#text"); this._text = String(content); }
}

class FakeOption extends FakeElement {
  constructor(label, value) { super("option"); this.textContent = label; this.value = value; }
}

function findAll(root, predicate, found = []) {
  if (predicate(root)) found.push(root);
  for (const child of root.childNodes || []) findAll(child, predicate, found);
  return found;
}

check(
  "唯一既有旅宿會在選擇 existing 模式後自動成為明確目標",
  asset.includes("propertyOptions.length===1") && asset.includes("existing.value=propertyOptions[0].propertyId")
);
check("第一階段按鈕只檢查核准內容，不直接宣稱核准", asset.includes("檢查核准內容"));
check("既有旅宿核准有獨立預覽且清楚標示尚未核准", asset.includes("renderExistingApprovalPreview") && asset.includes("尚未核准"));
check("預覽列出目標 property、將更新與不更新資料", asset.includes("目標 property") && asset.includes("將更新的資料") && asset.includes("不會更新的資料"));
check("預覽列出 room 與 bundle mapping 結果", asset.includes("房型對應結果") && asset.includes("方案對應結果"));
check("只有預覽內的二次確認按鈕會進入最終核准", asset.includes("最後確認並核准") && asset.includes("submitExistingApproval"));
check("最終核准按鈕在 propertyId 完全相符前保持停用", asset.includes("confirmPropertyId.oninput=()=>{finalButton.disabled=confirmPropertyId.value.trim()!==payload.propertyId;}"));
check(
  "更新範圍逐項揭露後端可能修改的欄位",
  asset.includes("旅宿名稱（display name）") &&
  asset.includes("聯絡人、電話、Email、地址、入住時間、退房時間") &&
  asset.includes("房型名稱、類型、容納人數、啟用狀態、四類價格") &&
  asset.includes("方案名稱、容納人數、啟用狀態、base price、四類價格") &&
  asset.includes("FAQ 問題、答案與 commonAnswers")
);

(async () => {
  const applications = new FakeElement("div"), message = new FakeElement("p"), refresh = new FakeElement("button"), requests = [];
  const document = {
    querySelector(selector) { return selector === "#applications" ? applications : selector === "#message" ? message : selector === "#refresh" ? refresh : null; },
    createElement(tagName) { return new FakeElement(tagName); },
    createTextNode(content) { return new FakeText(content); },
    execCommand() { return true; }
  };
  const context = vm.createContext({
    console,
    document,
    Option: FakeOption,
    window: { confirm: () => true, isSecureContext: false },
    navigator: {},
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      return { ok: true, async json() { return { data: { propertyId: "nephi_home", approvedAt: "2026-07-17T00:00:00.000Z" } }; } };
    }
  });
  const bootMarker = 'document.querySelector("#refresh").onclick=load;load();';
  vm.runInContext(`${asset.slice(0, asset.indexOf(bootMarker))}\nthis.__setPropertyOptions=(items)=>{propertyOptions=items;};this.__renderApplication=renderApplication;`, context);
  context.__setPropertyOptions([{ propertyId: "nephi_home", propertyName: "尼腓的家", rooms: [{ id: "room301", name: "301 雙人房" }], bundles: [{ id: "whole_house", name: "包棟" }] }]);
  const article = context.__renderApplication({ applicationId: "ui-test", status: "resubmitted", propertyName: "尼腓的家", email: "owner@example.test", rooms: [{ key: "source301", name: "301 雙人房" }], bundles: [{ key: "sourceBundle", name: "包棟", memberRoomKeys: ["source301"] }], knowledge: [] });
  const mode = findAll(article, (node) => node.tagName === "SELECT" && node.childNodes.some((option) => option.value === "existing"))[0];
  mode.value = "existing"; mode.onchange();
  check("DOM：選擇 existing 後立即顯示 nephi_home 與更新摘要", article.textContent.includes("目標 property：尼腓的家（nephi_home）") && article.textContent.includes("不會更新的資料"));
  const roomMapping = article.querySelectorAll('[data-target-field="targetRoomId"]')[0], bundleMapping = article.querySelectorAll('[data-target-field="targetBundleId"]')[0];
  roomMapping.value = "room301"; roomMapping.onchange(); bundleMapping.value = "whole_house"; bundleMapping.onchange();
  const previewButton = findAll(article, (node) => node.tagName === "BUTTON" && node.textContent === "檢查核准內容")[0];
  await previewButton.onclick();
  check("DOM：第一階段只產生預覽且不呼叫核准 API", requests.length === 0 && article.textContent.includes("尚未核准") && article.textContent.includes("房型對應結果"));
  const confirmInput = findAll(article, (node) => node.tagName === "INPUT" && node.placeholder === "輸入 nephi_home")[0], finalButton = findAll(article, (node) => node.tagName === "BUTTON" && node.textContent === "最後確認並核准")[0];
  confirmInput.value = "nephi_hom"; confirmInput.oninput();
  check("DOM：錯誤 propertyId 時最終核准保持停用", finalButton.disabled === true && requests.length === 0);
  confirmInput.value = "nephi_home"; confirmInput.oninput();
  check("DOM：正確 propertyId 才啟用最終核准", finalButton.disabled === false);
  await finalButton.onclick();
  const sent = JSON.parse(requests[0].options.body);
  check("DOM：最終確認後只送出一次完整 mapping 與 confirmPropertyId", requests.length === 1 && sent.propertyId === "nephi_home" && sent.confirmPropertyId === "nephi_home" && sent.roomMappings[0].targetRoomId === "room301" && sent.bundleMappings[0].targetBundleId === "whole_house");
  console.log(`${checks.length}/${checks.length} PASS`);
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
