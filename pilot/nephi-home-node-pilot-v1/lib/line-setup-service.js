"use strict";

const crypto = require("node:crypto");
const { AppError } = require("./mvp-service");

function setupTokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function setupState(row, now = new Date()) {
  if (!row) return "invalid";
  if (row.usedAt) return "used";
  if (row.revokedAt) return "revoked";
  if (new Date(row.expiresAt).getTime() <= now.getTime()) return "expired";
  return "active";
}

function stateError(state) {
  if (state === "expired") return new AppError(410, "LINE_SETUP_LINK_EXPIRED", "LINE setup link has expired");
  if (state === "revoked") return new AppError(410, "LINE_SETUP_LINK_REVOKED", "LINE setup link has been revoked");
  if (state === "used") return new AppError(410, "LINE_SETUP_LINK_USED", "LINE setup link has already been used");
  return new AppError(404, "LINE_SETUP_LINK_INVALID", "LINE setup link is invalid");
}

function safeBindingStatus(binding, publicBaseUrl) {
  if (!binding) {
    return {
      hasChannelSecret: false,
      hasChannelAccessToken: false,
      enabled: false,
      webhookUrl: "",
      updatedAt: "",
      webhookObserved: false,
      lastWebhookObservedAt: ""
    };
  }
  return {
    hasChannelSecret: Boolean(binding.channelSecretEncrypted),
    hasChannelAccessToken: Boolean(binding.channelAccessTokenEncrypted),
    enabled: Boolean(binding.enabled),
    webhookUrl: `${String(publicBaseUrl).replace(/\/+$/, "")}/api/line/webhooks/${encodeURIComponent(binding.webhookKey)}`,
    updatedAt: binding.updatedAt ? new Date(binding.updatedAt).toISOString() : "",
    webhookObserved: Boolean(binding.lastWebhookObservedAt),
    lastWebhookObservedAt: binding.lastWebhookObservedAt ? new Date(binding.lastWebhookObservedAt).toISOString() : ""
  };
}

function safeLink(row, now = new Date()) {
  return {
    setupId: row.setupId,
    propertyId: row.propertyId,
    expiresAt: new Date(row.expiresAt).toISOString(),
    revokedAt: row.revokedAt ? new Date(row.revokedAt).toISOString() : "",
    usedAt: row.usedAt ? new Date(row.usedAt).toISOString() : "",
    createdAt: new Date(row.createdAt).toISOString(),
    status: setupState(row, now)
  };
}

function createLineSetupService({
  provider,
  lineBindingService,
  customerSettings,
  publicBaseUrl,
  now = () => new Date()
} = {}) {
  if (!provider || typeof provider.createLineSetupToken !== "function" || !lineBindingService || !customerSettings) return null;

  const property = (propertyId) => {
    const item = customerSettings.getProperty(String(propertyId || "").trim());
    if (!item) throw new AppError(404, "PROPERTY_NOT_FOUND", "Property was not found");
    return item;
  };

  const resolveRow = (token) => {
    const raw = String(token || "").trim();
    if (!raw) throw stateError("invalid");
    const row = provider.getLineSetupTokenByHash(setupTokenHash(raw));
    const state = setupState(row, now());
    if (state !== "active") throw stateError(state);
    return row;
  };

  const publicView = (row) => {
    const item = property(row.propertyId);
    const binding = provider.getLineBindingByPropertyId(row.propertyId);
    return {
      propertyName: item.displayName || item.propertyName || row.propertyId,
      expiresAt: new Date(row.expiresAt).toISOString(),
      ...safeBindingStatus(binding, publicBaseUrl)
    };
  };

  return {
    propertyStatuses() {
      return customerSettings.listProperties().map((item) => ({
        propertyId: item.propertyId,
        propertyName: item.displayName || item.propertyId,
        ...safeBindingStatus(provider.getLineBindingByPropertyId(item.propertyId), publicBaseUrl)
      }));
    },
    create(input = {}, actor = {}) {
      const propertyId = String(input.propertyId || "").trim();
      property(propertyId);
      const minutes = input.expiresInMinutes === undefined ? 30 : Number(input.expiresInMinutes);
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
        throw new AppError(400, "LINE_SETUP_EXPIRY_INVALID", "expiresInMinutes must be between 5 and 1440");
      }
      const rawToken = crypto.randomBytes(32).toString("base64url");
      const createdAt = now();
      const row = provider.createLineSetupToken({
        setupId: crypto.randomUUID(),
        tokenHash: setupTokenHash(rawToken),
        propertyId,
        expiresAt: new Date(createdAt.getTime() + minutes * 60000).toISOString(),
        createdByPropertyId: String(actor.propertyId || ""),
        createdByUsername: String(actor.username || "")
      });
      return {
        ...safeLink(row, createdAt),
        setupUrl: `${String(publicBaseUrl).replace(/\/+$/, "")}/line/setup#token=${encodeURIComponent(rawToken)}`
      };
    },
    list(propertyId) {
      if (propertyId) property(propertyId);
      return provider.listLineSetupTokens(String(propertyId || "").trim()).map((row) => safeLink(row, now()));
    },
    revoke(setupId) {
      const row = provider.revokeLineSetupToken(String(setupId || "").trim(), now().toISOString());
      if (!row) throw new AppError(404, "LINE_SETUP_LINK_INVALID", "LINE setup link is invalid");
      return safeLink(row, now());
    },
    resolve(token) {
      return publicView(resolveRow(token));
    },
    redeem(input = {}) {
      const rawToken = String(input.token || "").trim();
      const row = resolveRow(rawToken);
      const bindingRow = lineBindingService.prepare(row.propertyId, {
        channelSecret: input.channelSecret,
        channelAccessToken: input.channelAccessToken,
        enabled: false
      });
      let result;
      try {
        result = provider.redeemLineSetupToken(setupTokenHash(rawToken), bindingRow, now().toISOString());
      } catch {
        throw new AppError(503, "LINE_SETUP_TRANSACTION_FAILED", "LINE setup could not be saved; please try again");
      }
      if (!result || !result.ok) throw stateError(result && result.state || "invalid");
      return {
        propertyName: property(row.propertyId).displayName || row.propertyId,
        ...safeBindingStatus(result.binding, publicBaseUrl)
      };
    }
  };
}

module.exports = { createLineSetupService, setupTokenHash };
