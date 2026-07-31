"use strict";
const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
history.replaceState(null, "", location.pathname);
const errorMessages = {
  LINE_SETUP_LINK_INVALID: "設定連結無效。",
  LINE_SETUP_LINK_EXPIRED: "設定連結已過期，請聯絡平台管理員重新建立。",
  LINE_SETUP_LINK_REVOKED: "設定連結已撤銷。",
  LINE_SETUP_LINK_USED: "設定連結已使用，不能再次提交。",
  LINE_CHANNEL_SECRET_REQUIRED: "請輸入 Channel Secret。",
  LINE_CHANNEL_ACCESS_TOKEN_REQUIRED: "請輸入 Channel Access Token。",
  LINE_CHANNEL_SECRET_INVALID: "Channel Secret 格式不正確。",
  LINE_CHANNEL_ACCESS_TOKEN_INVALID: "Channel Access Token 格式不正確。",
  LINE_BINDING_ENCRYPTION_KEY_MISSING: "系統缺少加密設定，請聯絡平台管理員。",
  LINE_SETUP_TRANSACTION_FAILED: "系統暫時無法儲存，連結尚未消耗，請稍後重試。"
};
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok) { const error = new Error(errorMessages[body.error?.code] || "暫時性伺服器錯誤，請稍後再試。"); error.code = body.error?.code; throw error; }
  return body.data;
}
function showInvalid(message) { $("loading").hidden = true; $("setup").hidden = true; $("invalid").hidden = false; $("invalidMessage").textContent = message; }
function showComplete(data) {
  $("setup").hidden = true; $("complete").hidden = false; $("webhookUrl").value = data.webhookUrl;
  $("enabledStatus").textContent = data.enabled ? "已啟用" : "尚未啟用";
  $("updatedAt").textContent = data.updatedAt ? new Date(data.updatedAt).toLocaleString("zh-TW") : "剛剛";
}
document.querySelectorAll("[data-toggle]").forEach((button) => {
  button.onclick = () => { const input = $(button.dataset.toggle), showing = input.type === "text"; input.type = showing ? "password" : "text"; button.textContent = showing ? "顯示" : "隱藏"; };
});
$("setupForm").onsubmit = async (event) => {
  event.preventDefault(); const secret = $("channelSecret"), accessToken = $("channelAccessToken"); $("submitButton").disabled = true; $("formMessage").textContent = "";
  try {
    const result = await api("/api/public/line-setup/redeem", { method: "POST", body: JSON.stringify({ token, channelSecret: secret.value, channelAccessToken: accessToken.value }) });
    secret.value = ""; accessToken.value = ""; secret.type = "password"; accessToken.type = "password"; showComplete(result);
  } catch (error) { $("formMessage").textContent = error.message; $("submitButton").disabled = false; }
};
$("copyWebhook").onclick = () => navigator.clipboard.writeText($("webhookUrl").value);
api("/api/public/line-setup/resolve", { method: "POST", body: JSON.stringify({ token }) }).then((data) => {
  $("loading").hidden = true; $("setup").hidden = false; $("propertyName").textContent = data.propertyName;
}).catch((error) => showInvalid(error.message));
