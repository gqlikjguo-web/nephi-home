"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName).toUpperCase();
    this.childNodes = [];
    this.className = "";
    this.href = "";
    this.hidden = false;
    this._text = "";
  }
  append(...nodes) { this.childNodes.push(...nodes.filter(Boolean)); }
  replaceChildren(...nodes) { this.childNodes = nodes.filter(Boolean); }
  set textContent(value) { this._text = String(value ?? ""); this.childNodes = []; }
  get textContent() { return this._text + this.childNodes.map((node) => node.textContent || "").join(""); }
  addEventListener() {}
}

function browserContext() {
  const elements = new Map();
  const document = {
    body: { dataset: {} },
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, new FakeElement());
      return elements.get(selector);
    },
    getElementById(id) {
      if (!elements.has(`#${id}`)) elements.set(`#${id}`, new FakeElement());
      return elements.get(`#${id}`);
    },
    createElement(tagName) { return new FakeElement(tagName); },
    createTextNode(value) { const node = new FakeElement("#text"); node.textContent = value; return node; }
  };
  return vm.createContext({
    console,
    document,
    fetch: async () => { throw new Error("network is not used by the component contract"); },
    location: { search: "", pathname: "/" },
    navigator: {},
    Option: class extends FakeElement {},
    URLSearchParams,
    window: { location: { origin: "https://example.test" }, confirm: () => true, isSecureContext: false }
  });
}

function loadFunctions(file, bootMarker, exports) {
  const source = fs.readFileSync(path.resolve(__dirname, `../public/assets/${file}`), "utf8");
  const markerIndex = source.indexOf(bootMarker);
  assert.notEqual(markerIndex, -1, `${file} boot marker must remain explicit`);
  const context = browserContext();
  vm.runInContext(`${source.slice(0, markerIndex)}\n${exports.map((name) => `this.__${name}=${name};`).join("")}`, context);
  return context;
}

const platform = loadFunctions(
  "admin-platform.js",
  'document.querySelector("#refresh").addEventListener("click", load);',
  ["summaryCard"]
);
for (const [label, href] of [
  ["正式業者數", "#properties"],
  ["待審核申請數", "/admin/onboarding?filter=pending"],
  ["LINE 已啟用數", "/admin/line-connections?filter=enabled"],
  ["LINE 尚未啟用數", "/admin/line-connections?filter=disabled"]
]) {
  const card = platform.__summaryCard(label, 0, "summary-test", href);
  assert.equal(card.tagName, "A", `${label} must be keyboard-operable link content even when zero`);
  assert.equal(card.href, href);
}

const onboarding = loadFunctions(
  "admin-onboarding.js",
  'document.querySelector("#refresh").onclick=load;load();',
  ["applicationView"]
);
const applications = [
  { applicationId: "draft", status: "draft" },
  { applicationId: "submitted", status: "submitted" },
  { applicationId: "resubmitted", status: "resubmitted" },
  { applicationId: "approved", status: "approved" }
];
assert.deepEqual(
  JSON.parse(JSON.stringify(onboarding.__applicationView(applications, "pending"))),
  {
    items: [applications[1], applications[2]],
    label: "目前查看：待審核申請",
    emptyText: "目前沒有待審核申請。"
  }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(onboarding.__applicationView(applications, ""))).items.map((item) => item.applicationId),
  ["draft", "submitted", "resubmitted", "approved"]
);
assert.equal(onboarding.__applicationView([], "pending").emptyText, "目前沒有待審核申請。");

const line = loadFunctions(
  "admin-line-connections.js",
  '$("createForm").onsubmit',
  ["connectionView"]
);
const connections = [
  { propertyId: "enabled", enabled: true },
  { propertyId: "disabled", enabled: false }
];
assert.deepEqual(
  JSON.parse(JSON.stringify(line.__connectionView(connections, "enabled"))),
  { items: [connections[0]], label: "目前查看：LINE 已啟用", emptyText: "目前沒有已啟用的 LINE 串接。" }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(line.__connectionView(connections, "disabled"))),
  { items: [connections[1]], label: "目前查看：LINE 尚未啟用", emptyText: "目前沒有尚未啟用的 LINE 串接。" }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(line.__connectionView(connections, ""))).items.map((item) => item.propertyId),
  ["enabled", "disabled"]
);

console.log("platform admin filter navigation: PASS");
