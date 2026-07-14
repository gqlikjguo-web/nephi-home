"use strict";

const crypto = require("crypto");

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";

function verifyLineSignature(rawBody, signature, channelSecret) {
  const expected = crypto.createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const actualBuffer = Buffer.from(String(signature || ""));
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

async function replyToTestLine(replyToken, replyText, accessToken, fetchImpl = fetch) {
  const response = await fetchImpl(LINE_REPLY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text: replyText }] })
  });
  const responseText = typeof response.text === "function" ? await response.text() : "";
  return { ok: response.ok, status: response.status, responseText };
}

module.exports = { LINE_REPLY_URL, verifyLineSignature, replyToTestLine };
