"use strict";
const $ = id => document.getElementById(id);
let session = null;
let rooms = [];
let propertyFacts = [];
let customReplies = [];
const customReplyTopics=[["booking_open","訂房開放"],["booking_paused","暫停受理"],["price_unannounced","價格尚未公告"],["room","房型"],["bundle","包棟"],["parking_notice","停車臨時公告"],["facility_notice","設施臨時公告"],["checkin_checkout","入住／退房"],["lodging_rules","住宿規則"],["temporary_operation","臨時營運公告"]];
const customReplyScopes=[["all","全部"],["room_only","單訂房間"],["bundle","包棟"],["room_type","指定房型"]];
const bundleAmenityPresets=[["singing","KTV／歡唱設備"],["electric_mahjong","電動麻將桌"],["mahjong","一般麻將"],["board_games","桌遊"],["game_console","Switch／遊戲主機"],["projector","投影機／大螢幕"],["billiards","撞球桌"],["darts","飛鏢"],["table_football","桌上足球"],["massage_chair","按摩椅"],["bbq","烤肉區／烤肉設備"],["splash_pool","戲水池"],["swimming_pool","游泳池"],["children_play_area","兒童遊戲區"],["slide","溜滑梯"],["sandpit","沙坑"],["outdoor_yard","戶外庭院"],["shared_living_room","公共客廳"],["kitchen","廚房"],["hot_pot_equipment","火鍋設備"],["streaming_media","Netflix／影音串流"]];
function renderBundleAmenities(items=[]){const byKey=new Map(items.map(item=>[item.key,item]));const nodes=bundleAmenityPresets.map(([key,name])=>{const item=byKey.get(key)||{},row=element("div","amenity-row"),check=document.createElement("input"),label=document.createElement("label"),noteLabel=document.createElement("label"),note=document.createElement("input");row.dataset.amenityKey=key;check.type="checkbox";check.checked=item.provided===true;check.dataset.amenityProvided="";label.append(check,document.createTextNode(name));note.maxLength=100;note.value=check.checked?item.note||"":"";note.dataset.amenityNote="";noteLabel.append(document.createTextNode("備註（選填）"),note);noteLabel.hidden=!check.checked;check.onchange=()=>{noteLabel.hidden=!check.checked;if(!check.checked)note.value=""};row.append(label,noteLabel);return row});for(const item of items.filter(item=>item.source==="custom"&&item.provided)){const row=element("div","custom-amenity-row"),name=document.createElement("input"),note=document.createElement("input"),remove=cell("button","刪除");name.value=item.displayName||"";name.maxLength=20;name.dataset.customAmenityName="";note.value=item.note||"";note.maxLength=100;note.dataset.customAmenityNote="";remove.type="button";remove.className="secondary";remove.onclick=()=>row.remove();row.append(name,note,remove);nodes.push(row)}$("bundleAmenities").replaceChildren(...nodes)}
function collectBundleAmenities(){const presets=[...$("bundleAmenities").querySelectorAll("[data-amenity-key]")].map((row,position)=>{const input=row.querySelector("[data-amenity-provided]"),preset=bundleAmenityPresets[position];return{key:preset[0],displayName:preset[1],provided:input.checked,note:input.checked?row.querySelector("[data-amenity-note]").value:"",source:"preset",position}});const custom=[...$("bundleAmenities").querySelectorAll(".custom-amenity-row")].map((row,index)=>({key:"",displayName:row.querySelector("[data-custom-amenity-name]").value,provided:true,note:row.querySelector("[data-custom-amenity-note]").value,source:"custom",position:bundleAmenityPresets.length+index}));return presets.concat(custom)}
const availabilityState = { rooms: [], days: new Map(), notesByDate: {}, selection: "rolling", selectedDate: "", loading: false, loadedSelection: "" };
let requestGeneration = 0;
const mutationQueues = new Map();
const mutationVersions = new Map();
const saveStates = new Map();
let noteEditorState = null;
const pricingState = { rooms: [], overrides: [], original: new Map(), dirty: false, saving: false };
const expectedSlug = (() => { const parts = location.pathname.split("/").filter(Boolean); return parts.length === 2 && parts[1] === "admin" ? parts[0] : ""; })();

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || "操作失敗");
  return body.data;
}
function cell(tag, text) { const node = document.createElement(tag); node.textContent = text; return node; }
function element(tag, className = "", text = "") { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; }
function propertyFactField(labelText, control) { const label = document.createElement("label"); label.append(document.createTextNode(labelText), control); return label; }
function propertyFactInput(field, value = "", options = {}) { const input = document.createElement(options.multiline ? "textarea" : "input"); input.dataset.propertyFactField = field; input.value = value; if (options.multiline) input.rows = options.rows || 2; else input.type = options.type || "text"; if (options.placeholder) input.placeholder = options.placeholder; return input; }
function propertyFactSelect(field, value, options) { const select = document.createElement("select"); select.dataset.propertyFactField = field; for (const [key, label] of options) { const option = document.createElement("option"); option.value = key; option.textContent = label; select.append(option); } select.value = value; return select; }
function propertyFactRow(fact = {}) {
  const row = element("fieldset", "property-fact-row"), legend = document.createElement("legend"), grid = element("div", "property-fact-grid"), remove = element("button", "danger", "刪除此筆");
  legend.textContent = fact.canonicalId || "新增正式資料"; remove.type = "button"; remove.onclick = () => row.remove();
  const canonicalId = propertyFactInput("canonicalId", fact.canonicalId || "", { placeholder: "例如 parking、bbq、pool" });
  canonicalId.required = true; canonicalId.pattern = "[a-z][a-z0-9_]{0,79}"; canonicalId.oninput = () => { legend.textContent = canonicalId.value || "新增正式資料"; };
  const category = propertyFactSelect("category", fact.category || "amenity", [["amenity", "設施"], ["policy", "規則"], ["property_fact", "旅宿資料"], ["location", "位置／導航"], ["room_fact", "房型資料"], ["room_amenity", "房內設備"], ["contact", "聯絡資料"]]);
  const status = propertyFactSelect("status", fact.status || "unknown", [["allowed", "提供／允許"], ["conditional", "有條件提供"], ["not_allowed", "不提供／不允許"], ["unknown", "尚未確認"]]);
  const appliesTo = propertyFactSelect("appliesTo", fact.appliesTo || "whole_property", [["whole_property", "整間旅宿"], ["room_only", "僅房間"], ["both", "整間與房間"]]);
  const advance = propertyFactSelect("advanceNoticeRequired", fact.advanceNoticeRequired === true ? "true" : fact.advanceNoticeRequired === false ? "false" : "", [["", "尚未確認"], ["true", "需要"], ["false", "不需要"]]);
  const reservation = propertyFactSelect("reservationRequired", fact.reservationRequired === true ? "true" : fact.reservationRequired === false ? "false" : "", [["", "尚未確認"], ["true", "需要"], ["false", "不需要"]]);
  const publicText = propertyFactInput("publicText", fact.publicText || "", { multiline: true, rows: 3, placeholder: "業者核准、可直接提供給客人的正式內容" });
  const fees = propertyFactInput("fees", JSON.stringify(fact.fees || []), { multiline: true, placeholder: '[{"label":"費用","amount":100,"currency":"TWD","unit":"person"}]' });
  const conditions = propertyFactInput("conditions", (fact.conditions || []).join("\n"), { multiline: true, placeholder: "每行一項條件" });
  const restrictions = propertyFactInput("restrictions", (fact.restrictions || []).join("\n"), { multiline: true, placeholder: "每行一項限制" });
  const operatingHours = propertyFactInput("operatingHours", JSON.stringify(fact.operatingHours || []), { multiline: true, placeholder: '[{"label":"每日","start":"09:00","end":"18:00"}]' });
  const availablePeriods = propertyFactInput("availablePeriods", JSON.stringify(fact.availablePeriods || []), { multiline: true, placeholder: '[{"label":"暑期","startDate":"2026-07-01","endDate":"2026-08-31"}]' });
  const notes = propertyFactInput("notes", fact.notes || "", { multiline: true });
  const source = propertyFactInput("source", fact.source || "operator_form");
  const updatedAt = propertyFactInput("updatedAt", fact.updatedAt || ""); updatedAt.type = "hidden";
  grid.append(
    propertyFactField("Canonical ID", canonicalId), propertyFactField("資料類型", category),
    propertyFactField("正式狀態", status), propertyFactField("適用範圍", appliesTo),
    propertyFactField("正式公開內容", publicText), propertyFactField("費用（JSON 陣列）", fees),
    propertyFactField("需提前告知", advance), propertyFactField("需事先預約", reservation),
    propertyFactField("條件（每行一項）", conditions), propertyFactField("限制（每行一項）", restrictions),
    propertyFactField("使用時段（JSON 陣列）", operatingHours), propertyFactField("適用期間（JSON 陣列）", availablePeriods),
    propertyFactField("內部補充", notes), propertyFactField("資料來源代碼", source), updatedAt
  );
  row.append(legend, grid, remove); return row;
}
function renderPropertyFacts(facts = []) { propertyFacts = facts; $("propertyFactsList").replaceChildren(...facts.map(propertyFactRow)); }
function collectPropertyFactDrafts() { return [...$("propertyFactsList").querySelectorAll(".property-fact-row")].map(row => Object.fromEntries([...row.querySelectorAll("[data-property-fact-field]")].map(control => [control.dataset.propertyFactField, control.value]))); }
async function loadPropertyFacts() { const data = await api(`/api/property-facts?propertyId=${encodeURIComponent(session.propertyId)}`); renderPropertyFacts(data.facts || []); }
function customReplyStateLabel(state){return({active:"啟用中",pending:"尚未生效",expired:"已失效",disabled:"已停用"}[state]||"已停用")}
function fillCustomReplyOptions(){
  if(!$("customReplyTopic").options.length)$("customReplyTopic").append(...customReplyTopics.map(([value,label])=>{const option=document.createElement("option");option.value=value;option.textContent=label;return option}));
  if(!$("customReplyScope").options.length)$("customReplyScope").append(...customReplyScopes.map(([value,label])=>{const option=document.createElement("option");option.value=value;option.textContent=label;return option}));
  const selected=$("customReplyRoomType").value;$("customReplyRoomType").replaceChildren(...rooms.filter(room=>room.inventoryType!=="bundle").map(room=>{const option=document.createElement("option");option.value=room.id;option.textContent=room.name;return option}));if(selected)$("customReplyRoomType").value=selected;
}
function toggleCustomReplyRoomField(){$("customReplyRoomField").hidden=$("customReplyScope").value!=="room_type"}
function clearCustomReplyForm(){$("customReplyForm").reset();$("customReplyId").value="";$("customReplyEnabled").checked=true;$("customReplyEffectiveStart").value=currentDateKey();$("customReplyStatus").textContent="";toggleCustomReplyRoomField()}
function editCustomReply(rule){$("customReplyId").value=rule.ruleId;$("customReplyName").value=rule.name;$("customReplyTopic").value=rule.topic;$("customReplyScope").value=rule.scope;$("customReplyRoomType").value=rule.roomTypeId||"";$("customReplyStayStart").value=rule.stayStartDate||"";$("customReplyStayEnd").value=rule.stayEndDate||"";$("customReplyEffectiveStart").value=rule.effectiveStartDate;$("customReplyEffectiveEnd").value=rule.effectiveEndDate;$("customReplyText").value=rule.approvedReply;$("customReplyEnabled").checked=rule.enabled;toggleCustomReplyRoomField();$("customReplyForm").scrollIntoView({behavior:"smooth",block:"nearest"})}
async function setCustomReplyEnabled(rule,enabled){try{await api(`/api/custom-replies/${encodeURIComponent(rule.ruleId)}/enabled`,{method:"PATCH",body:JSON.stringify({propertyId:session.propertyId,enabled})});await loadCustomReplies()}catch(error){$("customReplyStatus").textContent=error.message}}
async function removeCustomReply(rule){if(!confirm(`確定刪除「${rule.name}」嗎？`))return;try{await api(`/api/custom-replies/${encodeURIComponent(rule.ruleId)}`,{method:"DELETE",body:JSON.stringify({propertyId:session.propertyId})});await loadCustomReplies()}catch(error){$("customReplyStatus").textContent=error.message}}
function renderCustomReplies(data){customReplies=data.items||[];$("customReplyUsage").textContent=`已使用 ${data.used||0}／${data.limit||5}`;fillCustomReplyOptions();$("customReplyList").replaceChildren(...customReplies.map(rule=>{const row=element("article","custom-reply-row"),details=element("div","custom-reply-details"),title=element("strong","",rule.name),topic=element("span","",customReplyTopics.find(item=>item[0]===rule.topic)?.[1]||rule.topic),state=element("span",`custom-reply-state ${rule.state}`,customReplyStateLabel(rule.state)),scope=element("span","",customReplyScopes.find(item=>item[0]===rule.scope)?.[1]||rule.scope),dates=element("span","",`${rule.effectiveStartDate}～${rule.effectiveEndDate}`),edit=element("button","secondary","編輯"),toggle=element("button","secondary",rule.enabled?"停用":"啟用"),del=element("button","danger","刪除");edit.type=toggle.type=del.type="button";edit.onclick=()=>editCustomReply(rule);toggle.onclick=()=>setCustomReplyEnabled(rule,!rule.enabled);del.onclick=()=>removeCustomReply(rule);details.append(title,topic,scope,state,dates);row.append(details,edit,toggle,del);return row}))}
async function loadCustomReplies(){renderCustomReplies(await api(`/api/custom-replies?propertyId=${encodeURIComponent(session.propertyId)}`))}
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
  const wrapper = element("div", "room-status-control"), current = availabilityState.days.get(date)?.[room.id] || "closed", available = current === "available";
  const label = element("span", "status-text", available ? "可售" : "不可售");
  const input = document.createElement("input"); input.type = "checkbox"; input.className = "status-toggle"; input.checked = available; input.setAttribute("aria-label", `${dateLabel(date)} ${room.name}目前${label.textContent}`); input.onchange = () => saveDay(date, room, input.checked ? "available" : "closed");
  wrapper.append(label, input);
  return wrapper;
}

