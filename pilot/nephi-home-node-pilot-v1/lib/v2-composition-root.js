"use strict";

const { createTestOnlyOpenAiConversationPlannerFromEnv } = require("./providers/test-only-openai-conversation-planner");
const { createTestOnlyOpenAiControlledComposerFromEnv } = require("./providers/test-only-openai-controlled-composer");
const { ConversationEngineV2 } = require("./conversation-engine-v2/engine");
const { ConversationEngineV2Coordinator } = require("./conversation-engine-v2/coordinator");

function createV2CompositionRoot({ providers, service, env = process.env, now = () => new Date(), debounceMs = 2000, planner, composer, onDiagnostic, diagnosticDetail = false, testOnlyOverrides = null } = {}) {
  const overrides = testOnlyOverrides || {};
  const engine = new ConversationEngineV2({
    planner: overrides.planner || planner || createTestOnlyOpenAiConversationPlannerFromEnv({ env }),
    composer: overrides.composer || composer || createTestOnlyOpenAiControlledComposerFromEnv({ env }),
    persistence: overrides.persistence || providers.persistence,
    getProperty: overrides.getProperty || ((propertyId) => providers.customerSettings.getProperty(propertyId)),
    availabilityResolver: overrides.availabilityResolver || ((query) => service.searchAvailability(query)),
    availableDatesResolver: overrides.availableDatesResolver || ((query) => service.searchAvailableDates(query)),
    listPriceOverrides: (propertyId) => typeof providers.customerSettings.listInventoryPriceOverrides === "function" ? providers.customerSettings.listInventoryPriceOverrides(propertyId) : providers.customerSettings.listRoomPriceOverrides(propertyId),
    listDatePriceClassifications: (propertyId) => typeof providers.customerSettings.listDatePriceClassifications === "function" ? providers.customerSettings.listDatePriceClassifications(propertyId) : [],
    listCustomReplies: (propertyId) => providers.customReplies ? providers.customReplies.list(propertyId) : [],
    now,
    onDiagnostic: overrides.onDiagnostic || onDiagnostic,
    diagnosticDetail,
    diagnosticMetadata: { providerType: providers.kind || "unknown" }
  });
  return { engine, coordinator: new ConversationEngineV2Coordinator({ engine, debounceMs, externalReplyToken: true }) };
}

module.exports = { createV2CompositionRoot };
