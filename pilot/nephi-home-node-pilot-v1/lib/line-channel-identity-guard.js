"use strict";

const crypto = require("node:crypto");

const TEST_ROUTE_PREFIX = "/api/test-line/";

function fatal(code, message, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.fatal = true;
  error.status = status;
  Object.assign(error, details);
  return error;
}

function isTestRoute(route) {
  return String(route || "").startsWith(TEST_ROUTE_PREFIX);
}

function validateLineChannelConfiguration(input = {}) {
  const environment = String(input.environment || "").trim().toLowerCase();
  const channelId = String(input.channelId || "").trim();
  const destinationId = String(input.destinationId || "").trim();
  const webhookRoute = String(input.webhookRoute || "").trim();
  const actualWebhookRoute = String(input.actualWebhookRoute || "").trim();
  const channelSecret = String(input.channelSecret || "");
  const channelSecretSha256 = String(input.channelSecretSha256 || "").trim().toLowerCase();
  const channelAccessToken = String(input.channelAccessToken || "");

  const invalidFields = [
    !["production", "test-only"].includes(environment) && "environment",
    !webhookRoute && "webhookRoute",
    !actualWebhookRoute && "actualWebhookRoute",
    !channelSecret && "channelSecret",
    !channelAccessToken && "channelAccessToken",
    environment === "production" && !channelId && "channelId",
    environment === "production" && !destinationId && "destinationId",
    environment === "production" && !/^[a-f0-9]{64}$/.test(channelSecretSha256) && "channelSecretSha256"
  ].filter(Boolean);
  if (invalidFields.length) {
    throw fatal(
      "LINE_CHANNEL_IDENTITY_INCOMPLETE",
      `LINE channel identity configuration is incomplete: ${invalidFields.join(", ")}`,
      400,
      { invalidFields }
    );
  }
  if (destinationId && !/^U[0-9a-f]{32}$/i.test(destinationId)) {
    throw fatal("LINE_DESTINATION_ID_INVALID", "LINE webhook destination identity must be a Bot User ID");
  }
  if (webhookRoute !== actualWebhookRoute) {
    throw fatal("LINE_WEBHOOK_ROUTE_MISMATCH", "Configured LINE webhook route does not match the server route");
  }
  if ((environment === "production" && isTestRoute(webhookRoute)) ||
      (environment === "test-only" && !isTestRoute(webhookRoute))) {
    throw fatal("LINE_ENVIRONMENT_ROUTE_MISMATCH", "LINE environment and webhook route are inconsistent");
  }

  const actualSecretSha256 = crypto.createHash("sha256").update(channelSecret).digest("hex");
  if (environment === "production" && channelSecretSha256 && !crypto.timingSafeEqual(Buffer.from(actualSecretSha256), Buffer.from(channelSecretSha256))) {
    throw fatal("LINE_CHANNEL_SECRET_IDENTITY_MISMATCH", "LINE channel secret does not match its configured identity");
  }

  return { environment, channelId, destinationId, webhookRoute };
}

function validateLineWebhookDestination(identity, destination) {
  const actualDestinationId = String(destination || "").trim();
  if (!identity || (identity.destinationId && (!actualDestinationId || actualDestinationId !== identity.destinationId))) {
    throw fatal("LINE_CHANNEL_IDENTITY_MISMATCH", "LINE webhook destination does not match the configured channel identity");
  }
}

module.exports = {
  TEST_ROUTE_PREFIX,
  validateLineChannelConfiguration,
  validateLineWebhookDestination
};