function createRoomRow(date, room) {
  const row = element("article", "availability-room-row"), name = element("div", "room-label", room.name), actions = element("div", "room-actions"), statusArea = element("div", "room-save-area");
  actions.append(createStatusControl(date, room));
  const note = noteFor(date, room), button = element("button", `note-button${note ? " has-note" : ""}`, note ? "編輯備註" : "＋備註"); button.type = "button"; button.setAttribute("aria-label", `${dateLabel(date)} ${room.name}${note ? "有內部備註，編輯備註" : "新增內部備註"}`); button.onclick = () => openNoteEditor(date, room.id); actions.append(button);
  renderSaveState(statusArea, mutationKey("status", date, room.id)); row.append(name, actions, statusArea); return row;
}

function renderMonthlyInventoryControls() {
  const container = $("monthlyInventoryControls"); if (!container) return;
  const plan = AdminAvailabilityWindow.availabilityBulkPlan(currentDateKey(), availabilityState.selection);
  if (!availabilityState.rooms.length) { container.replaceChildren(); return; }
  const heading = element("div", "monthly-inventory-heading", plan.allowed ? "\u672c\u6708\u623f\u6cc1" : "\u8acb\u5148\u9078\u64c7\u6708\u4efd"), grid = element("div", "monthly-inventory-grid");
  for (const room of availabilityState.rooms) {
    const card = element("article", "monthly-inventory-item"), name = element("strong", "room-label", room.name), actions = element("div", "monthly-inventory-actions"), status = element("span", "save-state");
    const open = element("button", "", "\u672c\u6708\u5168\u958b"), close = element("button", "secondary", "\u672c\u6708\u5168\u95dc"); open.type = close.type = "button"; open.disabled = close.disabled = !plan.allowed;
    const save = async value => { const [year, month] = availabilityState.selection.split("-").map(Number); open.disabled = close.disabled = true; status.textContent = "\u5132\u5b58\u4e2d\u2026"; try { await api("/api/availability/month", { method: "POST", body: JSON.stringify({ customerId: session.propertyId, year, month, roomId: room.id, status: value }) }); status.textContent = "\u5df2\u5132\u5b58"; await loadMonth(); } catch (error) { status.textContent = `\u5132\u5b58\u5931\u6557\uff1a${error.message}`; open.disabled = close.disabled = !plan.allowed; } };
    open.onclick = () => save("available"); close.onclick = () => save("closed"); actions.append(open, close); card.append(name, actions, status); grid.append(card);
  }
  container.replaceChildren(heading, grid);
}

