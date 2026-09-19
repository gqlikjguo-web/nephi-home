"use strict";

// Validation owns the permitted availability grammar independently of the
// renderer. Do not import controlled-composer or use its output as an oracle.
function validateAvailabilityReply(section, text) {
  if (!["availability", "bundle_availability"].includes(section.type)) return null;
  const facts = section.facts || {};
  const missing = section.claimType === "EPISTEMIC_UNKNOWN"
    && section.unknownProvenance?.sourceReasonCode === "missing_inventory_records";
  if (!missing && (!facts.checkIn || section.status && section.status !== "answered")) return null;
  const checkIn = missing ? section.unknownProvenance?.resolverProvenance?.readEvidence?.from : facts.checkIn;
  if (!checkIn) return ["availability_reply_date_missing"];
  const value = String(text || "").trim();
  const errors = [];
  if (!value.includes(checkIn)) errors.push("availability_reply_date_missing");
  if (["房況資料尚未完整", "目前無法確認", "請稍後再試", "直接與我們聯繫"].some(phrase => value.includes(phrase))) {
    errors.push("availability_reply_forbidden");
  }
  let body;
  if (missing || section.outcomeStatus === "no_availability") {
    body = checkIn + " 入住目前沒有可提供的房型，歡迎查看其他日期，謝謝您。";
  } else {
    const amount = number => new Intl.NumberFormat("zh-TW").format(number);
    const prices = facts.prices?.map(item => item.total === null
      ? item.inventory.publicName + "價格需要請業者確認。"
      : item.inventory.publicName + "共 " + amount(item.total) + " " + (item.currency === "TWD" ? "元" : item.currency) + "。").join("\n");
    if (facts.priceBasis === "registered_rate" && facts.prices) body = checkIn + " 登錄房價：\n" + prices;
    else if (facts.prices && facts.availability === "full") body = checkIn + " 入住目前已滿房。";
    else if (facts.prices) body = (facts.availability === "available" ? checkIn + " 入住\n目前可預訂。\n" : "") + prices;
    else if (Array.isArray(facts.availableInventory)) body = facts.availableInventory.length
      ? checkIn + " 入住可選：" + facts.availableInventory.map(item => item.publicName).join("、") + "。"
      : checkIn + " 入住目前沒有符合條件的空房。";
    else return errors.length ? errors : null;
  }
  // no_availability means no matching offer, not necessarily closed inventory.
  // The Resolver's independent capacity facts retain their specific meaning.
  if (facts.feasibility?.inventoryStatus === "available" && facts.feasibility.capacityStatus === "insufficient") {
    const capacity = checkIn + " 仍有空房，但目前可用房源無法在指定房數內容納這次入住人數，請調整房數或入住人數。";
    body = facts.priceBasis === "registered_rate" ? capacity + "\n" + body : capacity;
  }
  if (facts.customReply) body = facts.customReply + "\n" + body;
  if (section.fulfillmentStatus === "partial") body = "目前只確認符合需求的商品有 " + section.matchedCount + "/" + section.requestedQuantity
    + " 個，尚差 " + section.unresolvedRemainder + " 個。\n" + body;
  const meaning = value => String(value).normalize("NFKC").toLocaleLowerCase("zh-TW").replace(/[^\p{L}\p{N}]+/gu, "");
  if (meaning(value) !== meaning(body)) errors.push("availability_reply_contract_mismatch");
  return [...new Set(errors)];
}

module.exports = { validateAvailabilityReply };
