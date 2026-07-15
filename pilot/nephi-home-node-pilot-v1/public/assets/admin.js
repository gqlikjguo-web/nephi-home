"use strict";
const $ = id => document.getElementById(id);
let session = null;
let rooms = [];

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || "操作失敗");
  return body.data;
}
function cell(tag, text) { const node = document.createElement(tag); node.textContent = text; return node; }
function showLogin(message = "") { session = null; $("login").hidden = false; $("workspace").hidden = true; $("logout").hidden = true; $("loginMessage").textContent = message; }
function currentMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }

async function loadMonth() {
  const [year, month] = $("month").value.split("-");
  const data = await api(`/api/availability/month?customerId=${encodeURIComponent(session.propertyId)}&year=${year}&month=${Number(month)}`);
  rooms = data.rooms;
  $("roomHeaders").replaceChildren(cell("th", "日期"), ...rooms.map(room => cell("th", room.name)));
  $("days").replaceChildren(...data.rows.map(row => {
    const tr = document.createElement("tr"); tr.append(cell("td", row.date));
    for (const room of rooms) {
      const td = document.createElement("td"), button = document.createElement("button"), open = row[room.id] === "available";
      button.className = `slot${open ? "" : " closed"}`; button.textContent = open ? "可售（剩餘 1）" : "停售（剩餘 0）";
      button.onclick = () => saveDay(row.date, room, open ? "closed" : "available", button); td.append(button); tr.append(td);
    }
    return tr;
  }));
  renderMembers(); $("status").textContent = "房況已載入";
}
async function saveDay(date, room, status, button) {
  if (room.inventoryType === "bundle" && !confirm(status === "closed" ? "關閉此包棟方案，將同時關閉包含的所有房間。" : "開放此包棟方案，將同時開放包含的所有房間。")) return;
  button.disabled = true;
  try { await api("/api/availability/day", { method: "POST", body: JSON.stringify({ customerId: session.propertyId, date, roomId: room.id, status }) }); await loadMonth(); $("status").textContent = "已儲存，LINE 與客人前台會立即讀取最新房況"; }
  catch (error) { alert(error.message); } finally { button.disabled = false; }
}
function renderMembers() {
  $("memberRooms").replaceChildren(...rooms.filter(room => room.inventoryType !== "bundle").map(room => {
    const label = document.createElement("label"), input = document.createElement("input"); input.type = "checkbox"; input.name = "memberRoom"; input.value = room.id; label.append(input, document.createTextNode(room.name)); return label;
  }));
}
async function loadBundles() {
  const { bundles } = await api(`/api/bundles?customerId=${encodeURIComponent(session.propertyId)}`);
  $("bundleList").replaceChildren(...bundles.map(bundle => {
    const names = bundle.memberRoomIds.map(id => rooms.find(room => room.id === id)?.name).filter(Boolean);
    const row = document.createElement("article"); row.className = "bundle-row";
    const text = cell("div", `${bundle.name}｜${bundle.capacity} 人｜${bundle.basePrice} 元｜${bundle.enabled ? "啟用" : "停用"}｜${names.join("、")}`), edit = cell("button", "修改"), del = cell("button", "刪除");
    edit.className = "secondary"; del.className = "danger"; edit.onclick = () => editBundle(bundle); del.onclick = () => deleteBundle(bundle); row.append(text, edit, del); return row;
  }));
}
function editBundle(bundle) { $("bundleId").value = bundle.id; $("bundleName").value = bundle.name; $("bundleCapacity").value = bundle.capacity; $("bundlePrice").value = bundle.basePrice; $("bundleEnabled").checked = bundle.enabled; document.querySelectorAll('[name="memberRoom"]').forEach(input => { input.checked = bundle.memberRoomIds.includes(input.value); }); }
function clearBundle() { $("bundleForm").reset(); $("bundleId").value = ""; $("bundleEnabled").checked = true; }
async function deleteBundle(bundle) { if (!confirm(`確定刪除「${bundle.name}」？已使用的方案不可刪除。`)) return; try { await api(`/api/bundles/${encodeURIComponent(bundle.id)}`, { method: "DELETE", body: JSON.stringify({ customerId: session.propertyId }) }); await Promise.all([loadBundles(), loadMonth()]); } catch (error) { alert(error.message); } }