function createDayCard(date) { const day = availabilityState.days.get(date), card = element("section", `availability-day-card${date === currentDateKey() ? " is-today" : ""}`), heading = element("div", "availability-day-heading"), title = element("h3", "", dateLabel(date)), inventoryGrid = element("div", "availability-inventory-grid"); const available = availabilityState.rooms.filter(room => day[room.id] === "available").length, summary = element("span", "day-summary", `${available} 可售／${availabilityState.rooms.length - available} 不可售`); heading.append(title, summary); if (!day._hasAvailability) heading.append(element("span", "missing-data", "尚無房況資料，依不可售顯示")); inventoryGrid.append(...availabilityState.rooms.map(room => createRoomRow(date, room))); card.append(heading, inventoryGrid); return card; }
function renderDailyView() {
  const container = $("dailyAvailability");
  if (!availabilityState.rooms.length) { container.replaceChildren(element("div", "availability-empty", "目前沒有可管理的房型。")); return; }
  const dates = [...availabilityState.days.keys()];
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
  for (const date of dates) { const day = availabilityState.days.get(date), part = dateParts(date), available = availabilityState.rooms.filter(room => day[room.id] === "available").length, closed = availabilityState.rooms.length - available, hasNote = Boolean(availabilityState.notesByDate[date] && Object.keys(availabilityState.notesByDate[date]).length), button = element("button", `calendar-cell${date === currentDateKey() ? " is-today" : ""}${date === availabilityState.selectedDate ? " is-selected" : ""}`); button.type = "button"; button.setAttribute("aria-label", `${dateLabel(date)}，${available} 個可售，${closed} 個不可售${hasNote ? "，有內部備註" : ""}`); const top = element("span", "calendar-date", String(part.day)); if (hasNote) top.append(element("i", "calendar-note-dot")); button.append(top, element("span", "calendar-count available", `${available} 可售`), element("span", "calendar-count closed", `${closed} 不可售`), element("span", "calendar-note-action", hasNote ? "查看備註" : "＋備註")); button.onclick = () => { availabilityState.selectedDate = date; renderCalendarView(); }; nodes.push(button); }
  grid.replaceChildren(...nodes); renderDayDetails(availabilityState.selectedDate);
}

