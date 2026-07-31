"use strict";

const crypto = require("node:crypto");
const { AppError } = require("./mvp-service");

const ENCRYPTION_ENV_KEY = "JUNZAN_LINE_CREDENTIAL_ENCRYPTION_KEY";

function encryptionKey(env) {
  const encoded = String(env && env[ENCRYPTION_ENV_KEY] || "").trim();
  if (!encoded) return null;
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    throw new AppError(503, "LINE_BINDING_ENCRYPTION_KEY_INVALID", "LINE binding encryption key must be a base64-encoded 32-byte key");
  }
  return key;
}

function seal(key, propertyId, field, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`line-binding:v1:${propertyId}:${field}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return { version: 1, algorithm: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

function open(key, propertyId, field, envelope) {
  if (!envelope || envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm") throw new AppError(503, "LINE_BINDING_CREDENTIAL_INVALID", "LINE binding credential is unavailable");
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(Buffer.from(`line-binding:v1:${propertyId}:${field}`, "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError(503, "LINE_BINDING_CREDENTIAL_INVALID", "LINE binding credential is unavailable");
  }
}

function safeStatus(row) {
  if (!row) return null;
  return {
    propertyId: row.propertyId,
    webhookKey: row.webhookKey,
    enabled: Boolean(row.enabled),
    hasChannelSecret: Boolean(row.channelSecretEncrypted),
    hasChannelAccessToken: Boolean(row.channelAccessTokenEncrypted),
    lastWebhookObservedAt: row.lastWebhookObservedAt || "",
    lastValidWebhookAt: row.lastValidWebhookAt || ""
  };
}

function requiredCredential(value, code) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new AppError(400, code, "Both LINE Channel Secret and Channel Access Token are required");
  if (normalized.length < 16 || normalized.length > 4096 || /\s/.test(normalized)) {
    const invalidCode = code === "LINE_CHANNEL_SECRET_REQUIRED"
      ? "LINE_CHANNEL_SECRET_INVALID"
      : "LINE_CHANNEL_ACCESS_TOKEN_INVALID";
    throw new AppError(400, invalidCode, "LINE credential format is invalid");
  }
  return normalized;
}

function createLineBindingService({ provider, env = process.env } = {}) {
  if (!provider) return null;
  const requireKey = () => {
    const key = encryptionKey(env);
    if (!key) throw new AppError(503, "LINE_BINDING_ENCRYPTION_KEY_MISSING", "LINE binding encryption key is not configured");
    return key;
  };
  const prepare = (propertyId, input = {}) => {
      const id = String(propertyId || "").trim();
      if (!id) throw new AppError(400, "PROPERTY_ID_REQUIRED", "propertyId is required");
      const current = provider.getLineBindingByPropertyId(id);
      const channelSecret = String(input.channelSecret || "").trim()
        ? requiredCredential(input.channelSecret, "LINE_CHANNEL_SECRET_REQUIRED")
        : null;
      const channelAccessToken = String(input.channelAccessToken || "").trim()
        ? requiredCredential(input.channelAccessToken, "LINE_CHANNEL_ACCESS_TOKEN_REQUIRED")
        : null;
      if (!current && (!channelSecret || !channelAccessToken)) throw new AppError(400, "LINE_CREDENTIALS_REQUIRED", "Both LINE Channel Secret and Channel Access Token are required");
      const encryption = channelSecret || channelAccessToken || !current ? requireKey() : null;
      const row = {
        propertyId: id,
        webhookKey: current && current.webhookKey || crypto.randomBytes(32).toString("base64url"),
        channelSecretEncrypted: channelSecret ? seal(encryption, id, "channel-secret", channelSecret) : current.channelSecretEncrypted,
        channelAccessTokenEncrypted: channelAccessToken ? seal(encryption, id, "channel-access-token", channelAccessToken) : current.channelAccessTokenEncrypted,
        enabled: Object.hasOwn(input, "enabled") ? Boolean(input.enabled) : current ? Boolean(current.enabled) : false
      };
      return row;
  };
  return {
    prepare,
    upsert(propertyId, input = {}) {
      return safeStatus(provider.upsertLineBinding(prepare(propertyId, input)));
    },
    status(propertyId) { return safeStatus(provider.getLineBindingByPropertyId(String(propertyId || "").trim())); },
    setEnabled(propertyId, enabled) {
      const current = provider.getLineBindingByPropertyId(String(propertyId || "").trim());
      if (enabled && (!current || !current.channelSecretEncrypted || !current.channelAccessTokenEncrypted)) throw new AppError(400, "LINE_CREDENTIALS_REQUIRED", "LINE credentials must be configured before enabling");
      requireKey();
      return safeStatus(provider.setLineBindingEnabled(String(propertyId || "").trim(), Boolean(enabled)));
    },
    recordValidWebhook(propertyId, observedAt = new Date().toISOString()) {
      if (typeof provider.recordValidLineWebhook !== "function") return null;
      return safeStatus(provider.recordValidLineWebhook(String(propertyId || "").trim(), observedAt));
    },
    markWebhookObserved(webhookKey, observedAt = new Date().toISOString()) {
      if (typeof provider.markLineBindingWebhookObserved !== "function") return null;
      return safeStatus(provider.markLineBindingWebhookObserved(String(webhookKey || "").trim(), observedAt));
    },
    resolve(webhookKey) {
      const row = provider.getLineBindingByWebhookKey(String(webhookKey || "").trim());
      if (!row || !row.enabled) return null;
      const encryption = requireKey();
      return {
        propertyId: row.propertyId,
        webhookKey: row.webhookKey,
        channelSecret: open(encryption, row.propertyId, "channel-secret", row.channelSecretEncrypted),
        channelAccessToken: open(encryption, row.propertyId, "channel-access-token", row.channelAccessTokenEncrypted)
      };
    }
  };
}

module.exports = { ENCRYPTION_ENV_KEY, createLineBindingService };
