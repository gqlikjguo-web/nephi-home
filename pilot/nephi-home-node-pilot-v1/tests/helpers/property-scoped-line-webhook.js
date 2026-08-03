"use strict";

const crypto = require("node:crypto");
const { createLineBindingService } = require("../../lib/line-binding-service");

function createMemoryLineBindingProvider() {
  const rowsByProperty = new Map();
  const rowsByKey = new Map();
  return {
    getLineBindingByPropertyId(propertyId) {
      return rowsByProperty.get(propertyId) || null;
    },
    getLineBindingByWebhookKey(webhookKey) {
      return rowsByKey.get(webhookKey) || null;
    },
    upsertLineBinding(row) {
      const previous = rowsByProperty.get(row.propertyId);
      if (previous) rowsByKey.delete(previous.webhookKey);
      const saved = {
        ...row,
        createdAt: previous && previous.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      rowsByProperty.set(saved.propertyId, saved);
      rowsByKey.set(saved.webhookKey, saved);
      return saved;
    },
    setLineBindingEnabled(propertyId, enabled) {
      const current = rowsByProperty.get(propertyId);
      return current
        ? this.upsertLineBinding({ ...current, enabled: Boolean(enabled) })
        : null;
    },
    markLineBindingWebhookObserved(webhookKey, observedAt) {
      const current = rowsByKey.get(webhookKey);
      return current
        ? this.upsertLineBinding({ ...current, lastWebhookObservedAt: observedAt })
        : null;
    },
    recordValidLineWebhook(propertyId, observedAt) {
      const current = rowsByProperty.get(propertyId);
      return current && current.enabled
        ? this.upsertLineBinding({ ...current, lastValidWebhookAt: observedAt })
        : null;
    }
  };
}

function attachPropertyScopedLineBinding({
  providers,
  propertyId,
  channelSecret = "test-line-channel-secret",
  channelAccessToken = "test-line-channel-access-token",
  encryptionKey = crypto.randomBytes(32).toString("base64"),
  enabled = true
} = {}) {
  if (!providers) throw new TypeError("providers_required");
  const provider = providers.lineBindings || createMemoryLineBindingProvider();
  providers.lineBindings = provider;
  const lineBindingEnv = {
    JUNZAN_LINE_CREDENTIAL_ENCRYPTION_KEY: encryptionKey
  };
  const bindingService = createLineBindingService({ provider, env: lineBindingEnv });
  const binding = bindingService.upsert(propertyId, {
    channelSecret,
    channelAccessToken,
    enabled
  });
  const route = `/api/line/webhooks/${binding.webhookKey}`;
  const sign = (rawBody) => crypto
    .createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64");
  const post = (baseUrl, rawBody, {
    signature = sign(rawBody),
    routeSuffix = ""
  } = {}) => fetch(`${baseUrl}${route}${routeSuffix}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-line-signature": signature
    },
    body: rawBody
  });
  return {
    binding,
    bindingService,
    channelAccessToken,
    channelSecret,
    lineBindingEnv,
    post,
    route,
    sign
  };
}

async function waitFor(predicate, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed_out_waiting_for_line_result");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

module.exports = {
  attachPropertyScopedLineBinding,
  createMemoryLineBindingProvider,
  waitFor
};