function renderAvailability() {
  renderMonthlyInventoryControls();
  $("dailyAvailability").hidden = false; $("availabilityCalendar").hidden = true; renderDailyView();
}

async function loadMonth() {
  const generation = ++requestGeneration, plan = AdminAvailabilityWindow.availabilityLoadPlan(currentDateKey(), availabilityState.selection), months = plan.months; availabilityState.loading = true; $("availabilityLoading").hidden = false; $("status").textContent = "";
  try {
    const pages = await Promise.all(months.map(async value => { const [year, month] = value.split("-").map(Number); return api(`/api/availability/month?propertyId=${encodeURIComponent(session.propertyId)}&year=${year}&month=${month}`); })); if (generation !== requestGeneration) return;
    const data = pages[0] || { rooms: [], rows: [], notesByDate: {} }, rows = new Map(pages.flatMap(page => page.rows || []).map(row => [row.date, row])), dateKeys = plan.dateKeys; availabilityState.rooms = data.rooms || []; rooms = availabilityState.rooms; availabilityState.notesByDate = Object.assign({}, ...pages.map(page => page.notesByDate || {})); availabilityState.days = new Map(dateKeys.map(date => { const row = rows.get(date), normalized = { date, _hasAvailability: Boolean(row) }; for (const room of rooms) normalized[room.id] = row?.[room.id] === "available" ? "available" : "closed"; return [date, normalized]; }));
    availabilityState.selectedDate = availabilityState.days.has(currentDateKey()) ? currentDateKey() : [...availabilityState.days.keys()][0] || ""; availabilityState.loadedSelection = availabilityState.selection; renderMembers(); renderAvailability(); if (availabilityState.refreshBulk) availabilityState.refreshBulk(); $("status").textContent = "房況已載入";
  } catch (error) { if (generation === requestGeneration) $("status").textContent = `房況載入失敗：${error.message}，請稍後重試。`; }
  finally { if (generation === requestGeneration) { availabilityState.loading = false; $("availabilityLoading").hidden = true; } }
}
async function saveDay(date, room, status) {
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
    const details = element("div", "bundle-details");
    details.append(element("strong", "bundle-name", bundle.name), element("span", "bundle-capacity", `人數：${bundle.capacity} 人`), element("span", "bundle-price", `基本價格：NT$${new Intl.NumberFormat("zh-TW").format(bundle.mondayThursdayPrice)}`), element("span", "bundle-status", `狀態：${bundle.enabled ? "啟用" : "停用"}`), element("span", "bundle-members", `包含房型：${names.length ? names.join("、") : "未設定"}`));
    const edit = cell("button", "修改"), del = cell("button", "刪除");
    edit.className = "secondary"; del.className = "danger"; edit.onclick = () => editBundle(bundle); del.onclick = () => deleteBundle(bundle); row.append(details, edit, del); return row;
  }));
}
function editBundle(bundle) { $("bundleId").value = bundle.id; $("bundleName").value = bundle.name; $("bundleCapacity").value = bundle.capacity; $("bundleMondayThursdayPrice").value = bundle.mondayThursdayPrice; $("bundleFridayPrice").value = bundle.fridayPrice; $("bundleSaturdayHolidayPrice").value = bundle.saturdayHolidayPrice; $("bundleSundayPrice").value = bundle.sundayPrice; $("bundleEnabled").checked = bundle.enabled; document.querySelectorAll('[name="memberRoom"]').forEach(input => { input.checked = bundle.memberRoomIds.includes(input.value); }); renderBundleAmenities(bundle.entertainmentAmenities); }
function clearBundle() { $("bundleForm").reset(); $("bundleId").value = ""; $("bundleEnabled").checked = true; renderBundleAmenities(); }
async function deleteBundle(bundle) { if (!confirm(`確定刪除「${bundle.name}」？已使用的方案不可刪除。`)) return; try { await api(`/api/bundles/${encodeURIComponent(bundle.id)}`, { method: "DELETE", body: JSON.stringify({ customerId: session.propertyId }) }); await Promise.all([loadBundles(), loadMonth()]); } catch (error) { alert(error.message); } }

