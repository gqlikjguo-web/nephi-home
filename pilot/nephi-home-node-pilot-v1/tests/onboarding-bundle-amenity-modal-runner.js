"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const asset = fs.readFileSync(path.resolve(__dirname, "../public/assets/onboarding.js"), "utf8");
const bootMarker = "(async()=>{populateTimes();";
assert.notEqual(asset.indexOf(bootMarker), -1, "onboarding boot marker must remain available");

class FakeElement {
  constructor() {
    this.dataset = {};
    this.value = "";
    this.textContent = "";
    this.hidden = false;
    this.open = false;
    this.onclick = null;
    this.onchange = null;
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() {}
}

const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, new FakeElement());
  return elements.get(id);
}

for (const id of [
  "form", "message", "errors", "equipmentFacts", "addRoom", "addBundle", "save", "next", "previous", "submit",
  "onboardingAmenityEditor", "onboardingAmenityEditorTitle", "onboardingAmenityEditorCancel", "onboardingAmenityName",
  "onboardingAmenityStatus", "onboardingAmenityDetail", "onboardingAmenityDetailField", "onboardingAmenityDelete",
  "onboardingAmenitySave"
]) element(id);

const nameLabel = new FakeElement();
const statusLabel = new FakeElement();
const amenityRow = new FakeElement();
amenityRow.dataset = {
  amenityKey: "singing",
  amenityName: "KTV／歡唱設備",
  amenityStatus: "unknown",
  amenityNote: "",
  customAmenity: "false"
};
amenityRow.querySelector = (selector) => selector === "span" ? nameLabel : selector === "strong" ? statusLabel : null;

const bundleElement = new FakeElement();
bundleElement.querySelectorAll = (selector) => selector === "[data-amenity-key]" ? [amenityRow] : [];

const document = {
  querySelector(selector) { return selector.startsWith("#") ? element(selector.slice(1)) : null; },
  querySelectorAll(selector) { return selector === "[data-bundle]" ? [bundleElement] : []; },
  createElement() { return new FakeElement(); }
};

const context = vm.createContext({
  console,
  document,
  OnboardingEquipmentFacts: {
    drafts: () => [],
    render: () => {},
    collect: (_container, facts) => facts,
    missingFields: () => [],
    appendPreview: () => {}
  },
  crypto: { randomUUID: () => "preview-id" },
  clearTimeout,
  setTimeout,
  FormData,
  URL,
  URLSearchParams
});

vm.runInContext(`${asset.slice(0, asset.indexOf(bootMarker))}
this.__openOnboardingAmenityEditor=openOnboardingAmenityEditor;
this.__setBundles=value=>{bundles=value;};
this.__getBundles=()=>bundles;`, context);

context.__setBundles([{
  key: "bundle-a",
  memberRoomKeys: [],
  entertainmentAmenities: []
}]);

context.__openOnboardingAmenityEditor(amenityRow, 0);
assert.equal(element("onboardingAmenityEditor").open, true);
element("onboardingAmenityEditorCancel").onclick();
assert.equal(element("onboardingAmenityEditor").open, false, "關閉必須立即關閉 modal");
assert.equal(amenityRow.dataset.amenityStatus, "unknown", "關閉不得改變目前設備狀態");

context.__openOnboardingAmenityEditor(amenityRow, 0);
element("onboardingAmenityStatus").value = "yes";
element("onboardingAmenityStatus").onchange();
assert.equal(element("onboardingAmenityDetailField").hidden, false, "選擇有時必須能填對客詳細說明");
element("onboardingAmenityDetail").value = "使用至 22:00，請提前預約。";
element("onboardingAmenitySave").onclick();

assert.equal(element("onboardingAmenityEditor").open, false, "套用後必須關閉 modal");
assert.equal(amenityRow.dataset.amenityStatus, "yes");
assert.equal(amenityRow.dataset.amenityNote, "使用至 22:00，請提前預約。");
assert.equal(statusLabel.textContent, "有", "目前包棟設備畫面必須立即顯示新狀態");
assert.equal(context.__getBundles()[0].entertainmentAmenities[0].provided, true, "本機記憶體必須同步狀態");
assert.equal(context.__getBundles()[0].entertainmentAmenities[0].note, "使用至 22:00，請提前預約。", "本機記憶體必須同步對客說明");

console.log("onboarding bundle amenity modal UI: PASS");
