"use strict";
const $ = id => document.getElementById(id);
let session = null;
let rooms = [];
const availabilityState = { rooms: [], days: new Map(), notesByDate: {}, view: "daily", selectedDate: "", loading: false, loadedMonth: "" };
let requestGeneration = 0;
const mutationQueues = new Map();
const mutationVersions = new Map();
const saveStates = new Map();
let noteEditorState = null;
const pricingState = { rooms: [], overrides: [], original: new Map(), dirty: false, saving: false };

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || "操作失敗");
  return body.data;
}
function cell(tag, text) { const node = document.createElement(tag); node.textContent = text; return node; }
function element(tag, className = "", text = "") { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; }
function showLogin(message = "") { session = null; noteEditorState = null; $("noteEditor").hidden = true; $("login").hidden = false; $("propertyChooser").hidden = true; $("workspace").hidden = true; $("logout").hidden = true; $("loginMessage").textContent = message; }
function showPropertyChooser(value) {
  session = value; $("login").hidden = true; $("workspace").hidden = true; $("logout").hidden = false; $("propertyChooser").hidden = false; $("propertyChoiceMessage").textContent = "";
  $("propertyChoices").replaceChildren(...value.properties.map(property => { const button = document.createElement("button"); button.type = "button"; button.textContent = property.propertyName || property.propertyId; button.onclick = async () => { button.disabled = true; try { await enter(await api("/api/admin/select-property", { method: "POST", body: JSON.stringify({ propertyId: property.propertyId }) })); } catch (error) { $("propertyChoiceMessage").textContent = error.message; button.disabled = false; } }; return button; }));
}
function currentMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function currentDateKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function monthDateKeys(year, month) { const count = new Date(year, month, 0).getDate(); return Array.from({ length: count }, (_, index) => `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`); }
function dateParts(date) { const [year, month, day] = date.split("-").map(Number), weekday = "日一二三四五六"[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]; return { year, month, day, weekday }; }
function dateLabel(date) { const part = dateParts(date), today = currentDateKey(), tomorrowDate = new Date(`${today}T00:00:00`); tomorrowDate.setDate(tomorrowDate.getDate() + 1); const tomorrow = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, "0")}-${String(tomorrowDate.getDate()).padStart(2, "0")}`; return `${part.month}/${part.day}（${part.weekday}）${date === today ? "・今天" : date === tomorrow ? "・明天" : ""}`; }
function mutationKey(kind, date, roomTypeId) { return `${kind}:${date}:${roomTypeId}`; }
function queueMutation(key, operation) { const previous = mutationQueues.get(key) || Promise.resolve(), next = previous.catch(() => {}).then(operation); mutationQueues.set(key, next); return next.finally(() => { if (mutationQueues.get(key) === next) mutationQueues.delete(key); }); }
function nextMutationVersion(key) { const version = (mutationVersions.get(key) || 0) + 1; mutationVersions.set(key, version); return version; }
function isLatestMutation(key, version) { return mutationVersions.get(key) === version; }
function inventoryTypeFor(room) { return room?.inventoryType === "bundle" ? "bundle" : "room"; }
function inventoryKey(inventoryType, inventoryId) { return `${inventoryType}:${inventoryId}`; }
function noteFor(date, room) { return availabilityState.notesByDate[date]?.[inventoryKey(inventoryTypeFor(room), room.id)] || null; }
function setNoteFor(date, inventoryType, inventoryId, note) { const key = inventoryKey(inventoryType, inventoryId); availabilityState.notesByDate[date] = availabilityState.notesByDate[date] || {}; if (note) availabilityState.notesByDate[date][key] = note; else { delete availabilityState.notesByDate[date][key]; if (!Object.keys(availabilityState.notesByDate[date]).length) delete availabilityState.notesByDate[date]; } }
function roomById(inventoryId) { return availabilityState.rooms.find(room => room.id === inventoryId); }
function hasUnsavedNote() { return Boolean(noteEditorState && $("noteText").value !== noteEditorState.original); }

function renderSaveState(container, key) {
  const state = saveStates.get(key); if (!state) return;
  const line = element("div", `save-state ${state.phase}`, state.message); container.append(line);
  if (state.phase === "failed" && state.retry) { const retry = element("button", "retry-button", "重試"); retry.type = "button"; retry.onclick = state.retry; line.append(document.createTextNode(" "), retry); }
}

function createStatusControl(date, room) {
  const wrapper = element("div", "room-status-control"), current = availabilityState.days.get(date)?.[room.id] || "closed";
  for (const [status, label] of [["available", "可售"], ["closed", "不可售"]]) {
    const button = element("button", `status-choice ${current === status ? `is-${status}` : ""}`, label); button.type = "button"; button.setAttribute("aria-pressed", String(current === status)); button.setAttribute("aria-label", `${dateLabel(date)} ${room.name}設為${label}`); button.onclick = () => saveDay(date, room, status); wrapper.append(button);
  }
  return wrapper;
}

function createRoomRow(date, room) {
  const row = element("article", "availability-room-row"), name = element("div", "room-label", room.name), actions = element("div", "room-actions"), statusArea = element("div", "room-save-area");
  actions.append(createStatusControl(date, room));
  const note = noteFor(date, room), button = element("button", `note-button${note ? " has-note" : ""}`, note ? "編輯備註" : "＋備註"); button.type = "button"; button.setAttribute("aria-label", `${dateLabel(date)} ${room.name}${note ? "有內部備註，編輯備註" : "新增內部備註"}`); button.onclick = () => openNoteEditor(date, room.id); actions.append(button);
  renderSaveState(statusArea, mutationKey("status", date, room.id)); row.append(name, actions, statusArea); return row;
}

function futureDailyDates(dates) { return dates.filter(date => date >= currentDateKey()); }
function createDayCard(date) { const day = availabilityState.days.get(date), card = element("section", `availability-day-card${date === currentDateKey() ? " is-today" : ""}`), heading = element("div", "availability-day-heading"), title = element("h3", "", dateLabel(date)), inventoryGrid = element("div", "availability-inventory-grid"); const available = availabilityState.rooms.filter(room => day[room.id] === "available").length, summary = element("span", "day-summary", `${available} 可售／${availabilityState.rooms.length - available} 不可售`); heading.append(title, summary); if (!day._hasAvailability) heading.append(element("span", "missing-data", "尚無房況資料，依不可售顯示")); inventoryGrid.append(...availabilityState.rooms.map(room => createRoomRow(date, room))); card.append(heading, inventoryGrid); return card; }
function renderDailyView() {
  const container = $("dailyAvailability");
  if (!availabilityState.rooms.length) { container.replaceChildren(element("div", "availability-empty", "目前沒有可管理的房型。")); return; }
  const dates = futureDailyDates([...availabilityState.days.keys()]);
  container.replaceChildren(...(dates.length ? dates.map(createDayCard) : [element("div", "availability-empty", "每日房況只顯示今天與未來日期；過去日期請切換到月曆查看。") ]));
}

function renderDayDetails(date) {
  const container = $("dayDetails"); if (!date || !availabilityState.days.has(date)) { container.replaceChildren(); return; }
  const title = element("h3", "", dateLabel(date)), hint = element("p", "hint", "此處與每日房況共用相同資料與儲存邏輯。"), body = element("div", "day-detail-rooms"); body.append(...availabilityState.rooms.map(room => createRoomRow(date, room))); container.replaceChildren(title, hint, body);
}

function renderCalendarView() {
  const grid = $("calendarGrid"), [year, month] = $("month").value.split("-").map(Number), dates = [...availabilityState.days.keys()];
  const nodes = "日一二三四五六".split("").map(day => element("div", "calendar-weekday", day));
  const leading = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); for (let index = 0; index < leading; index += 1) nodes.push(element("div", "calendar-cell is-empty"));
  for (const date of dates) { const day = availabilityState.days.get(date), part = dateParts(date), available = availabilityState.rooms.filter(room => day[room.id] === "available").length, closed = availabilityState.rooms.length - available, hasNote = Boolean(availabilityState.notesByDate[date] && Object.keys(availabilityState.notesByDate[date]).length), button = element("button", `calendar-cell${date === currentDateKey() ? " is-today" : ""}${date === availabilityState.selectedDate ? " is-selected" : ""}`); button.type = "button"; button.setAttribute("aria-label", `${dateLabel(date)}，${available} 個可售，${closed} 個不可售${hasNote ? "，有內部備註" : ""}`); const top = element("span", "calendar-date", String(part.day)); if (hasNote) top.append(element("i", "calendar-note-dot")); button.append(top, element("span", "calendar-count available", `${available} 可售`), element("span", "calendar-count closed", `${closed} 不可售`)); button.onclick = () => { availabilityState.selectedDate = date; renderCalendarView(); }; nodes.push(button); }
  grid.replaceChildren(...nodes); renderDayDetails(availabilityState.selectedDate);
}

function renderAvailability() {
  const daily = availabilityState.view === "daily"; $("dailyAvailability").hidden = !daily; $("availabilityCalendar").hidden = daily; document.querySelectorAll("[data-view]").forEach(button => { const active = button.dataset.view === availabilityState.view; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); }); if (daily) renderDailyView(); else renderCalendarView();
}

function switchView(view) {
  if (![/^daily$/, /^calendar$/].some(pattern => pattern.test(view))) return; availabilityState.view = view; if (!matchMedia("(max-width: 640px)").matches) localStorage.setItem("junzanAvailabilityView", view); renderAvailability();
}

async function loadMonth() {
  const generation = ++requestGeneration, [year, month] = $("month").value.split("-").map(Number); availabilityState.loading = true; $("availabilityLoading").hidden = false; $("status").textContent = "";
  try {
    const data = await api(`/api/availability/month?propertyId=${encodeURIComponent(session.propertyId)}&year=${year}&month=${month}`); if (generation !== requestGeneration) return;
    const rows = new Map((data.rows || []).map(row => [row.date, row])); availabilityState.rooms = data.rooms || []; rooms = availabilityState.rooms; availabilityState.notesByDate = data.notesByDate || {}; availabilityState.days = new Map(monthDateKeys(year, month).map(date => { const row = rows.get(date), normalized = { date, _hasAvailability: Boolean(row) }; for (const room of rooms) normalized[room.id] = row?.[room.id] === "available" ? "available" : "closed"; return [date, normalized]; }));
    availabilityState.selectedDate = availabilityState.days.has(currentDateKey()) ? currentDateKey() : [...availabilityState.days.keys()][0] || ""; availabilityState.loadedMonth = $("month").value; renderMembers(); renderAvailability(); $("status").textContent = "房況已載入";
  } catch (error) { if (generation === requestGeneration) $("status").textContent = `房況載入失敗：${error.message}，請稍後重試。`; }
  finally { if (generation === requestGeneration) { availabilityState.loading = false; $("availabilityLoading").hidden = true; } }
}
async function saveDay(date, room, status) {
  if (room.inventoryType === "bundle" && !confirm(status === "closed" ? "關閉此包棟方案，將同時關閉包含的所有房間。" : "開放此包棟方案，將同時開放包含的所有房間。")) return;
  const key = mutationKey("status", date, room.id), version = nextMutationVersion(key), retry = () => saveDay(date, room, status); saveStates.set(key, { phase: "saving", message: "儲存中…" }); renderAvailability();
  return queueMutation(key, async () => { try { const data = await api("/api/availability/day", { method: "POST", body: JSON.stringify({ propertyId: session.propertyId, date, roomTypeId: room.id, status }) }); const row = data.row || {}; if (availabilityState.days.has(date)) for (const currentRoom of availabilityState.rooms) if (row[currentRoom.id]) availabilityState.days.get(date)[currentRoom.id] = row[currentRoom.id]; if (isLatestMutation(key, version)) saveStates.set(key, { phase: "success", message: "已儲存" }); }
    catch (error) { if (isLatestMutation(key, version)) saveStates.set(key, { phase: "failed", message: `儲存失敗：${error.message}`, retry }); } finally { renderAvailability(); } });
}

function openNoteEditor(date, roomTypeId) {
  if (hasUnsavedNote() && !confirm("目前備註尚未儲存，確定要放棄變更嗎？")) return; const room = roomById(roomTypeId), inventoryType = inventoryTypeFor(room), item = noteFor(date, room); noteEditorState = { date, inventoryType, inventoryId: roomTypeId, original: item?.note || "" }; $("noteEditorTitle").textContent = `${dateLabel(date)}｜${room?.name || "房型或方案"}`; $("noteText").value = noteEditorState.original; $("noteStatus").textContent = item ? "已載入目前備註" : "尚無備註"; $("noteEditor").hidden = false; updateNoteCount(); $("noteText").focus(); $("noteEditor").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function updateNoteCount() { $("noteCount").textContent = `${$("noteText").value.length} / 1000`; }
function closeNoteEditor() { if (hasUnsavedNote() && !confirm("備註尚未儲存，確定關閉嗎？")) return; noteEditorState = null; $("noteEditor").hidden = true; $("noteStatus").textContent = ""; }
async function saveNote(value = $("noteText").value) {
  if (!noteEditorState) return; const { date, inventoryType, inventoryId } = noteEditorState, key = mutationKey("note", date, inventoryKey(inventoryType, inventoryId)), version = nextMutationVersion(key), draft = String(value); $("noteSave").disabled = true; $("noteClear").disabled = true; $("noteStatus").textContent = "儲存中…";
  return queueMutation(key, async () => { try { const data = await api("/api/availability/day-note", { method: "PUT", body: JSON.stringify({ propertyId: session.propertyId, date, inventoryType, inventoryId, note: draft }) }); setNoteFor(date, inventoryType, inventoryId, data.note); if (isLatestMutation(key, version)) { noteEditorState.original = data.note?.note || ""; $("noteText").value = noteEditorState.original; updateNoteCount(); $("noteStatus").textContent = data.note ? "已儲存內部備註" : "備註已清除"; } renderAvailability(); }
    catch (error) { if (isLatestMutation(key, version)) $("noteStatus").textContent = `儲存失敗：${error.message}。輸入內容仍保留，請重試。`; }
    finally { if (isLatestMutation(key, version)) { $("noteSave").disabled = false; $("noteClear").disabled = false; } } });
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
    const text = cell("div", `${bundle.name}｜${bundle.capacity} 人｜週一至週四 ${bundle.mondayThursdayPrice} 元｜週五 ${bundle.fridayPrice} 元｜週六及連續假期 ${bundle.saturdayHolidayPrice} 元｜週日 ${bundle.sundayPrice} 元｜${bundle.enabled ? "啟用" : "停用"}｜${names.join("、")}`), edit = cell("button", "修改"), del = cell("button", "刪除");
    edit.className = "secondary"; del.className = "danger"; edit.onclick = () => editBundle(bundle); del.onclick = () => deleteBundle(bundle); row.append(text, edit, del); return row;
  }));
}
function editBundle(bundle) { $("bundleId").value = bundle.id; $("bundleName").value = bundle.name; $("bundleCapacity").value = bundle.capacity; $("bundleMondayThursdayPrice").value = bundle.mondayThursdayPrice; $("bundleFridayPrice").value = bundle.fridayPrice; $("bundleSaturdayHolidayPrice").value = bundle.saturdayHolidayPrice; $("bundleSundayPrice").value = bundle.sundayPrice; $("bundleEnabled").checked = bundle.enabled; document.querySelectorAll('[name="memberRoom"]').forEach(input => { input.checked = bundle.memberRoomIds.includes(input.value); }); }
function clearBundle() { $("bundleForm").reset(); $("bundleId").value = ""; $("bundleEnabled").checked = true; }
async function deleteBundle(bundle) { if (!confirm(`確定刪除「${bundle.name}」？已使用的方案不可刪除。`)) return; try { await api(`/api/bundles/${encodeURIComponent(bundle.id)}`, { method: "DELETE", body: JSON.stringify({ customerId: session.propertyId }) }); await Promise.all([loadBundles(), loadMonth()]); } catch (error) { alert(error.message); } }

const priceKeys = ["mondayThursdayPrice", "fridayPrice", "saturdayHolidayPrice", "sundayPrice"];
function currentPricingRows() { return [...$("roomPricing").querySelectorAll("tr[data-room-id]")].map(row => { const item = { roomTypeId: row.dataset.roomId }; for (const key of priceKeys) item[key] = Number(row.querySelector(`[data-price-key="${key}"]`).value); return item; }); }
function updatePricingDirty() {
  pricingState.dirty = currentPricingRows().some(row => priceKeys.some(key => row[key] !== pricingState.original.get(row.roomTypeId)?.[key]));
  $("pricingSave").disabled = pricingState.saving || !pricingState.dirty;
  if (!pricingState.saving) $("pricingStatus").textContent = pricingState.dirty ? "有未儲存變更" : "";
}
function setPricingInputsDisabled(disabled) { $("roomPricing").querySelectorAll("input[data-price-key]").forEach(input => { input.disabled = disabled; }); }
function renderPricingMatrix(data) {
  pricingState.rooms = data.rooms; pricingState.overrides = data.overrides; pricingState.original = new Map(data.rooms.map(room => [room.id, Object.fromEntries(priceKeys.map(key => [key, Number(room[key] ?? 0)]))])); pricingState.dirty = false;
  const wrap = element("div", "pricing-matrix-scroll"), table = element("table", "pricing-matrix"), head = document.createElement("thead"), headRow = document.createElement("tr"), body = document.createElement("tbody");
  for (const label of ["房型", "週一至週四", "週五", "週六及連續假期", "週日"]) headRow.append(cell("th", label)); head.append(headRow);
  for (const room of data.rooms) { const row = document.createElement("tr"); row.dataset.roomId = room.id; row.append(cell("th", room.name)); for (const key of priceKeys) { const td = document.createElement("td"), input = document.createElement("input"); input.type = "number"; input.min = "0"; input.step = "1"; input.required = true; input.value = room[key] ?? 0; input.dataset.priceKey = key; input.setAttribute("aria-label", `${room.name} ${key}`); input.oninput = updatePricingDirty; td.append(input); row.append(td); } body.append(row); }
  table.append(head, body); wrap.append(table); $("roomPricing").replaceChildren(wrap); $("pricingSave").disabled = true; $("pricingStatus").textContent = "";
}
async function savePricingMatrix() {
  const form = $("pricingMatrixForm"); if (!form.reportValidity()) return; const rows = currentPricingRows(); pricingState.saving = true; setPricingInputsDisabled(true); $("pricingSave").disabled = true; $("pricingStatus").textContent = "儲存中…";
  try { const data = await api("/api/room-pricing", { method: "PUT", body: JSON.stringify({ propertyId: session.propertyId, rooms: rows }) }); renderPricingMatrix(data); $("pricingStatus").textContent = "房型價格已全部儲存"; }
  catch (error) { pricingState.dirty = true; $("pricingStatus").textContent = `儲存失敗：${error.message}。輸入內容仍保留，請重試。`; }
  finally { pricingState.saving = false; setPricingInputsDisabled(false); $("pricingSave").disabled = !pricingState.dirty; }
}
async function loadPricing() {
  const data = await api(`/api/room-pricing?customerId=${encodeURIComponent(session.propertyId)}`);
  renderPricingMatrix(data);
  $("overrideRoom").replaceChildren(...data.rooms.map(room => { const option = document.createElement("option"); option.value = room.id; option.textContent = room.name; return option; }));
  $("overrideList").replaceChildren(...data.overrides.map(item => cell("p", `${item.date}｜${data.rooms.find(room => room.id === item.roomId)?.name || "房型"}｜${item.price} 元`)));
}

$("bundleForm").onsubmit = async event => { event.preventDefault(); const id = $("bundleId").value, payload = { customerId: session.propertyId, name: $("bundleName").value, capacity: Number($("bundleCapacity").value), mondayThursdayPrice: Number($("bundleMondayThursdayPrice").value), fridayPrice: Number($("bundleFridayPrice").value), saturdayHolidayPrice: Number($("bundleSaturdayHolidayPrice").value), sundayPrice: Number($("bundleSundayPrice").value), enabled: $("bundleEnabled").checked, memberRoomIds: [...document.querySelectorAll('[name="memberRoom"]:checked')].map(input => input.value) }; try { await api(id ? `/api/bundles/${encodeURIComponent(id)}` : "/api/bundles", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) }); clearBundle(); await Promise.all([loadBundles(), loadMonth()]); } catch (error) { alert(error.message); } };
$("pricingMatrixForm").onsubmit = event => { event.preventDefault(); savePricingMatrix(); };
$("overrideForm").onsubmit = async event => { event.preventDefault(); try { await api("/api/room-price-overrides", { method: "POST", body: JSON.stringify({ customerId: session.propertyId, roomId: $("overrideRoom").value, date: $("overrideDate").value, price: Number($("overridePrice").value) }) }); await loadPricing(); event.currentTarget.reset(); } catch (error) { alert(error.message); } };
async function enter(value) { if (value.requiresPropertySelection || !value.propertyId) return showPropertyChooser(value); session = value; $("login").hidden = true; $("propertyChooser").hidden = true; $("workspace").hidden = false; $("logout").hidden = false; $("propertyLabel").textContent = `業者：${value.propertyId}`; $("month").value = $("month").value || currentMonth(); let savedView = "daily"; try { savedView = localStorage.getItem("junzanAvailabilityView") || "daily"; } catch {} availabilityState.view = matchMedia("(max-width: 640px)").matches ? "daily" : ["daily", "calendar"].includes(savedView) ? savedView : "daily"; await Promise.all([loadMonth(), loadBundles(), loadPricing()]); }
$("loginForm").onsubmit = async event => { event.preventDefault(); try { await enter(await api("/api/admin/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) })); } catch (error) { showLogin(error.message); } };
document.querySelectorAll("[data-view]").forEach(button => { button.onclick = () => switchView(button.dataset.view); });
$("noteText").oninput = updateNoteCount; $("noteSave").onclick = () => saveNote(); $("noteClear").onclick = () => saveNote(""); $("noteClose").onclick = closeNoteEditor;
$("month").onchange = () => { if (hasUnsavedNote() && !confirm("備註尚未儲存，確定切換月份嗎？")) { $("month").value = availabilityState.loadedMonth; return; } noteEditorState = null; $("noteEditor").hidden = true; loadMonth(); };
$("bundleCancel").onclick = clearBundle; $("logout").onclick = async () => { await api("/api/admin/logout", { method: "POST", body: "{}" }); showLogin(); };
window.addEventListener("beforeunload", event => { if (!hasUnsavedNote() && !pricingState.dirty && !mutationQueues.size) return; event.preventDefault(); event.returnValue = ""; });
api("/api/admin/session").then(enter).catch(() => showLogin());