const priceKeys = ["mondayThursdayPrice", "fridayPrice", "saturdayHolidayPrice", "sundayPrice"];
function currentPricingRows() { return [...$("roomPricing").querySelectorAll("tr[data-room-id]")].map(row => { const details=$("roomDetails").querySelector(`[data-room-detail-id="${CSS.escape(row.dataset.roomId)}"]`),item={roomTypeId:row.dataset.roomId,roomCode:details.querySelector('[data-room-field="roomCode"]').value,displayName:details.querySelector('[data-room-field="displayName"]').value,capacity:Number(details.querySelector('[data-room-field="capacity"]').value),highlights:[...details.querySelectorAll('[data-room-field="highlight"]')].map(input=>input.value),enabled:details.querySelector('[data-room-field="enabled"]').checked};for (const key of priceKeys) item[key] = Number(row.querySelector(`[data-price-key="${key}"]`).value); return item; }); }
function updatePricingDirty() {
  pricingState.dirty = currentPricingRows().some(row => JSON.stringify(row)!==JSON.stringify(pricingState.original.get(row.roomTypeId)));
  $("pricingSave").disabled = pricingState.saving || !pricingState.dirty;
  if (!pricingState.saving) $("pricingStatus").textContent = pricingState.dirty ? "有未儲存變更" : "";
}
function setPricingInputsDisabled(disabled) { document.querySelectorAll("#roomPricing input, #roomDetails input").forEach(input => { input.disabled = disabled; }); }
function renderPricingMatrix(data) {
  pricingState.rooms = data.rooms; pricingState.overrides = data.overrides; pricingState.dirty = false;
  $("roomDetails").replaceChildren(...data.rooms.map(room=>{const card=element("article","room-detail-card");card.dataset.roomDetailId=room.id;const title=element("h3",undefined,room.displayName||room.name),fields=element("div","room-detail-grid");const input=(label,key,value,type="text")=>{const wrap=document.createElement("label"),node=document.createElement("input");wrap.append(document.createTextNode(label));node.type=type;node.value=value??"";node.dataset.roomField=key;if(key==="displayName"||key==="capacity")node.required=true;if(type==="number"){node.min="1";node.step="1";}node.oninput=updatePricingDirty;wrap.append(node);return wrap;};fields.append(input("房型代號／房號（選填）","roomCode",room.roomCode||""),input("房型顯示名稱","displayName",room.displayName||room.name),input("最多入住人數","capacity",room.capacity,"number"));const highlights=element("fieldset","room-highlight-fields"),legend=document.createElement("legend"),hint=element("p","hint","顯示於旅客查房頁；目前不提供 AI 回答。空白項目不會保存或顯示。");legend.textContent="房型特色（選填，最多3項）";highlights.append(legend,hint);for(let i=0;i<3;i++){const node=input(`特色 ${i+1}`,"highlight",(room.highlights||[])[i]||"");node.querySelector("input").maxLength=15;highlights.append(node);}const enabled=document.createElement("label"),toggle=document.createElement("input");toggle.type="checkbox";toggle.checked=room.enabled!==false;toggle.dataset.roomField="enabled";toggle.onchange=updatePricingDirty;enabled.append(toggle,document.createTextNode("啟用房型"));card.append(title,fields,highlights,enabled);return card;}));
  const wrap = element("div", "pricing-matrix-scroll"), table = element("table", "pricing-matrix"), head = document.createElement("thead"), headRow = document.createElement("tr"), body = document.createElement("tbody");
  for (const label of ["房型", "週一至週四", "週五", "週六及連續假期", "週日"]) headRow.append(cell("th", label)); head.append(headRow);
  for (const room of data.rooms) { const row = document.createElement("tr"); row.dataset.roomId = room.id; row.append(cell("th", room.name)); for (const key of priceKeys) { const td = document.createElement("td"), input = document.createElement("input"); input.type = "number"; input.min = "0"; input.step = "1"; input.required = true; input.value = room[key] ?? 0; input.dataset.priceKey = key; input.setAttribute("aria-label", `${room.name} ${key}`); input.oninput = updatePricingDirty; td.append(input); row.append(td); } body.append(row); }
  table.append(head, body); wrap.append(table); $("roomPricing").replaceChildren(wrap); pricingState.original=new Map(currentPricingRows().map(row=>[row.roomTypeId,row]));$("pricingSave").disabled = true; $("pricingStatus").textContent = "";
}
async function savePricingMatrix() {
  const form = $("pricingMatrixForm"); if (!form.reportValidity()) return; const rows = currentPricingRows(); pricingState.saving = true; setPricingInputsDisabled(true); $("pricingSave").disabled = true; $("pricingStatus").textContent = "儲存中…";
  try { const data = await api("/api/room-pricing", { method: "PUT", body: JSON.stringify({ propertyId: session.propertyId, rooms: rows }) }); renderPricingMatrix(data); $("pricingStatus").textContent = "房型資料與價格已全部儲存"; }
  catch (error) { pricingState.dirty = true; $("pricingStatus").textContent = `儲存失敗：${error.message}。輸入內容仍保留，請重試。`; }
  finally { pricingState.saving = false; setPricingInputsDisabled(false); $("pricingSave").disabled = !pricingState.dirty; }
}
async function loadPricing() {
  const data = await api(`/api/room-pricing?customerId=${encodeURIComponent(session.propertyId)}`);
  renderPricingMatrix(data);
  $("overrideRoom").replaceChildren(...data.rooms.map(room => { const option = document.createElement("option"); option.value = room.id; option.textContent = room.name; return option; }));
  $("overrideList").replaceChildren(...data.overrides.map(item => cell("p", `${item.date}｜${data.rooms.find(room => room.id === item.roomId)?.name || "房型"}｜${item.price} 元`)));
}

async function loadProfile() {
  const profile = await api(`/api/property-profile?propertyId=${encodeURIComponent(session.propertyId)}`);
  $("profileName").value = profile.propertyName || ""; $("profileGoogleMapsUrl").value = profile.googleMapsUrl || ""; $("profileLineUrl").value = profile.lineUrl || ""; $("profileContactInfo").value = profile.contactInfo || ""; $("profileCheckInTime").value = profile.checkInTime || ""; $("profileLatestArrivalTime").value = profile.latestArrivalTime || ""; $("profileCheckOutTime").value = profile.checkOutTime || "";
}

