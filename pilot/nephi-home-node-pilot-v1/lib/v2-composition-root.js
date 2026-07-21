"use strict";

const { createTestOnlyOpenAiConversationPlannerFromEnv } = require("./providers/test-only-openai-conversation-planner");
const { createTestOnlyOpenAiControlledComposerFromEnv } = require("./providers/test-only-openai-controlled-composer");
const { ConversationEngineV2 } = require("./conversation-engine-v2/engine");
const { ConversationEngineV2Coordinator } = require("./conversation-engine-v2/coordinator");

function createV2CompositionRoot({ providers, service, env = process.env, now = () => new Date(), debounceMs = 2000, planner, composer, onDiagnostic, diagnosticDetail = false } = {}) {
  const engine = new ConversationEngineV2({
    planner: planner || createTestOnlyOpenAiConversationPlannerFromEnv({ env }),
    composer: composer || createTestOnlyOpenAiControlledComposerFromEnv({ env }),
    persistence: providers.persistence,
    getProperty: (propertyId) => providers.customerSettings.getProperty(propertyId),
    availabilityResolver: (query) => service.searchAvailability(query),
    availableDatesResolver: (query) => service.searchAvailableDates(query),
    listPriceOverrides: (propertyId) => providers.customerSettings.listRoomPriceOverrides(propertyId),
    now,
    onDiagnostic,
    diagnosticDetail,
    diagnosticMetadata: { providerType: providers.kind || "unknown" }
  });
  return { engine, coordinator: new ConversationEngineV2Coordinator({ engine, debounceMs, externalReplyToken: true }) };
}

module.exports = { createV2CompositionRoot };
