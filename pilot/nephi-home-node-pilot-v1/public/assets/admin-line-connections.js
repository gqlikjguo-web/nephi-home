"use strict";
const $ = (id) => document.getElementById(id);
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || "操作失敗");
  return body.data;
}
function text(tag, value) { const node = document.createElement(tag); node.textContent = value; return node; }
async function load() {
  const [connections, links] = await Promise.all([
    api("/api/admin/line-connections"),
    api("/api/admin/line-setup-links")
  ]);
  $("propertyId").replaceChildren(...connections.items.map((item) => {
    const option = document.createElement("option"); option.value = item.propertyId; option.textContent = `${item.propertyName}（${item.propertyId}）`; return option;
  }));
  $("connections").replaceChildren(...connections.items.map((item) => {
    const card = document.createElement("article"); card.className = "connection";
    const credential = item.hasChannelSecret && item.hasChannelAccessToken ? "憑證已設定" : "憑證未設定";
    const observed = item.webhookObserved ? "Webhook 已接收" : "Webhook 尚未接收";
    const toggle = document.createElement("button"); toggle.type = "button"; toggle.textContent = item.enabled ? "停用" : "啟用";
    toggle.disabled = !item.hasChannelSecret || !item.hasChannelAccessToken;
    toggle.onclick = async () => { toggle.disabled = true; try { await api(`/api/admin/line-bindings/${encodeURIComponent(item.propertyId)}/enabled`, { method: "PATCH", body: JSON.stringify({ enabled: !item.enabled }) }); await load(); } catch (error) { $("message").textContent = error.message; toggle.disabled = false; } };
    card.append(text("h3", item.propertyName), text("p", item.propertyId), text("p", `憑證：${credential}`), text("p", `啟用：${item.enabled ? "已啟用" : "未啟用"}`), text("p", `Webhook：${observed}`));
    if (item.webhookUrl) card.append(text("p", item.webhookUrl));
    card.append(toggle); return card;
  }));
  $("links").replaceChildren(...links.items.filter((item) => item.status === "active").map((item) => {
    const row = document.createElement("article"); row.className = "connection";
    const revoke = document.createElement("button"); revoke.type = "button"; revoke.textContent = "撤銷";
    revoke.onclick = async () => { revoke.disabled = true; try { await api(`/api/admin/line-setup-links/${encodeURIComponent(item.setupId)}/revoke`, { method: "POST", body: "{}" }); await load(); } catch (error) { $("message").textContent = error.message; revoke.disabled = false; } };
    row.append(text("p", `${item.propertyId}｜到期：${new Date(item.expiresAt).toLocaleString("zh-TW")}`), revoke); return row;
  }));
}
$("createForm").onsubmit = async (event) => {
  event.preventDefault(); $("createButton").disabled = true; $("message").textContent = "";
  try {
    const result = await api("/api/admin/line-setup-links", { method: "POST", body: JSON.stringify({ propertyId: $("propertyId").value, expiresInMinutes: Number($("expiresInMinutes").value) }) });
    $("setupUrl").value = result.setupUrl; $("createdLink").hidden = false; $("message").textContent = "一次性連結已建立。"; await load();
  } catch (error) { $("message").textContent = error.message; }
  finally { $("createButton").disabled = false; }
};
$("copyButton").onclick = () => navigator.clipboard.writeText($("setupUrl").value);
load().catch((error) => { $("message").textContent = error.message; });
