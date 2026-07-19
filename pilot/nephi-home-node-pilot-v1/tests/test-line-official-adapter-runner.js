"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { verifyTestLineSignature, replyToTestLine } = require("../lib/test-line-webhook");

const secret = "test-channel-secret";
const token = "test-channel-access-token";
const rawBody = Buffer.from('{"destination":"U0123456789abcdef0123456789abcdef","events":[]}');
const signature = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");

assert.equal(verifyTestLineSignature(rawBody, signature, secret), true);
assert.equal(verifyTestLineSignature(rawBody, signature, "wrong-secret"), false);

let config;
let request;
replyToTestLine("reply-token", "測試", token, (input) => {
  config = input;
  return { replyMessageWithHttpInfo: async (body) => {
    request = body;
    return { httpResponse: { status: 200 } };
  } };
}).then((result) => {
  assert.equal(result.ok, true);
  assert.equal(config.channelAccessToken, token);
  assert.deepEqual(request, { replyToken: "reply-token", messages: [{ type: "text", text: "測試" }] });
  console.log(JSON.stringify({ caseCount: 3, passCount: 3, failCount: 0 }));
}).catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
