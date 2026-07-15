"use strict";
const box = document.querySelector("#applications"), message = document.querySelector("#message");
async function api(path, options = {}) { const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...options.headers } }), payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message || "操作失敗"); return payload.data; }
function textElement(tag, value) { const element = document.createElement(tag); element.textContent = value; return element; }
function labelWithControl(labelText, control) { const label = document.createElement("label"); label.append(document.createTextNode(labelText), control); return label; }
function renderApplication(app) {
  const article = document.createElement("article"), roomNames = new Map(app.rooms.map(room => [room.key, room.name])); article.className = "item";
  article.append(textElement("h2", app.propertyName || "未命名業者"), textElement("p", `聯絡人：${app.contactName || "未填"}｜狀態：${app.status}｜完整度：${app.completeness.percent}%`), textElement("p", `房型 ${app.rooms.length}｜組合方案 ${app.bundles.length}`));
  const roomList = document.createElement("ul"); for (const room of app.rooms) roomList.append(textElement("li", `${room.name}｜最多 ${room.capacity} 人｜週一至週四 ${room.mondayThursdayPrice} 元｜週五 ${room.fridayPrice} 元｜週六及連續假期 ${room.saturdayHolidayPrice} 元｜週日 ${room.sundayPrice} 元`)); article.append(textElement("h3", "房型與價格"), roomList);
  if (app.bundles.length) { const bundleList = document.createElement("ul"); for (const bundle of app.bundles) bundleList.append(textElement("li", `${bundle.name}｜${bundle.memberRoomKeys.map(key => roomNames.get(key)).filter(Boolean).join("、")}`)); article.append(textElement("h3", "組合方案"), bundleList); }
  const pool = app.knowledge.find(item => item.key === "pool"); if (pool) article.append(textElement("p", `戲水池／游泳池：${pool.status === "fixed" ? pool.answer : pool.status === "unavailable" ? "沒有" : pool.status === "human_handoff" ? "需另行說明" : "尚未確定"}`));
  const note = document.createElement("textarea"); article.append(labelWithControl("審核備註", note));
  const propertyId = document.createElement("input"); propertyId.value = app.propertyIdSuggestion || `property_${app.applicationId.slice(0, 8)}`; article.append(labelWithControl("核准 propertyId", propertyId));
  const username = document.createElement("input"); username.value = "owner"; article.append(labelWithControl("業者管理帳號", username));
  const actions = document.createElement("div"); actions.className = "actions";
  for (const [label, action] of [["退回補件", "request-changes"], ["拒絕", "reject"], ["核准", "approve"]]) { const button = document.createElement("button"); button.textContent = label; button.onclick = async () => { try { const body = action === "approve" ? { propertyId: propertyId.value, adminUsername: username.value } : { reason: note.value }, result = await api(`/api/admin/onboarding/applications/${app.applicationId}/${action}`, { method: "POST", body: JSON.stringify(body) }); if (result.adminSetupToken) message.textContent = `核准完成。請由安全初始化網址建立業者密碼：${result.adminSetupUrl}`; await load(); } catch (error) { message.textContent = error.message; } }; actions.append(button); }
  article.append(actions); return article;
}
async function load() { try { const { items } = await api("/api/admin/onboarding/applications"); box.replaceChildren(...items.map(renderApplication)); } catch (error) { message.textContent = error.message; } }
document.querySelector("#refresh").onclick = load; load();
