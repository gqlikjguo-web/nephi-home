"use strict";

function money(value) { return new Intl.NumberFormat("zh-TW").format(value); }
function composeSection(section) {
  const facts = section.facts || {};
  if (section.status === "needs_clarification") return section.question || "可以再補充一下嗎？";
  if (["needs_human", "property_data_missing", "failed"].includes(section.status)) return facts.subject ? `${facts.subject}這部分需要請業者確認。` : "這部分需要請業者確認。";
  if (facts.availableInventory) return facts.availableInventory.length ? `${facts.checkIn} 入住可選：${facts.availableInventory.map((item) => item.publicName).join("、")}。` : `${facts.checkIn} 入住目前沒有符合條件的空房。`;
  if (facts.availableDates) return facts.availableDates.length ? `這段期間可查詢的日期有：${facts.availableDates.join("、")}。` : "這段期間目前沒有可售日期。";
  if (facts.prices) {
    if (facts.availability === "full") return `${facts.checkIn} 入住目前已滿房。`;
    return facts.prices.map((item) => item.total === null ? `${item.inventory.publicName}價格需要請業者確認。` : `${item.inventory.publicName}共 ${money(item.total)} ${item.currency}。`).join(" ");
  }
  if (facts.amenities) return facts.amenities.length ? `目前確認的主要設備有：${facts.amenities.join("、")}。` : "設備資料需要請業者確認。";
  if (facts.status === "confirmed_yes") return facts.answer || `${facts.subject}有提供。`;
  if (facts.status === "confirmed_no") return `${facts.subject}目前沒有提供。`;
  if (facts.answer) return facts.answer;
  return "這部分需要請業者確認。";
}
function composeControlledReply(plan) { const reply = plan.sections.map(composeSection).filter(Boolean).join("\n"); return (reply || "這個問題需要請業者確認，我會為您轉交。").slice(0, plan.maxLength || 1200); }

module.exports = { composeControlledReply };
