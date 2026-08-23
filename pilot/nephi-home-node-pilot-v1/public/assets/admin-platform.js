"use strict";

const propertiesBox = document.querySelector("#properties");
const message = document.querySelector("#message");
const summaryBox = document.querySelector("#platformSummary");

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
  const section = element("section", undefined, "property-detail-group");
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

function summaryCounts(properties, applications, connections) {
  const pendingStatuses = new Set(["submitted", "resubmitted"]);
  return {
    propertyCount: properties.length,
    pendingApplicationCount: applications.filter((item) => pendingStatuses.has(item.status)).length,
    lineEnabledCount: connections.filter((item) => item.enabled === true).length,
    lineDisabledCount: connections.filter((item) => item.enabled !== true).length
  };
}

function summaryCard(label, value, tone) {
  const card = element("article", undefined, `card summary-card ${tone}`);
  card.append(element("p", label, "summary-label"), element("strong", String(value), "summary-value"));
  return card;
}

function renderSummary(counts) {
  summaryBox.replaceChildren(
    summaryCard("正式業者數", counts.propertyCount, "summary-properties"),
    summaryCard("待審核申請數", counts.pendingApplicationCount, "summary-review"),
    summaryCard("LINE 已啟用數", counts.lineEnabledCount, "summary-enabled"),
    summaryCard("LINE 尚未啟用數", counts.lineDisabledCount, "summary-disabled")
  );
}

function propertyCard(property, lineByProperty) {
  const rooms = Array.isArray(property.rooms) ? property.rooms : [];
  const bundles = Array.isArray(property.bundles) ? property.bundles : [];
  const lineEnabled = lineByProperty.get(property.propertyId)?.enabled === true;
  const article = element("article", undefined, "property-row");
  const heading = element("div", undefined, "property-identity");
  const metrics = element("div", undefined, "property-metrics");
  const details = element("details", undefined, "property-details");
  const summary = element("summary", "展開詳細");
  const detailGrid = element("div", undefined, "property-detail-grid");
  heading.append(element("h3", property.propertyName || "未命名業者"), element("p", property.propertyId, "property-id"));
  metrics.append(
    element("span", `房型 ${rooms.length}`),
    element("span", `包棟 ${bundles.length}`),
    element("span", lineEnabled ? "LINE 已啟用" : "LINE 尚未啟用", lineEnabled ? "line-enabled" : "line-disabled")
  );
  detailGrid.append(namedItems("房型", rooms), namedItems("包棟方案", bundles));
  details.append(summary, detailGrid);
  article.append(
    heading,
    metrics,
    details
  );
  return article;
}

async function load() {
  message.textContent = "載入中…";
  try {
    const [propertiesResult, applicationsResult, connectionsResult] = await Promise.all([
      api("/api/admin/onboarding/properties"),
      api("/api/admin/onboarding/applications"),
      api("/api/admin/line-connections")
    ]);
    const properties = Array.isArray(propertiesResult.items) ? propertiesResult.items : [];
    const applications = Array.isArray(applicationsResult.items) ? applicationsResult.items : [];
    const connections = Array.isArray(connectionsResult.items) ? connectionsResult.items : [];
    const lineByProperty = new Map(connections.map((item) => [item.propertyId, item]));
    renderSummary(summaryCounts(properties, applications, connections));
    propertiesBox.replaceChildren(...properties.map((property) => propertyCard(property, lineByProperty)));
    message.textContent = properties.length ? `共 ${properties.length} 個正式業者。` : "目前沒有正式業者。";
  } catch (error) {
    summaryBox.replaceChildren();
    propertiesBox.replaceChildren();
    message.textContent = error.message;
  }
}

document.querySelector("#refresh").addEventListener("click", load);
load();
