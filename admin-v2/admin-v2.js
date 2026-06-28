(function () {
  "use strict";

  const BUILD = "20260628-verified-1";
  const config = window.NEPHI_ADMIN_V2_CONFIG || {};
  const rooms = [
    { id: "room301", label: "301雙人房附衛浴", tokens: ["301", "room301"] },
    { id: "room302", label: "302四人房附衛浴", tokens: ["302", "room302"] },
    { id: "room401", label: "401雙人房有浴缸", tokens: ["401", "room401"] },
    { id: "room402", label: "402四人房有浴缸", tokens: ["402", "room402"] },
    { id: "wholeHouse", label: "包棟四個房間", tokens: ["包棟", "全棟", "wholehouse", "wholeHouse"] }
  ];
  const roomById = Object.fromEntries(rooms.map((room) => [room.id, room]));
  const STATUS_AVAILABLE = "可訂";
  const STATUS_CLOSED = "已關閉";

  const $ = (selector) => document.querySelector(selector);
  const state = {
    selectedRoom: "room301",
    year: 2026,
    month: 7,
    availability: {},
    requestId: 0,
    busy: false
  };

  const els = {
    loginPanel: $("#loginPanel"),
    adminPanel: $("#adminPanel"),
    passwordInput: $("#passwordInput"),
    loginButton: $("#loginButton"),
    loginMessage: $("#loginMessage"),
    monthPicker: $("#monthPicker"),
    prevMonth: $("#prevMonth"),
    nextMonth: $("#nextMonth"),
    reloadMonth: $("#reloadMonth"),
    currentRoomLabel: $("#currentRoomLabel"),
    roomButtons: $("#roomButtons"),
    calendarGrid: $("#calendarGrid"),
    clearRoomMonth: $("#clearRoomMonth"),
    closeMonth: $("#closeMonth"),
    resetBeforeBatch: $("#resetBeforeBatch"),
    batchText: $("#batchText"),
    batchSummary: $("#batchSummary"),
    applyBatch: $("#applyBatch"),
    statusBox: $("#statusBox"),
    buildInfo: $("#buildInfo")
  };

  function boot() {
    if (els.buildInfo) els.buildInfo.textContent = `admin-v2 build ${BUILD}`;
    renderRoomButtons();
    const today = new Date();
    state.year = today.getFullYear();
    state.month = today.getMonth() + 1;
    setMonthInput(state.year, state.month);
    bindEvents();
  }

  function bindEvents() {
    els.loginButton.addEventListener("click", login);
    els.passwordInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") login();
    });
    els.monthPicker.addEventListener("change", () => {
      const parsed = parseMonthInput(els.monthPicker.value);
      if (!parsed || state.busy) return;
      state.year = parsed.year;
      state.month = parsed.month;
      loadMonth();
    });
    els.prevMonth.addEventListener("click", () => moveMonth(-1));
    els.nextMonth.addEventListener("click", () => moveMonth(1));
    els.reloadMonth.addEventListener("click", () => loadMonth());
    els.clearRoomMonth.addEventListener("click", clearRoomMonth);
    els.closeMonth.addEventListener("click", closeMonth);
    els.batchText.addEventListener("input", updateBatchSummary);
    els.applyBatch.addEventListener("click", applyBatch);
  }

  function login() {
    if (!config.appsScriptUrl || config.appsScriptUrl.includes("PASTE_")) {
      els.loginMessage.textContent = "請先在 config.js 填入 Apps Script /exec 網址。";
      return;
    }
    if (els.passwordInput.value !== (config.adminPassword || "")) {
      els.loginMessage.textContent = "密碼不正確。";
      return;
    }
    els.loginPanel.classList.add("hidden");
    els.adminPanel.classList.remove("hidden");
    loadMonth();
  }

  function renderRoomButtons() {
    els.roomButtons.innerHTML = "";
    rooms.forEach((room) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "room-button";
      button.textContent = room.label;
      button.dataset.room = room.id;
      button.addEventListener("click", () => {
        if (state.busy) return;
        state.selectedRoom = room.id;
        renderRoomButtons();
        renderCalendar();
      });
      els.roomButtons.appendChild(button);
    });
    updateCurrentRoomLabel();
  }

  function updateCurrentRoomLabel() {
    els.currentRoomLabel.textContent = `目前正在修改：${roomById[state.selectedRoom].label}`;
    document.querySelectorAll(".room-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.room === state.selectedRoom);
    });
  }

  function moveMonth(offset) {
    if (state.busy) return;
    const date = new Date(state.year, state.month - 1 + offset, 1);
    state.year = date.getFullYear();
    state.month = date.getMonth() + 1;
    setMonthInput(state.year, state.month);
    loadMonth();
  }

  function setMonthInput(year, month) {
    els.monthPicker.value = `${year}-${String(month).padStart(2, "0")}`;
  }

  function parseMonthInput(value) {
    const match = /^(\d{4})-(\d{2})$/.exec(value || "");
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]) };
  }

  async function loadMonth(options) {
    const silent = options && options.silent;
    if (!silent) setStatus("讀取 Google Sheet 中...", "");
    const result = await api("month", { year: state.year, month: state.month });
    if (!result.ok) throw new Error(result.error || "讀取失敗");
    state.availability = normalizeAvailability(result);
    renderCalendar();
    if (!silent) setStatus(`讀取完成。build ${BUILD}`, "ok");
    return state.availability;
  }

  function normalizeAvailability(result) {
    const output = {};
    const direct = result && (result.availability || (result.data && result.data.availability));
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
      Object.keys(direct).forEach((dateKey) => {
        output[dateKey] = normalizeStatusRow(dateKey, direct[dateKey]);
      });
    }

    const rows = (result && result.rows) || (result && result.data && result.data.rows) || [];
    if (Array.isArray(rows)) {
      rows.forEach((row) => {
        const dateKey = normalizeDateKey(row.date || row[0]);
        if (!dateKey) return;
        output[dateKey] = normalizeStatusRow(dateKey, row);
      });
    }
    return output;
  }

  function normalizeStatusRow(dateKey, row) {
    if (Array.isArray(row)) {
      return {
        date: dateKey,
        room301: normalizeStatus(row[1]),
        room302: normalizeStatus(row[2]),
        room401: normalizeStatus(row[3]),
        room402: normalizeStatus(row[4]),
        wholeHouse: normalizeStatus(row[5])
      };
    }
    return {
      date: dateKey,
      room301: normalizeStatus(row && row.room301),
      room302: normalizeStatus(row && row.room302),
      room401: normalizeStatus(row && row.room401),
      room402: normalizeStatus(row && row.room402),
      wholeHouse: normalizeStatus(row && row.wholeHouse)
    };
  }

  function normalizeStatus(value) {
    const raw = String(value || "").trim();
    return raw === STATUS_CLOSED || raw === "已訂" || raw.toLowerCase() === "closed" || raw.toLowerCase() === "booked"
      ? STATUS_CLOSED
      : STATUS_AVAILABLE;
  }

  function normalizeDateKey(value) {
    const raw = String(value || "").trim();
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
    if (!match) return "";
    return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
  }

  function renderCalendar() {
    updateCurrentRoomLabel();
    els.calendarGrid.innerHTML = "";
    const firstDay = new Date(state.year, state.month - 1, 1).getDay();
    const daysInMonth = new Date(state.year, state.month, 0).getDate();
    for (let i = 0; i < firstDay; i += 1) {
      const blank = document.createElement("button");
      blank.type = "button";
      blank.className = "day blank";
      els.calendarGrid.appendChild(blank);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = `${state.year}-${String(state.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const status = getStatus(dateKey, state.selectedRoom);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `day ${status === STATUS_CLOSED ? "closed" : ""}`;
      button.dataset.date = dateKey;
      button.dataset.room = state.selectedRoom;
      button.innerHTML = `<strong>${day}</strong><span>${status}</span>`;
      button.addEventListener("click", () => toggleDate(dateKey, status));
      els.calendarGrid.appendChild(button);
    }
  }

  function getStatus(dateKey, roomId) {
    const row = state.availability[dateKey] || {};
    return row[roomId] === STATUS_CLOSED ? STATUS_CLOSED : STATUS_AVAILABLE;
  }

  async function withBusy(task) {
    if (state.busy) return;
    state.busy = true;
    setControlsDisabled(true);
    try {
      await task();
    } finally {
      state.busy = false;
      setControlsDisabled(false);
    }
  }

  function setControlsDisabled(disabled) {
    document.querySelectorAll("button, input, textarea").forEach((element) => {
      if (element.id === "passwordInput") return;
      element.disabled = disabled;
    });
  }

  async function toggleDate(dateKey, currentStatus) {
    await withBusy(async () => {
      const roomId = state.selectedRoom;
      const nextStatus = currentStatus === STATUS_CLOSED ? STATUS_AVAILABLE : STATUS_CLOSED;
      const room = roomById[roomId];
      setStatus(`更新 ${dateKey} ${room.label} 為${nextStatus}...`, "");
      const result = await api("setDate", {
        date: dateKey,
        room: roomId,
        status: nextStatus,
        year: state.year,
        month: state.month
      });
      if (!result.ok) throw new Error(result.error || "更新失敗");
      await loadMonth({ silent: true });
      assertStatus(dateKey, roomId, nextStatus);
      setStatus(`已更新並讀回確認：${dateKey} ${room.label} ${nextStatus}`, "ok");
    }).catch((error) => setStatus(`更新失敗：${error.message}`, "error"));
  }

  async function clearRoomMonth() {
    const roomId = state.selectedRoom;
    const room = roomById[roomId];
    if (!window.confirm(`確定清除 ${state.year}/${state.month} 的「${room.label}」已關閉狀態？`)) return;
    await withBusy(async () => {
      setStatus("清除中...", "");
      const result = await api("clearRoomMonth", { year: state.year, month: state.month, room: roomId });
      if (!result.ok) throw new Error(result.error || "清除失敗");
      await loadMonth({ silent: true });
      assertMonthRoomStatus(roomId, STATUS_AVAILABLE);
      setStatus(`清除完成並讀回確認：${room.label} 本月皆為可訂`, "ok");
    }).catch((error) => setStatus(`清除失敗：${error.message}`, "error"));
  }

  async function closeMonth() {
    if (!window.confirm(`確定關閉 ${state.year}/${state.month} 全部房型？`)) return;
    await withBusy(async () => {
      setStatus("關閉當月中...", "");
      const result = await api("closeMonth", { year: state.year, month: state.month });
      if (!result.ok) throw new Error(result.error || "關閉失敗");
      await loadMonth({ silent: true });
      rooms.forEach((room) => assertMonthRoomStatus(room.id, STATUS_CLOSED));
      setStatus("當月全部已關閉，且已讀回確認。", "ok");
    }).catch((error) => setStatus(`關閉失敗：${error.message}`, "error"));
  }

  function updateBatchSummary() {
    const rows = parseBatchText(els.batchText.value, state.year, state.month);
    const updates = rows.reduce((sum, row) => sum + expandedRoomCount(row.rooms), 0);
    els.batchSummary.textContent = rows.length
      ? `已解析 ${rows.length} 天，共 ${updates} 筆房型狀態。`
      : "尚未解析到可更新內容。";
    return rows;
  }

  async function applyBatch() {
    const rows = updateBatchSummary();
    if (!rows.length) {
      setStatus("批次內容沒有解析到日期與房型，未送出。", "error");
      return;
    }
    const updates = rows.reduce((sum, row) => sum + expandedRoomCount(row.rooms), 0);
    if (!window.confirm(`準備套用 ${rows.length} 天、${updates} 筆狀態，確定送出？`)) return;
    await withBusy(async () => {
      setStatus("批次更新中...", "");
      const payload = {
        year: state.year,
        month: state.month,
        resetMonth: els.resetBeforeBatch.checked,
        rows
      };
      const result = await api("batchUpdate", { payload: JSON.stringify(payload) });
      if (!result.ok) throw new Error(result.error || "批次更新失敗");
      await loadMonth({ silent: true });
      rows.forEach((row) => {
        expandRooms(row.rooms).forEach((roomId) => assertStatus(row.date, roomId, STATUS_CLOSED));
      });
      setStatus(`批次更新完成並讀回確認：${updates} 筆房型狀態。`, "ok");
    }).catch((error) => setStatus(`批次更新失敗：${error.message}`, "error"));
  }

  function parseBatchText(text, fallbackYear, fallbackMonth) {
    const parsedRows = [];
    String(text || "").split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const match = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(.+)$/.exec(trimmed);
      if (!match) return;
      const month = Number(match[1]);
      const day = Number(match[2]);
      let year = fallbackYear;
      if (match[3]) {
        year = Number(match[3]);
        if (year < 100) year += 2000;
      }
      if (month !== fallbackMonth) return;
      const roomsForLine = parseRooms(match[4]);
      if (!roomsForLine.length) return;
      parsedRows.push({
        date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        rooms: roomsForLine,
        status: STATUS_CLOSED
      });
    });
    return parsedRows;
  }

  function parseRooms(text) {
    const normalized = String(text || "").replace(/[、，,＋+]/g, " ");
    const lower = normalized.toLowerCase();
    if (lower.includes("包棟") || lower.includes("全棟") || lower.includes("wholehouse")) {
      return ["wholeHouse"];
    }
    const found = [];
    rooms.forEach((room) => {
      if (room.id === "wholeHouse") return;
      if (room.tokens.some((token) => lower.includes(token.toLowerCase()))) found.push(room.id);
    });
    return found;
  }

  function expandRooms(roomIds) {
    return roomIds.includes("wholeHouse")
      ? rooms.map((room) => room.id)
      : roomIds.slice();
  }

  function expandedRoomCount(roomIds) {
    return expandRooms(roomIds).length;
  }

  function assertStatus(dateKey, roomId, expectedStatus) {
    const actual = getStatus(dateKey, roomId);
    if (actual !== expectedStatus) {
      throw new Error(`讀回不一致：${dateKey} ${roomById[roomId].label} 應為${expectedStatus}，實際為${actual}`);
    }
  }

  function assertMonthRoomStatus(roomId, expectedStatus) {
    const daysInMonth = new Date(state.year, state.month, 0).getDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = `${state.year}-${String(state.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      assertStatus(dateKey, roomId, expectedStatus);
    }
  }

  function api(action, params) {
    const callbackName = `nephiAdminV2_${Date.now()}_${state.requestId += 1}`;
    const url = new URL(config.appsScriptUrl);
    url.searchParams.set("action", action);
    url.searchParams.set("callback", callbackName);
    url.searchParams.set("_", `${Date.now()}_${Math.random().toString(16).slice(2)}`);
    Object.entries(params || {}).forEach(([key, value]) => {
      url.searchParams.set(key, value == null ? "" : String(value));
    });

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("連線逾時，請確認 Apps Script /exec 網址。"));
      }, 15000);

      window[callbackName] = (data) => {
        cleanup();
        resolve(data || {});
      };
      script.onerror = () => {
        cleanup();
        reject(new Error("Apps Script 無法載入。"));
      };
      script.src = url.toString();
      document.body.appendChild(script);

      function cleanup() {
        window.clearTimeout(timer);
        delete window[callbackName];
        script.remove();
      }
    });
  }

  function setStatus(message, type) {
    els.statusBox.textContent = message;
    els.statusBox.className = `status ${type || ""}`.trim();
  }

  boot();
}());
