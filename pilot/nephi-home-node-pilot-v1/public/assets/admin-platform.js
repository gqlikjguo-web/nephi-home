"use strict";

const propertiesBox = document.querySelector("#properties");
const message = document.querySelector("#message");
const summaryBox = document.querySelector("#platformSummary");

async function api(path, options = {}) {
  let response;
  let payload;
  try {
    response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
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

function summaryCounts(properties, applications, connections) {
  const pendingStatuses = new Set(["submitted", "resubmitted"]);
  return {
    propertyCount: properties.length,
    pendingApplicationCount: applications.filter((item) => pendingStatuses.has(item.status)).length,
    lineEnabledCount: connections.filter((item) => item.enabled === true).length,
    lineDisabledCount: connections.filter((item) => item.enabled !== true).length
  };
}

function summaryCard(label, value, tone, href) {
  const card = element("a", undefined, `card summary-card ${tone}`);
  card.href = href;
  card.append(element("p", label, "summary-label"), element("strong", String(value), "summary-value"));
  return card;
}

function renderSummary(counts) {
  summaryBox.replaceChildren(
    summaryCard("正式業者數", counts.propertyCount, "summary-properties", "#properties"),
    summaryCard("待審核申請數", counts.pendingApplicationCount, "summary-review", "/admin/onboarding?filter=pending"),
    summaryCard("LINE 已啟用數", counts.lineEnabledCount, "summary-enabled", "/admin/line-connections?filter=enabled"),
    summaryCard("LINE 尚未啟用數", counts.lineDisabledCount, "summary-disabled", "/admin/line-connections?filter=disabled")
  );
}

function propertyCard(property, lineByProperty) {
  const rooms = Array.isArray(property.rooms) ? property.rooms : [];
  const bundles = Array.isArray(property.bundles) ? property.bundles : [];
  const lineEnabled = lineByProperty.get(property.propertyId)?.enabled === true;
  const article = element("article", undefined, "property-row");
  const heading = element("div", undefined, "property-identity");
  const metrics = element("div", undefined, "property-metrics");
  const enter = element("button", "進入業者後台", "property-enter");
  enter.type = "button";
  heading.append(element("h3", property.propertyName || "未命名業者"), element("p", property.propertyId, "property-id"));
  metrics.append(
    element("span", `房型 ${rooms.length}`),
    element("span", `包棟 ${bundles.length}`),
    element("span", `登入 ${property.emails?.join("、") || "尚未設定"}`),
    element("span", `帳號 ${property.accountStatus || "未知"}`),
    element("span", `導入 ${property.onboardingStatus || "未知"}`),
    element("span", lineEnabled ? "LINE 已啟用" : "LINE 尚未啟用", lineEnabled ? "line-enabled" : "line-disabled")
  );
  enter.addEventListener("click", async () => { enter.disabled = true; enter.textContent = "正在進入…"; try { await api("/api/admin/select-property", { method: "POST", body: JSON.stringify({ propertyId: property.propertyId }) }); location.assign("/admin?platform=1"); } catch (error) { enter.disabled = false; enter.textContent = error.message; } });
  article.append(
    heading,
    metrics,
    enter
  );
  return article;
}

async function load() {
  message.textContent = "載入中…";
  try {
    const [propertiesResult, applicationsResult, connectionsResult, directoryResult] = await Promise.all([
      api("/api/admin/onboarding/properties"),
      api("/api/admin/onboarding/applications"),
      api("/api/admin/line-connections"),
      api("/api/admin/platform/properties")
    ]);
    const properties = Array.isArray(propertiesResult.items) ? propertiesResult.items : [];
    const applications = Array.isArray(applicationsResult.items) ? applicationsResult.items : [];
    const connections = Array.isArray(connectionsResult.items) ? connectionsResult.items : [];
    const lineByProperty = new Map(connections.map((item) => [item.propertyId, item])), formalById = new Map(properties.map(item => [item.propertyId, item]));
    const directory = (directoryResult.items || []).map(item => ({ ...formalById.get(item.propertyId), ...item }));
    renderSummary(summaryCounts(properties, applications, connections));
    propertiesBox.replaceChildren(...directory.map((property) => propertyCard(property, lineByProperty)));
    message.textContent = directory.length ? `共 ${directory.length} 個正式業者。` : "目前沒有正式業者。";
  } catch (error) {
    summaryBox.replaceChildren();
    propertiesBox.replaceChildren();
    message.textContent = error.message;
  }
}

document.querySelector("#refresh").addEventListener("click", load);
load();