async function loadPricing() {
  const data = await api(`/api/room-pricing?customerId=${encodeURIComponent(session.propertyId)}`);
  $("roomPricing").replaceChildren(...data.rooms.map(room => {
    const form = document.createElement("form"); form.className = "pricing-row";
    form.innerHTML = `<h3></h3><label>週一至週四（元）<input name="mondayThursdayPrice" type="number" min="0" step="1" required></label><label>週五（元）<input name="fridayPrice" type="number" min="0" step="1" required></label><label>週六及連續假期（元）<input name="saturdayHolidayPrice" type="number" min="0" step="1" required></label><label>週日（元）<input name="sundayPrice" type="number" min="0" step="1" required></label><button>儲存房型價格</button>`;
    form.querySelector("h3").textContent = room.name;
    for (const key of ["mondayThursdayPrice", "fridayPrice", "saturdayHolidayPrice", "sundayPrice"]) form.elements[key].value = room[key] ?? 0;
    form.onsubmit = async event => { event.preventDefault(); const payload = { customerId: session.propertyId }; for (const key of ["mondayThursdayPrice", "fridayPrice", "saturdayHolidayPrice", "sundayPrice"]) payload[key] = Number(form.elements[key].value); try { await api(`/api/room-pricing/${encodeURIComponent(room.id)}`, { method: "PUT", body: JSON.stringify(payload) }); await loadPricing(); } catch (error) { alert(error.message); } };
    return form;
  }));
  $("overrideRoom").replaceChildren(...data.rooms.map(room => { const option = document.createElement("option"); option.value = room.id; option.textContent = room.name; return option; }));
  $("overrideList").replaceChildren(...data.overrides.map(item => cell("p", `${item.date}｜${data.rooms.find(room => room.id === item.roomId)?.name || "房型"}｜${item.price} 元`)));
}

$("bundleForm").onsubmit = async event => { event.preventDefault(); const id = $("bundleId").value, payload = { customerId: session.propertyId, name: $("bundleName").value, capacity: Number($("bundleCapacity").value), basePrice: Number($("bundlePrice").value), enabled: $("bundleEnabled").checked, memberRoomIds: [...document.querySelectorAll('[name="memberRoom"]:checked')].map(input => input.value) }; try { await api(id ? `/api/bundles/${encodeURIComponent(id)}` : "/api/bundles", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) }); clearBundle(); await Promise.all([loadBundles(), loadMonth()]); } catch (error) { alert(error.message); } };
$("overrideForm").onsubmit = async event => { event.preventDefault(); try { await api("/api/room-price-overrides", { method: "POST", body: JSON.stringify({ customerId: session.propertyId, roomId: $("overrideRoom").value, date: $("overrideDate").value, price: Number($("overridePrice").value) }) }); await loadPricing(); event.currentTarget.reset(); } catch (error) { alert(error.message); } };
async function enter(value) { session = value; $("login").hidden = true; $("workspace").hidden = false; $("logout").hidden = false; $("propertyLabel").textContent = `業者：${value.propertyId}`; $("month").value = $("month").value || currentMonth(); await Promise.all([loadMonth(), loadBundles(), loadPricing()]); }
$("loginForm").onsubmit = async event => { event.preventDefault(); try { await enter(await api("/api/admin/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) })); } catch (error) { showLogin(error.message); } };
$("month").onchange = loadMonth; $("bundleCancel").onclick = clearBundle; $("logout").onclick = async () => { await api("/api/admin/logout", { method: "POST", body: "{}" }); showLogin(); };
api("/api/admin/session").then(enter).catch(() => showLogin());
