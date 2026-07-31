"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createJsonProviders } = require("../lib/providers/json-providers");
const {
  createCustomReplyService,
  applyControlledReplyRules
} = require("../lib/custom-reply-rules");

const NOW = new Date("2026-07-30T04:00:00.000Z");
const activeRule = {
  name: "九月訂房公告",
  topic: "booking_open",
  scope: "all",
  stayStartDate: "2026-09-01",
  stayEndDate: "2026-09-30",
  effectiveStartDate: "2026-07-01",
  effectiveEndDate: "2026-09-30",
  approvedReply: "9 月住房目前尚未開放預訂，開放時間會另行公告。",
  enabled: true
};

function seedFile(tempDir) {
  const file = path.join(tempDir, "seed.json");
  fs.writeFileSync(file, JSON.stringify({
    seedDays: 5,
    homestays: [
      { customerId: "property_alpha", name: "Alpha", rooms: [{ id: "alpha_room", name: "Alpha Room", capacity: 2 }], safeFacts: {} },
      { customerId: "property_beta", name: "Beta", rooms: [{ id: "beta_room", name: "Beta Room", capacity: 4 }], safeFacts: {} }
    ]
  }), "utf8");
  return file;
}

function canonicalItem(taskId, capability, {
  canonicalId = null,
  category = "other",
  checkIn = null,
  checkOut = null
} = {}) {
  return {
    canonicalRequest: {
      taskId,
      capability,
      canonicalEntity: { canonicalId, category, canonicalSet: canonicalId ? [canonicalId] : [], status: canonicalId ? "resolved" : "generic", rawText: "" },
      temporalState: {
        resolutionStatus: checkIn ? "resolved" : "absent",
        checkIn,
        checkOut,
        searchRange: null
      }
    }
  };
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "junzan-custom-replies-"));
  try {
    const providers = createJsonProviders({
      dataFile: path.join(tempDir, "store.json"),
      seedFile: seedFile(tempDir),
      now: () => NOW
    });
    const service = createCustomReplyService({
      provider: providers.customReplies,
      customerSettings: providers.customerSettings,
      now: () => NOW
    });

    assert.deepEqual(service.list("property_alpha"), { used: 0, limit: 5, items: [] });
    const alphaRule = service.create("property_alpha", activeRule);
    assert.equal(alphaRule.propertyId, "property_alpha");
    assert.equal(alphaRule.state, "active");
    assert.equal(service.list("property_beta").used, 0, "Beta must not read Alpha rules");

    const disabled = service.create("property_alpha", {
      ...activeRule,
      name: "停用規則",
      topic: "temporary_operation",
      stayStartDate: "",
      stayEndDate: "",
      enabled: false
    });
    assert.equal(disabled.state, "disabled");
    const pending = service.create("property_alpha", {
      ...activeRule,
      name: "尚未生效",
      topic: "room",
      effectiveStartDate: "2026-08-01",
      effectiveEndDate: "2026-10-31",
      enabled: true
    });
    assert.equal(pending.state, "pending");
    const expired = service.create("property_alpha", {
      ...activeRule,
      name: "已失效",
      topic: "bundle",
      effectiveStartDate: "2026-01-01",
      effectiveEndDate: "2026-07-01",
      enabled: true
    });
    assert.equal(expired.state, "expired");

    const fifth = service.create("property_alpha", {
      ...activeRule,
      name: "第五條",
      topic: "price_unannounced",
      stayStartDate: "2026-10-01",
      stayEndDate: "2026-10-31"
    });
    assert.ok(fifth.ruleId);
    assert.throws(() => service.create("property_alpha", {
      ...activeRule,
      name: "第六條",
      topic: "parking_notice"
    }), (error) => error && error.code === "CUSTOM_REPLY_LIMIT_REACHED");

    assert.throws(() => service.create("property_beta", {
      ...activeRule,
      name: "日期倒置",
      stayStartDate: "2026-10-02",
      stayEndDate: "2026-10-01"
    }), (error) => error && error.code === "INVALID_CUSTOM_REPLY_DATE_RANGE");
    assert.throws(() => service.create("property_beta", {
      ...activeRule,
      name: "空白內容",
      approvedReply: "   "
    }), (error) => error && error.code === "CUSTOM_REPLY_TEXT_REQUIRED");
    assert.throws(() => service.create("property_beta", {
      ...activeRule,
      name: "不存在房型",
      scope: "room_type",
      roomTypeId: "missing_room"
    }), (error) => error && error.code === "CUSTOM_REPLY_ROOM_NOT_FOUND");

    const betaFirst = service.create("property_beta", {
      ...activeRule,
      name: "Beta 第一條",
      scope: "room_only"
    });
    assert.throws(() => service.create("property_beta", {
      ...activeRule,
      name: "Beta 重疊",
      scope: "room_only",
      stayStartDate: "2026-09-15",
      stayEndDate: "2026-10-15"
    }), (error) => error && error.code === "CUSTOM_REPLY_ACTIVE_OVERLAP");
    const scheduledReplacement = service.create("property_beta", {
      ...activeRule,
      name: "Beta 下一期公告",
      scope: "room_only",
      effectiveStartDate: "2026-10-01",
      effectiveEndDate: "2026-10-31"
    });
    assert.equal(scheduledReplacement.state, "pending", "non-overlapping effective periods may be scheduled");
    service.setEnabled("property_beta", betaFirst.ruleId, false);
    const betaReplacement = service.create("property_beta", {
      ...activeRule,
      name: "Beta 可啟用替代",
      scope: "room_only",
      stayStartDate: "2026-09-15",
      stayEndDate: "2026-10-15"
    });
    assert.equal(betaReplacement.state, "active");

    const unchangedOutcomes = [{ taskId: "parking", type: "parking", outcome: "answered", facts: { answer: "Alpha parking", source: "property_catalog", propertyId: "property_alpha" } }];
    assert.deepEqual(applyControlledReplyRules({
      rules: [],
      property: providers.customerSettings.getProperty("property_alpha"),
      canonicalItems: [canonicalItem("parking", "parking", { canonicalId: "parking", category: "transport" })],
      executionOutcomes: unchangedOutcomes,
      now: NOW
    }), unchangedOutcomes, "no rules must leave existing outcomes byte-for-byte unchanged");

    const mixed = applyControlledReplyRules({
      rules: [alphaRule, disabled, pending, expired],
      property: providers.customerSettings.getProperty("property_alpha"),
      canonicalItems: [
        canonicalItem("booking", "availability", { checkIn: "2026-09-10", checkOut: "2026-09-11" }),
        canonicalItem("parking", "parking", { canonicalId: "parking", category: "transport" })
      ],
      executionOutcomes: [
        { taskId: "booking", type: "availability", outcome: "no_availability", facts: { availability: "full", checkIn: "2026-09-10", source: "availability_provider", propertyId: "property_alpha" } },
        unchangedOutcomes[0]
      ],
      now: NOW
    });
    assert.equal(mixed[0].facts.customReply, activeRule.approvedReply);
    assert.equal(mixed[0].facts.customReplySource, "operator_approved_rule");
    assert.deepEqual(mixed[1], unchangedOutcomes[0], "parking must remain owned by property_catalog");

    const outsideStay = applyControlledReplyRules({
      rules: [alphaRule],
      property: providers.customerSettings.getProperty("property_alpha"),
      canonicalItems: [canonicalItem("booking", "availability", { checkIn: "2026-10-10", checkOut: "2026-10-11" })],
      executionOutcomes: [{ taskId: "booking", type: "availability", outcome: "no_availability", facts: { source: "availability_provider", propertyId: "property_alpha" } }],
      now: NOW
    });
    assert.equal(outsideStay[0].facts.customReply, undefined, "non-matching rule must leave the existing result unchanged");

    const formalPricingConflict = applyControlledReplyRules({
      rules: [fifth],
      property: providers.customerSettings.getProperty("property_alpha"),
      canonicalItems: [canonicalItem("price", "price", { checkIn: "2026-10-10", checkOut: "2026-10-11" })],
      executionOutcomes: [{
        taskId: "price",
        type: "price",
        outcome: "answered",
        facts: {
          availability: "available",
          prices: [{ inventory: { canonicalId: "alpha_room" }, total: 3200, currency: "TWD" }],
          source: "pricing_provider",
          propertyId: "property_alpha"
        }
      }],
      now: NOW
    });
    assert.equal(formalPricingConflict[0].outcome, "unknown");
    assert.equal(formalPricingConflict[0].reason, "custom_reply_formal_conflict");
    assert.equal(formalPricingConflict[0].facts.customReply, undefined, "a rule must not replace formal Resolver pricing");

    const edited = service.update("property_alpha", alphaRule.ruleId, { ...activeRule, approvedReply: "更新後公告" });
    assert.equal(edited.approvedReply, "更新後公告");
    assert.equal(service.remove("property_alpha", alphaRule.ruleId), true);
    assert.equal(service.list("property_alpha").items.some((item) => item.ruleId === alphaRule.ruleId), false);

    console.log(JSON.stringify({ suite: "custom-reply-rules", pass: true, assertions: 27 }));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
