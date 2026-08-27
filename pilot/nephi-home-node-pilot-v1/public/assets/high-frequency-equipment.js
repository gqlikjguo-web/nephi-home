"use strict";

(function expose(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HighFrequencyEquipment = api;
})(typeof globalThis === "object" ? globalThis : this, function createEquipmentRegistry() {
  const groups = [
    { key: "basic", publicName: "住宿基本設備", items: [["parking", "停車"], ["wifi", "Wi-Fi"], ["tv", "電視"], ["refrigerator", "冰箱"], ["water_dispenser", "飲水機"], ["elevator", "電梯"], ["washing_machine", "洗衣機"], ["clothes_dryer", "烘衣機"]] },
    { key: "cooking", publicName: "廚房／餐飲", items: [["stove", "爐具"], ["cookware", "鍋具"], ["tableware", "餐具"]] },
    { key: "hygiene", publicName: "衛浴／盥洗", items: [["toiletries", "盥洗用品"]] },
    { key: "infant", publicName: "嬰幼兒設備", items: [["baby_crib", "嬰兒床"], ["baby_bathtub", "嬰兒澡盆"], ["baby_bottle_sterilizer", "消毒鍋"]] }
  ].map((group) => Object.freeze({
    key: group.key,
    publicName: group.publicName,
    items: Object.freeze(group.items.map(([canonicalId, publicName]) => Object.freeze({ canonicalId, publicName, group: group.key })))
  }));
  const HIGH_FREQUENCY_EQUIPMENT_GROUPS = Object.freeze(groups);
  const HIGH_FREQUENCY_EQUIPMENT = Object.freeze(groups.flatMap((group) => group.items));
  const byCanonicalId = new Map(HIGH_FREQUENCY_EQUIPMENT.map((item) => [item.canonicalId, item]));
  function equipmentByCanonicalId(canonicalId) { return byCanonicalId.get(String(canonicalId || "").trim().toLowerCase()) || null; }
  return Object.freeze({ HIGH_FREQUENCY_EQUIPMENT_GROUPS, HIGH_FREQUENCY_EQUIPMENT, equipmentByCanonicalId });
});