$("bundleAddCustomAmenity").onclick=()=>{const row=element("div","custom-amenity-row"),name=document.createElement("input"),note=document.createElement("input"),remove=cell("button","刪除");name.maxLength=20;name.dataset.customAmenityName="";name.placeholder="其他設備名稱";note.maxLength=100;note.dataset.customAmenityNote="";note.placeholder="備註（選填）";remove.type="button";remove.className="secondary";remove.onclick=()=>row.remove();row.append(name,note,remove);$("bundleAmenities").append(row)};
renderBundleAmenities();
$("bundleForm").onsubmit = async event => { event.preventDefault(); const id = $("bundleId").value, status = $("bundleStatus"), payload = { customerId: session.propertyId, name: $("bundleName").value, capacity: Number($("bundleCapacity").value), mondayThursdayPrice: Number($("bundleMondayThursdayPrice").value), fridayPrice: Number($("bundleFridayPrice").value), saturdayHolidayPrice: Number($("bundleSaturdayHolidayPrice").value), sundayPrice: Number($("bundleSundayPrice").value), enabled: $("bundleEnabled").checked, memberRoomIds: [...document.querySelectorAll('[name="memberRoom"]:checked')].map(input => input.value), entertainmentAmenities:collectBundleAmenities() }; status.textContent = "儲存中…"; try { await api(id ? `/api/bundles/${encodeURIComponent(id)}` : "/api/bundles", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) }); await Promise.all([loadBundles(), loadMonth()]); status.textContent = "已儲存"; clearBundle(); } catch (error) { status.textContent = `儲存失敗：${error.message}。輸入內容仍保留，請重試。`; } };
$("pricingMatrixForm").onsubmit = event => { event.preventDefault(); savePricingMatrix(); };
$("profileForm").onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return; const status = $("profileStatus"), payload = { propertyId: session.propertyId, propertyName: $("profileName").value, googleMapsUrl: $("profileGoogleMapsUrl").value, lineUrl: $("profileLineUrl").value, contactInfo: $("profileContactInfo").value, checkInTime: $("profileCheckInTime").value, latestArrivalTime: $("profileLatestArrivalTime").value, checkOutTime: $("profileCheckOutTime").value }; status.textContent = "儲存中…"; try { const profile = await api("/api/property-profile", { method: "PUT", body: JSON.stringify(payload) }); $("profileName").value = profile.propertyName; $("profileLatestArrivalTime").value = profile.latestArrivalTime || ""; status.textContent = "已儲存"; } catch (error) { status.textContent = `儲存失敗：${error.message}。輸入內容仍保留，請重試。`; } };
$("propertyFactAdd").onclick = () => $("propertyFactsList").append(propertyFactRow());
$("propertyFactsForm").onsubmit = async event => { event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return; const status = $("propertyFactsStatus"); status.textContent = "儲存中…"; try { const payload = PropertyFactsFormData.buildPropertyFactsPayload(session.propertyId, collectPropertyFactDrafts()); const saved = await api("/api/property-facts", { method: "PUT", body: JSON.stringify(payload) }); renderPropertyFacts(saved.facts || []); status.textContent = "已儲存"; } catch (error) { status.textContent = `儲存失敗：${error.message}。輸入內容仍保留，請修正後重試。`; } };
$("customReplyScope").onchange=toggleCustomReplyRoomField;
$("customReplyCancel").onclick=clearCustomReplyForm;
$("customReplyForm").onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;const id=$("customReplyId").value,payload={propertyId:session.propertyId,name:$("customReplyName").value,topic:$("customReplyTopic").value,scope:$("customReplyScope").value,roomTypeId:$("customReplyRoomType").value,stayStartDate:$("customReplyStayStart").value,stayEndDate:$("customReplyStayEnd").value,effectiveStartDate:$("customReplyEffectiveStart").value,effectiveEndDate:$("customReplyEffectiveEnd").value,approvedReply:$("customReplyText").value,enabled:$("customReplyEnabled").checked};$("customReplyStatus").textContent="儲存中…";try{await api(id?`/api/custom-replies/${encodeURIComponent(id)}`:"/api/custom-replies",{method:id?"PUT":"POST",body:JSON.stringify(payload)});await loadCustomReplies();clearCustomReplyForm();$("customReplyStatus").textContent="已儲存"}catch(error){$("customReplyStatus").textContent=`儲存失敗：${error.message}`}};
$("overrideForm").onsubmit = async event => { event.preventDefault(); const roomId = $("overrideRoom").value, date = $("overrideDate").value, status = $("overrideStatus"), exists = pricingState.overrides.some(item => item.roomId === roomId && item.date === date); if (exists && !confirm("此房型在該日期已有特殊價格，確定覆蓋嗎？")) return; status.textContent = "儲存中…"; try { await api("/api/room-price-overrides", { method: "POST", body: JSON.stringify({ customerId: session.propertyId, roomId, date, price: Number($("overridePrice").value) }) }); await loadPricing(); status.textContent = "已儲存"; event.currentTarget.reset(); } catch (error) { status.textContent = `儲存失敗：${error.message}。輸入內容仍保留，請重試。`; } };
async function enter(value) { if (value.requiresPropertySelection || !value.propertyId) return showPropertyChooser(value); if (expectedSlug) value = await api(`/api/admin/session?slug=${encodeURIComponent(expectedSlug)}`); session = value; $("login").hidden = true; $("propertyChooser").hidden = true; $("workspace").hidden = false; $("logout").hidden = false; $("propertyLabel").textContent = `業者：${value.propertyId}`; $("month").value = $("month").value || currentMonth(); let savedView = "recent"; try { savedView = localStorage.getItem("junzanAvailabilityView") || "recent"; } catch {} availabilityState.view = matchMedia("(max-width: 640px)").matches ? "recent" : ["recent", "calendar"].includes(savedView) ? savedView : "recent"; await Promise.all([loadMonth(), loadBundles(), loadPricing(), loadProfile(), loadPropertyFacts()]); fillCustomReplyOptions();clearCustomReplyForm();await loadCustomReplies(); }
$("loginForm").onsubmit = async event => { event.preventDefault(); try { await enter(await api("/api/admin/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) })); } catch (error) { showLogin(error.message); } };
document.querySelectorAll("[data-view]").forEach(button => { button.onclick = () => switchView(button.dataset.view); });
$("noteText").oninput = updateNoteCount; $("noteSave").onclick = () => saveNote(); $("noteClear").onclick = () => saveNote(""); $("noteClose").onclick = closeNoteEditor;
$("month").onchange = () => { if (hasUnsavedNote() && !confirm("備註尚未儲存，確定切換月份嗎？")) { $("month").value = availabilityState.loadedMonth; return; } noteEditorState = null; $("noteEditor").hidden = true; loadMonth(); };
$("bundleCancel").onclick = clearBundle; $("logout").onclick = async () => { await api("/api/admin/logout", { method: "POST", body: "{}" }); showLogin(); };
window.addEventListener("beforeunload", event => { if (!hasUnsavedNote() && !pricingState.dirty && !mutationQueues.size) return; event.preventDefault(); event.returnValue = ""; });
function populateAvailabilityRanges() {
  const select = $("availabilityRange"), today = currentDateKey(), start = new Date(`${today}T00:00:00`);
  while (select.options.length > 1) select.remove(1);
  for (let offset = 0; offset < 13; offset += 1) {
    const date = new Date(Date.UTC(start.getFullYear(), start.getMonth() + offset, 1));
    const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const option = document.createElement("option"); option.value = value;
    option.textContent = `${date.getUTCFullYear()} 年 ${date.getUTCMonth() + 1} 月`;
    select.append(option);
  }
  select.value = availabilityState.selection;
}
initializeAdminNavigation();
initializeAvailabilityBulkControls();
populateAvailabilityRanges();
$("availabilityRange").onchange = () => { availabilityState.selection = $("availabilityRange").value; noteEditorState = null; $("noteEditor").hidden = true; loadMonth(); };
$("availabilityToday").onclick = () => { availabilityState.selection = "rolling"; $("availabilityRange").value = "rolling"; noteEditorState = null; $("noteEditor").hidden = true; loadMonth(); };
function initializeAdminNavigation() {
  const panelMap = { availability: document.querySelector(".availability-card"), pricing: document.querySelector(".pricing-card"), bundles: document.querySelector(".bundles"), "custom-replies": document.querySelector(".custom-replies-card"), other: document.querySelector(".other-settings") };
  for (const [tab, panel] of Object.entries(panelMap)) if (panel) panel.dataset.adminPanel = tab;
  const select = $("adminTabSelect");
  const show = tab => { for (const [name, panel] of Object.entries(panelMap)) if (panel) panel.hidden = name !== tab; document.querySelectorAll("[data-admin-tab]").forEach(button => button.classList.toggle("active", button.dataset.adminTab === tab)); if (select) select.value = tab; };
  document.querySelectorAll("[data-admin-tab]").forEach(button => { button.onclick = () => show(button.dataset.adminTab); });
  if (select) select.onchange = () => show(select.value);
  show("availability");
}
function initializeAvailabilityBulkControls() {
  const host = document.querySelector(".availability-card"); if (!host || $("availabilityBulkStatus")) return;
  const box = element("section", "availability-bulk"), title = element("h3", "", "\u6574\u6708\u623f\u6cc1"), status = element("p", "hint"), actions = element("div", "actions"), open = element("button", "", "\u5168\u90e8\u958b\u653e"), close = element("button", "secondary", "\u5168\u90e8\u95dc\u9589"), confirmBox = element("section", "availability-bulk-confirm"), confirmText = element("p"), yes = element("button", "", "\u78ba\u5b9a"), no = element("button", "secondary", "\u53d6\u6d88");
  status.id = "availabilityBulkStatus"; open.id = "availabilityBulkOpen"; close.id = "availabilityBulkClose"; confirmBox.id = "availabilityBulkConfirm"; confirmText.id = "availabilityBulkConfirmText"; yes.id = "availabilityBulkConfirmYes"; no.id = "availabilityBulkConfirmNo"; confirmBox.hidden = true; open.type = close.type = yes.type = no.type = "button"; actions.append(open, close); confirmBox.append(confirmText, element("div", "actions")); confirmBox.lastChild.append(yes, no); box.append(title, status, actions, confirmBox); host.querySelector("#status").before(box);
  let pending = null;
  const refresh = () => { const plan = AdminAvailabilityWindow.availabilityBulkPlan(currentDateKey(), availabilityState.selection); const states = [...availabilityState.days.values()].flatMap(day => availabilityState.rooms.map(room => day[room.id])); const state = states.length && states.every(value => value === "available") ? "\u5168\u90e8\u958b\u653e" : states.length && states.every(value => value === "closed") ? "\u5168\u90e8\u95dc\u9589" : "\u90e8\u5206\u958b\u653e"; status.textContent = plan.allowed ? `\u76ee\u524d\uff1a${state}` : plan.message; open.disabled = close.disabled = !plan.allowed; confirmBox.hidden = true; };
  const ask = state => { const plan = AdminAvailabilityWindow.availabilityBulkPlan(currentDateKey(), availabilityState.selection); if (!plan.allowed) return refresh(); pending = { ...plan, state }; confirmText.textContent = `\u5373\u5c07\u5c07 ${plan.startDate} \u81f3 ${plan.endDate} \u7684\u6240\u6709\u623f\u578b\u8207\u5305\u68df\u8a2d\u70ba${state === "available" ? "\u5168\u90e8\u958b\u653e" : "\u5168\u90e8\u95dc\u9589"}\u3002`; confirmBox.hidden = false; };
  open.onclick = () => ask("available"); close.onclick = () => ask("closed"); no.onclick = () => { pending = null; confirmBox.hidden = true; };
  yes.onclick = async () => { if (!pending) return; yes.disabled = true; try { await api("/api/availability/batch", { method: "POST", body: JSON.stringify({ customerId: session.propertyId, mode: "all_inventory", startDate: pending.startDate, endDate: pending.endDate, status: pending.state }) }); await loadMonth(); } catch (error) { status.textContent = `\u6279\u6b21\u5132\u5b58\u5931\u6557\uff1a${error.message}`; } finally { pending = null; yes.disabled = false; confirmBox.hidden = true; refresh(); } };
  availabilityState.refreshBulk = refresh;
}
function initializeSimpleCustomReplies() {
  const form = $("customReplyForm"); if (!form || $("customReplyCreate")) return;
  const create = element("button", "", "＋\u65b0\u589e\u81ea\u8a02\u56de\u8986"), cancel = $("customReplyCancel"), topic = $("customReplyTopic"), name = $("customReplyName"), stayStart = $("customReplyStayStart"), stayEnd = $("customReplyStayEnd"), effectiveStart = $("customReplyEffectiveStart"), effectiveEnd = $("customReplyEffectiveEnd");
  create.id = "customReplyCreate"; create.type = "button"; form.before(create); form.hidden = true;
  const month = document.createElement("input"); month.id = "customReplyStayMonth"; month.type = "month"; month.required = true; const monthLabel = document.createElement("label"); monthLabel.textContent = "\u5ba2\u4eba\u60f3\u5165\u4f4f\u7684\u6708\u4efd"; monthLabel.append(month);
  const expiry = document.createElement("input"); expiry.id = "customReplyExpiry"; expiry.type = "date"; expiry.required = true; const expiryLabel = document.createElement("label"); expiryLabel.textContent = "\u516c\u544a\u4f7f\u7528\u81f3"; expiryLabel.append(expiry);
  const basic = element("section", "custom-reply-basic"), stepOne = element("h3", "", "1. \u4f60\u60f3\u901a\u77e5\u5ba2\u4eba\u4ec0\u9ebc\uff1f"), stepTwo = element("h3", "", "2. \u9019\u5247\u516c\u544a\u9069\u7528\u4ec0\u9ebc\u60c5\u6cc1\uff1f"), stepThree = element("h3", "", "3. \u8981\u56de\u8986\u5ba2\u4eba\u4ec0\u9ebc\uff1f");
  const advanced = document.createElement("details"); advanced.id = "customReplyAdvanced"; const summary = document.createElement("summary"); summary.textContent = "\u9032\u968e\u8a2d\u5b9a"; advanced.append(summary);
  const labelFor = control => control.closest("label"); const topicLabel = labelFor(topic), scopeLabel = labelFor($("customReplyScope")), roomLabel = labelFor($("customReplyRoomType")), nameLabel = labelFor(name), startLabel = labelFor(stayStart), endLabel = labelFor(stayEnd), effectiveStartLabel = labelFor(effectiveStart), effectiveEndLabel = labelFor(effectiveEnd), textLabel = labelFor($("customReplyText")), enabledLabel = labelFor($("customReplyEnabled"));
  basic.append(stepOne, topicLabel, stepTwo, monthLabel, scopeLabel, roomLabel, expiryLabel, stepThree, textLabel, enabledLabel); advanced.append(nameLabel, startLabel, endLabel, effectiveStartLabel, effectiveEndLabel); form.prepend(basic, advanced);
  const normalize = () => { const value = month.value; if (/^\d{4}-\d{2}$/.test(value)) { const start = `${value}-01`, end = new Date(Date.UTC(Number(value.slice(0,4)), Number(value.slice(5,7)), 0)).toISOString().slice(0,10); stayStart.value = start; stayEnd.value = end; } effectiveStart.value = effectiveStart.value || new Date().toISOString().slice(0,10); effectiveEnd.value = expiry.value; const option = topic.options[topic.selectedIndex]; if (!name.value || name.dataset.generated === "true") { name.value = option ? option.textContent : "\u81ea\u8a02\u516c\u544a"; name.dataset.generated = "true"; } updateCustomReplyPreview(); };
  month.onchange = normalize; expiry.onchange = normalize; topic.onchange = () => { name.dataset.generated = "true"; normalize(); }; create.onclick = () => { form.hidden = false; create.hidden = true; clearCustomReplyForm(); effectiveStart.value = new Date().toISOString().slice(0,10); normalize(); form.scrollIntoView({ block: "start" }); }; cancel.addEventListener("click", () => { form.hidden = true; create.hidden = false; });
  const testInput = document.createElement("input"); testInput.id = "customReplyTestText"; testInput.placeholder = "\u4f8b\uff1a9/3 \u53ef\u4ee5\u8a02\u623f\u55ce"; const testLabel = document.createElement("label"); testLabel.textContent = "\u8f38\u5165\u5ba2\u4eba\u8a62\u554f\u4f86\u6e2c\u8a66"; testLabel.append(testInput); $("customReplyTest").before(testLabel);
}
function updateCustomReplyPreview() {
  const topic = customReplyTopics.find(item => item[0] === $("customReplyTopic").value)?.[1] || "指定主題";
  const scope = customReplyScopes.find(item => item[0] === $("customReplyScope").value)?.[1] || "指定訂房類型";
  const stayStart = $("customReplyStayStart").value || "不限日期", stayEnd = $("customReplyStayEnd").value || "不限日期";
  const effectiveStart = $("customReplyEffectiveStart").value || "不限日期", effectiveEnd = $("customReplyEffectiveEnd").value || "不限日期";
  const reply = $("customReplyText").value.trim() || "（尚未填寫回覆內容）";
  $("customReplyPreview").textContent = `${effectiveStart}～${effectiveEnd} 期間，當客人詢問 ${stayStart}～${stayEnd} 入住的${scope}「${topic}」時，回覆：「${reply}」`;
}
for (const id of ["customReplyTopic", "customReplyScope", "customReplyStayStart", "customReplyStayEnd", "customReplyEffectiveStart", "customReplyEffectiveEnd", "customReplyText"]) $(id).addEventListener("input", updateCustomReplyPreview);
$("customReplyTest").onclick = async () => {
  const ruleId = $("customReplyId").value;
  if (!ruleId) { $("customReplyTestResult").textContent = "請先儲存規則，再進行測試。"; return; }
  const messageText = $("customReplyTestText").value.trim();
  if (!messageText) { $("customReplyTestResult").textContent = "請先輸入客人的詢問。"; return; }
  $("customReplyTestResult").textContent = "測試中…";
  try {
    const result = await api("/api/custom-replies/test", { method:"POST", body:JSON.stringify({ propertyId:session.propertyId, ruleId, messageText }) });
    $("customReplyTestResult").textContent = result.matched ? `會命中：${result.rule.name}。預計回覆：${result.reply}` : `不會命中：${result.reason.message}`;
  } catch (error) { $("customReplyTestResult").textContent = `測試失敗：${error.message}`; }
};
function editCustomReply(rule) { $("customReplyId").value = rule.ruleId; $("customReplyName").value = rule.name; $("customReplyTopic").value = rule.topic; $("customReplyScope").value = rule.scope; $("customReplyRoomType").value = rule.roomTypeId || ""; $("customReplyStayStart").value = rule.stayStartDate || ""; $("customReplyStayEnd").value = rule.stayEndDate || ""; $("customReplyEffectiveStart").value = rule.effectiveStartDate; $("customReplyEffectiveEnd").value = rule.effectiveEndDate; $("customReplyText").value = rule.approvedReply; $("customReplyEnabled").checked = rule.enabled; const month = $("customReplyStayMonth"); if (month) month.value = String(rule.stayStartDate || "").slice(0, 7); const expiry = $("customReplyExpiry"); if (expiry) expiry.value = rule.effectiveEndDate || ""; toggleCustomReplyRoomField(); $("customReplyForm").hidden = false; $("customReplyCreate").hidden = true; updateCustomReplyPreview(); $("customReplyForm").scrollIntoView({ behavior: "smooth", block: "start" }); }
initializeSimpleCustomReplies();
updateCustomReplyPreview();
api(`/api/admin/session${expectedSlug ? `?slug=${encodeURIComponent(expectedSlug)}` : ""}`).then(enter).catch(() => showLogin());
