"use strict";

const form = document.querySelector("#searchForm");
const message = document.querySelector("#message");
const results = document.querySelector("#results");
const propertyName = document.querySelector("#propertyName");
const roomType = document.querySelector("#roomType");
const checkIn = document.querySelector("#checkIn");
const checkOut = document.querySelector("#checkOut");
const INVALID_LINK_MESSAGE = "此查房連結無效，請重新由民宿官方連結進入。";
const slug = (() => {
  const parts = location.pathname.split("/").filter(Boolean);
  return parts.length === 1 && parts[0] !== "guest" ? parts[0] : "";
})();
let publicProperty = null;

function dateKey(date) { return date.toISOString().slice(0, 10); }
function nextDate(value) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return dateKey(date); }
function formatDate(value) { const date = new Date(`${value}T00:00:00Z`); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }

function resultList(title, items) {
  const section = document.createElement("section");
  const heading = document.createElement("h3"); heading.textContent = title;
  const list = document.createElement("ul"); list.className = "result-list";
  for (const item of items) { const row = document.createElement("li"); const name = document.createElement("strong"); name.textContent = item.name; row.append(name, document.createTextNode(`價格：${item.price ?? "請洽民宿"}`)); list.append(row); }
  section.append(heading, list); return section;
}

function renderResult(data) {
  document.querySelector("#stayDates").textContent = `${formatDate(data.checkIn)} 至 ${formatDate(data.checkOut)}`;
  const roomResults = document.querySelector("#roomResults");
  const bundleResults = document.querySelector("#bundleResults");
  roomResults.replaceChildren(...(data.rooms.length ? [resultList("可詢問房型", data.rooms)] : []));
  bundleResults.replaceChildren(...(data.bundles.length ? [resultList("可詢問包棟方案", data.bundles)] : []));
  message.textContent = data.empty ? "此日期目前沒有符合條件的可售房型或包棟方案。" : "";
  const lineLink = document.querySelector("#lineLink");
  const lineUnavailable = document.querySelector("#lineUnavailable");
  lineLink.hidden = !data.lineUrl; lineUnavailable.hidden = Boolean(data.lineUrl);
  document.querySelector("#lineDisclaimer").hidden = !data.lineUrl;
  if (data.lineUrl) lineLink.href = data.lineUrl; else lineLink.removeAttribute("href");
  results.hidden = false;
}

function setInventoryOptions(items) {
  roomType.replaceChildren(...items.map((item) => { const option = document.createElement("option"); option.value = item.id; option.textContent = item.name; return option; }));
  roomType.disabled = false;
}

async function loadProperty() {
  if (!slug) { message.textContent = INVALID_LINK_MESSAGE; form.querySelector("button[type=submit]").disabled = true; return; }
  try {
    const response = await fetch(`/api/public/property?slug=${encodeURIComponent(slug)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || INVALID_LINK_MESSAGE);
    publicProperty = payload.data;
    propertyName.textContent = `${publicProperty.propertyName}｜空房查詢`;
    document.title = `${publicProperty.propertyName}｜空房查詢`;
    setInventoryOptions(publicProperty.inventoryOptions || [{ id: "all", name: "不指定" }]);
  } catch (error) { message.textContent = error.message || INVALID_LINK_MESSAGE; form.querySelector("button[type=submit]").disabled = true; }
}

checkIn.onchange = () => { checkOut.textContent = checkIn.value ? formatDate(nextDate(checkIn.value)) : "—"; };
form.onsubmit = async (event) => {
  event.preventDefault();
  if (!publicProperty) { message.textContent = INVALID_LINK_MESSAGE; return; }
  if (!form.reportValidity()) return;
  const values = new FormData(form);
  const guests = String(values.get("guests") || "").trim();
  if (guests && (!/^\d+$/.test(guests) || Number(guests) < 1)) { message.textContent = "入住人數請輸入正整數。"; return; }
  const params = new URLSearchParams({ slug, checkIn: values.get("checkIn"), queryMode: values.get("queryMode"), roomType: values.get("roomType") || "all" });
  if (guests) params.set("guests", guests);
  try {
    const response = await fetch(`/api/public/availability?${params}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || "系統查詢失敗，請稍後再試。");
    renderResult(payload.data);
  } catch (error) { message.textContent = error.message || "系統查詢失敗，請稍後再試。"; results.hidden = true; }
};

loadProperty();
