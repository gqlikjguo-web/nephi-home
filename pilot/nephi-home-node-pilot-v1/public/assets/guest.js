"use strict";

const propertyId = new URLSearchParams(location.search).get("propertyId") || "";
const form = document.querySelector("#searchForm");
const checkIn = document.querySelector("#checkIn");
const checkOut = document.querySelector("#checkOut");
const message = document.querySelector("#message");
const results = document.querySelector("#results");

function nextDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function resultList(title, items) {
  const container = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = title;
  container.append(heading);
  const list = document.createElement("ul");
  list.className = "result-list";
  items.forEach((item) => {
    const row = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = item.name;
    const details = document.createElement("span");
    details.textContent = `容納人數：${item.capacity}${item.basePrice ? `｜基本價格：NT$ ${item.basePrice.toLocaleString("zh-TW")}` : ""}`;
    row.append(name, details);
    list.append(row);
  });
  container.append(list);
  return container;
}

function render(data) {
  document.querySelector("#propertyName").textContent = data.propertyName;
  document.querySelector("#stayDates").textContent = `入住日期：${data.checkInDate}　退房日期：${data.checkOutDate}`;
  const roomResults = document.querySelector("#roomResults");
  const bundleResults = document.querySelector("#bundleResults");
  roomResults.replaceChildren(...(data.rooms.length ? [resultList("可詢問房型", data.rooms)] : []));
  bundleResults.replaceChildren(...(data.bundles.length ? [resultList("可詢問包棟方案", data.bundles)] : []));
  message.textContent = data.empty ? "此日期目前沒有符合條件的可售房型或包棟方案。" : "";
  const lineLink = document.querySelector("#lineLink");
  const lineUnavailable = document.querySelector("#lineUnavailable");
  lineLink.hidden = !data.lineUrl;
  lineUnavailable.hidden = Boolean(data.lineUrl);
  if (data.lineUrl) lineLink.href = data.lineUrl;
  else lineLink.removeAttribute("href");
  results.hidden = false;
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

checkIn.addEventListener("change", () => { checkOut.textContent = nextDate(checkIn.value); });
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "查詢中…";
  results.hidden = true;
  if (!propertyId) { message.textContent = "網址缺少業者識別，請向業者索取正確網址。"; return; }
  const values = new FormData(form);
  const params = new URLSearchParams({ propertyId, checkIn: values.get("checkIn"), queryMode: values.get("queryMode") });
  if (values.get("guests")) params.set("guests", values.get("guests"));
  if (values.get("roomType")) params.set("roomType", values.get("roomType").trim());
  try {
    const response = await fetch(`/api/public/availability?${params}`, { headers: { accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error && payload.error.code === "UNKNOWN_CUSTOMER_ID" ? "找不到此業者的公開查房資料。" : "目前無法查詢房況，請稍後再試。");
    render(payload.data);
  } catch (error) {
    message.textContent = error.message;
  }
});

checkIn.min = new Date().toISOString().slice(0, 10);
