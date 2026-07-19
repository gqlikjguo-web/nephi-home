"use strict";

const { messagingApi, validateSignature } = require("@line/bot-sdk");

function verifyTestLineSignature(rawBody, signature, channelSecret) {
  return validateSignature(rawBody, channelSecret, String(signature || ""));
}

function client(accessToken, clientFactory) {
  return clientFactory ? clientFactory({ channelAccessToken: accessToken }) : new messagingApi.MessagingApiClient({ channelAccessToken: accessToken });
}

function createFetchBackedLineClientFactory(fetchImpl) {
  const invoke = async (url, body, channelAccessToken) => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${channelAccessToken}` },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const error = new Error(typeof response.text === "function" ? await response.text() : "LINE request failed");
      error.status = response.status;
      throw error;
    }
    return { httpResponse: { status: response.status } };
  };
  return ({ channelAccessToken }) => ({
    replyMessageWithHttpInfo: (body) => invoke("https://api.line.me/v2/bot/message/reply", body, channelAccessToken),
    pushMessageWithHttpInfo: (body) => invoke("https://api.line.me/v2/bot/message/push", body, channelAccessToken)
  });
}

async function send(method, request, accessToken, clientFactory) {
  try {
    const result = await client(accessToken, clientFactory)[method](request);
    return { ok: true, status: result.httpResponse.status, responseText: "" };
  } catch (error) {
    const status = Number(error && (error.status || error.statusCode));
    if (Number.isFinite(status) && status > 0) return { ok: false, status, responseText: "" };
    return { ok: false, exception: true, responseText: "" };
  }
}

function replyToTestLine(replyToken, replyText, accessToken, clientFactory) {
  return send("replyMessageWithHttpInfo", { replyToken, messages: [{ type: "text", text: replyText }] }, accessToken, clientFactory);
}

function pushToTestLine(userId, replyText, accessToken, clientFactory) {
  return send("pushMessageWithHttpInfo", { to: userId, messages: [{ type: "text", text: replyText }] }, accessToken, clientFactory);
}

module.exports = { verifyTestLineSignature, createFetchBackedLineClientFactory, replyToTestLine, pushToTestLine };
