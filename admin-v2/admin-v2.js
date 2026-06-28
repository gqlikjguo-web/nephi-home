(function () {
  "use strict";

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
    requestId: 0
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
    statusBox: $("#statusBox")
  };

  function boot() {
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
      if (!parsed) return;
      state.year = parsed.year;
      state.month = parsed.month;
      loadMonth();
    });
    els.prevMonth.addEventListener("click", () => moveMonth(-1));
    els.nextMonth.addEventListener("click", () => moveMonth(1));
    els.reloadMonth.addEventListener("click", loadMonth);
    els.clearRoomMonth.addEventListener("click", clearRoomMonth);
    els.closeMonth.addEventListener("click", closeMonth);
    els.batchText.addEventListener("input", updateBatchSummary);
    els.applyBatch.addEventListener("click", applyBatch);
  }

  function login() {
    if (!config.appsScriptUrl || config.appsScriptUrl.includes("PASTE_")) {
      els.loginMessage.textContent = "請先在 config.js 填入 Apps Script v2 部署網址。";
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

  async function loadMonth() {
    setStatus("讀取 Google Sheet 中...", "");
    try {
      const result = await api("month", { year: state.year, month: state.month });
      if (!result.ok) throw new Error(result.error || "讀取失敗");
      state.availability = result.availability || {};
      renderCalendar();
      setStatus("讀取完成。", "ok");
    } catch (error) {
      setStatus(`讀取失敗：${error.message}`, "error");
    }
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
      button.innerHTML = `<strong>${day}</strong><span>${status}</span>`;
      button.addEventListener("click", () => toggleDate(dateKey, status));
      els.calendarGrid.appendChild(button);
    }
  }

  function getStatus(dateKey, roomId) {
    const row = state.availability[dateKey] || {};
    return row[roomId] === STATUS_CLOSED ? STATUS_CLOSED : STATUS_AVAILABLE;
  }

  async function toggleDate(dateKey, currentStatus) {
    const nextStatus = currentStatus === STATUS_CLOSED ? STATUS_AVAILABLE : STATUS_CLOSED;
    const room = roomById[state.selectedRoom];
    setStatus(`更新 ${dateKey} ${room.label} 為${nextStatus}...`, "");
    try {
      const result = await api("setDate", {
        date: dateKey,
        room: state.selectedRoom,
        status: nextStatus,
        year: state.year,
        month: state.month
      });
      if (!result.ok) throw new Error(result.error || "更新失敗");
      applyMonthResult(result);
      setStatus(`已更新：${dateKey} ${room.label} ${nextStatus}`, "ok");
    } catch (error) {
      setStatus(`更新失敗：${error.message}`, "error");
    }
  }

  async function clearRoomMonth() {
    const room = roomById[state.selectedRoom];
    if (!window.confirm(`確定清除 ${state.year}/${state.month} 的「${room.label}」已關閉狀態？`)) return;
    setStatus("清除中...", "");
    try {
      const result = await api("clearRoomMonth", { year: state.year, month: state.month, room: state.selectedRoom });
      if (!result.ok) throw new Error(result.error || "清除失敗");
      applyMonthResult(result);
      setStatus("清除完成。", "ok");
    } catch (error) {
      setStatus(`清除失敗：${error.message}`, "error");
    }
  }

  async function closeMonth() {
    if (!window.confirm(`確定關閉 ${state.year}/${state.month} 全部房型？`)) return;
    setStatus("關閉當月中...", "");
    try {
      const result = await api("closeMonth", { year: state.year, month: state.month });
      if (!result.ok) throw new Error(result.error || "關閉失敗");
      applyMonthResult(result);
      setStatus("當月全部已關閉。", "ok");
    } catch (error) {
      setStatus(`關閉失敗：${error.message}`, "error");
    }
  }

  function updateBatchSummary() {
    const rows = parseBatchText(els.batchText.value, state.year, state.month);
    const updates = rows.reduce((sum, row) => sum + row.rooms.length, 0);
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
    const updates = rows.reduce((sum, row) => sum + row.rooms.length, 0);
    if (!window.confirm(`準備套用 ${rows.length} 天、${updates} 筆狀態，確定送出？`)) return;
    setStatus("批次更新中...", "");
    try {
      const payload = {
        year: state.year,
        month: state.month,
        resetMonth: els.resetBeforeBatch.checked,
        rows
      };
      const result = await api("batchUpdate", { payload: JSON.stringify(payload) });
      if (!result.ok) throw new Error(result.error || "批次更新失敗");
      applyMonthResult(result);
      const count = result.summary && typeof result.summary.updateCount === "number"
        ? result.summary.updateCount
        : updates;
      setStatus(`批次更新完成，共套用 ${count} 筆房型狀態。`, "ok");
    } catch (error) {
      setStatus(`批次更新失敗：${error.message}`, "error");
    }
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
    const found = new Set();
    rooms.forEach((room) => {
      if (room.tokens.some((token) => normalized.toLowerCase().includes(token.toLowerCase()))) {
        found.add(room.id);
      }
    });
    if (found.has("wholeHouse")) {
      return ["wholeHouse"];
    }
    return rooms.filter((room) => found.has(room.id)).map((room) => room.id);
  }

  function applyMonthResult(result) {
    if (result.availability) {
      state.availability = result.availability;
      renderCalendar();
      return;
    }
    loadMonth();
  }

  function api(action, params) {
    const callbackName = `nephiAdminV2_${Date.now()}_${state.requestId += 1}`;
    const url = new URL(config.appsScriptUrl);
    url.searchParams.set("action", action);
    url.searchParams.set("callback", callbackName);
    Object.entries(params || {}).forEach(([key, value]) => {
      url.searchParams.set(key, value == null ? "" : String(value));
    });

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("連線逾時，請確認 Apps Script v2 部署網址。"));
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
