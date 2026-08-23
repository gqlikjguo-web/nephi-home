"use strict";

const propertiesBox = document.querySelector("#properties");
const message = document.querySelector("#message");

async function api(path) {
  let response;
  let payload;
  try {
    response = await fetch(path, { headers: { "content-type": "application/json" } });
    payload = await response.json();
  } catch {
    throw new Error("連線失敗，請確認網路後再試。");
  }
  if (!response.ok) throw new Error(payload.error?.message || "載入失敗，請稍後再試。");
  return payload.data;
}

function element(tag, content, className = "") {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function namedItems(title, items) {
  const section = element("section", undefined, "review-section");
  const list = element("ul");
  section.append(element("h3", title));
  if (!items.length) {
    section.append(element("p", "目前沒有資料"));
    return section;
  }
  for (const item of items) list.append(element("li", `${item.name || "未命名"}（${item.id}）`));
  section.append(list);
  return section;
}

function propertyCard(property) {
  const article = element("article", undefined, "item");
  article.append(
    element("h2", property.propertyName || "未命名業者"),
    element("p", `propertyId：${property.propertyId}`, "status-line"),
    namedItems("房型", Array.isArray(property.rooms) ? property.rooms : []),
    namedItems("包棟方案", Array.isArray(property.bundles) ? property.bundles : [])
  );
  return article;
}

async function load() {
  message.textContent = "載入中…";
  try {
    const result = await api("/api/admin/onboarding/properties");
    const items = Array.isArray(result.items) ? result.items : [];
    propertiesBox.replaceChildren(...items.map(propertyCard));
    message.textContent = items.length ? `共 ${items.length} 個正式業者。` : "目前沒有正式業者。";
  } catch (error) {
    propertiesBox.replaceChildren();
    message.textContent = error.message;
  }
}

document.querySelector("#refresh").addEventListener("click", load);
load();
