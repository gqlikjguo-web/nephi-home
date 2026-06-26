const rooms = [
  { id: "room301", name: "301雙人房附衛浴" },
  { id: "room302", name: "302四人房附衛浴" },
  { id: "room401", name: "401雙人房有浴缸" },
  { id: "room402", name: "402四人房有浴缸" },
  { id: "wholeHouse", name: "包棟四個房間" }
];

const STATUS_AVAILABLE = "可訂";
const STATUS_BOOKED = "已訂";
const OPEN_MONTH_COUNT = 6;

const roomSelect = document.querySelector("#roomSelect");
const monthPicker = document.querySelector("#monthPicker");
const monthLabel = document.querySelector("#monthLabel");
const currentRoomLabel = document.querySelector("#currentRoomLabel");
const calendarGrid = document.querySelector("#calendarGrid");
const saveStatus = document.querySelector("#saveStatus");
const prevMonth = document.querySelector("#prevMonth");
const nextMonth = document.querySelector("#nextMonth");
const closeMonth = document.querySelector("#closeMonth");
const clearRoom = document.querySelector("#clearRoom");
const reloadMonth = document.querySelector("#reloadMonth");
const todayMonth = document.querySelector("#todayMonth");
const resetBeforeBatch = document.querySelector("#resetBeforeBatch");
const batchText = document.querySelector("#batchText");
const applyBatch = document.querySelector("#applyBatch");
const adminApp = document.querySelector("#adminApp");

const appsScriptUrl = typeof APPS_SCRIPT_URL === "string" ? APPS_SCRIPT_URL.trim() : "";
const latestAdminUrl = "https://gqlikjguo-web.github.io/nephi-home/admin/";
const isOldNetlifyHost = () => window.location.hostname.includes("netlify.app");
const getSheetConnectionMessage = () =>
  isOldNetlifyHost()
    ? `你現在開到的是舊的 Netlify 後台，這個版本已經不再更新。請改用最新後台：${latestAdminUrl}`
    : "後台目前連不到 Google Sheet。請確認 Apps Script /exec 網址仍有效，或重新部署 Apps Script 後再更新 config.js。";
const getSheetUpdateFailMessage = (actionText) =>
  isOldNetlifyHost()
    ? `你現在開到的是舊的 Netlify 後台，不能更新房況。請改用最新後台：${latestAdminUrl}`
    : `${actionText}失敗。請確認 Apps Script 已重新部署，且 config.js 使用最新 /exec 網址。`;
const minMonth = new Date();
minMonth.setDate(1);
minMonth.setHours(0, 0, 0, 0);

const maxMonth = new Date(minMonth);
maxMonth.setMonth(maxMonth.getMonth() + OPEN_MONTH_COUNT - 1);

let currentMonth = new Date(minMonth);
let monthAvailability = {};
let isSaving = false;

const toMonthKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const fromMonthKey = (value) => {
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1);
};

const toDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const isPastDateKey = (dateKey) => dateKey < toDateKey(new Date());

const compareMonth = (a, b) => {
  return (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth());
};

const isMonthInRange = (date) => compareMonth(date, minMonth) >= 0 && compareMonth(date, maxMonth) <= 0;

const clampMonth = (date) => {
  if (compareMonth(date, minMonth) < 0) return new Date(minMonth);
  if (compareMonth(date, maxMonth) > 0) return new Date(maxMonth);
  return new Date(date);
};

const jsonp = (params) => {
  return new Promise((resolve, reject) => {
    if (!appsScriptUrl) {
      reject(new Error("Missing Apps Script URL"));
      return;
    }

    const callback = `nephiAdminCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const url = new URL(appsScriptUrl);
    Object.entries({ ...params, callback }).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    const script = document.createElement("script");
    const cleanup = () => {
      delete window[callback];
      script.remove();
    };

    window[callback] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Apps Script request failed"));
    };

    script.src = url.toString();
    document.body.append(script);
  });
};

const getSelectedRoom = () => roomSelect.value;

const getRoomName = (roomId) => rooms.find((room) => room.id === roomId)?.name || roomId;

const updateCurrentRoomLabel = () => {
  currentRoomLabel.textContent = `目前正在修改：${getRoomName(getSelectedRoom())}`;
};

const isBooked = (roomId, dateKey) => {
  const status = String(monthAvailability[roomId]?.[dateKey] || "").trim();

  return [
    STATUS_BOOKED,
    "booked",
    "closed",
    "已關閉",
    "關閉",
    "已訂",
    "客滿",
    "false",
    "0"
  ].includes(status);
};
};
};

const setStatus = (message, type = "") => {
  saveStatus.textContent = message;
  saveStatus.dataset.type = type;
};

const setBusy = (busy) => {
  isSaving = busy;
  document
    .querySelectorAll(".admin-controls button, .admin-controls select, .admin-controls input, .admin-actions button, .batch-panel button, .batch-panel textarea, .batch-panel input")
    .forEach((control) => {
      control.disabled = busy;
    });
  updateMonthControls();
};

const updateMonthControls = () => {
  monthPicker.min = toMonthKey(minMonth);
  monthPicker.max = toMonthKey(maxMonth);
  monthPicker.value = toMonthKey(currentMonth);

  prevMonth.disabled = isSaving || compareMonth(currentMonth, minMonth) <= 0;
  nextMonth.disabled = isSaving || compareMonth(currentMonth, maxMonth) >= 0;
  todayMonth.disabled = isSaving || compareMonth(currentMonth, minMonth) === 0;
  monthPicker.disabled = isSaving;
  roomSelect.disabled = isSaving;
};

const renderRoomOptions = () => {
  roomSelect.replaceChildren();
  rooms.forEach((room) => {
    const option = document.createElement("option");
    option.value = room.id;
    option.textContent = room.name;
    roomSelect.append(option);
  });
  updateCurrentRoomLabel();
};

const updateFromResponse = (data, successMessage) => {
  if (!data.ok) {
      setStatus(data.error || getSheetUpdateFailMessage("更新"), "error");
    return;
  }

  monthAvailability = data.availability || {};
  setStatus(successMessage, "success");
  renderCalendar();
};

const loadMonth = async () => {
  currentMonth = clampMonth(currentMonth);
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth() + 1;
  setStatus("正在讀取 Google Sheet 資料...");
  setBusy(true);

  try {
    const data = await jsonp({ action: "month", year, month });
    if (!data.ok) throw new Error(data.error || "讀取失敗");
    monthAvailability = data.availability || {};
    setStatus("");
    renderCalendar();
  } catch {
    monthAvailability = {};
    setStatus(getSheetConnectionMessage(), "error");
    renderCalendar();
  } finally {
    setBusy(false);
  }
};

const toggleDate = async (dateKey) => {
  if (isSaving) return;

  if (isPastDateKey(dateKey)) {
    setStatus(`${dateKey} 已經是過去日期，無法再修改房況。`, "error");
    return;
  }

  const roomId = getSelectedRoom();
  const nextStatus = isBooked(roomId, dateKey) ? STATUS_AVAILABLE : STATUS_BOOKED;
  const nextStatusText = nextStatus === STATUS_BOOKED ? "已關閉" : "可訂";

  setStatus(`正在更新 ${dateKey}...`);
  setBusy(true);

  try {
    const data = await jsonp({ action: "setDate", roomId, date: dateKey, status: nextStatus });
    updateFromResponse(data, `${dateKey} ${getRoomName(roomId)} 已改為「${nextStatusText}」。`);
  } catch {
    setStatus(getSheetUpdateFailMessage("更新"), "error");
  } finally {
    setBusy(false);
  }
};

const renderCalendar = () => {
  calendarGrid.replaceChildren();

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const firstWeekday = monthStart.getDay();
  const todayKey = toDateKey(new Date());
  const roomId = getSelectedRoom();

  monthLabel.textContent = `${year} 年 ${month + 1} 月`;
  updateMonthControls();
  updateCurrentRoomLabel();

  for (let i = 0; i < firstWeekday; i += 1) {
    const blank = document.createElement("button");
    blank.className = "day-button blank";
    blank.type = "button";
    blank.tabIndex = -1;
    blank.disabled = true;
    calendarGrid.append(blank);
  }

  for (let day = 1; day <= monthEnd.getDate(); day += 1) {
    const date = new Date(year, month, day);
    const dateKey = toDateKey(date);
    const button = document.createElement("button");
    const booked = isBooked(roomId, dateKey);
    const past = dateKey < todayKey;
    const statusText = past ? "已失效" : booked ? "已關閉" : "可訂";

    button.type = "button";
    button.className = `day-button${booked ? " booked" : ""}${past ? " past" : ""}${dateKey === todayKey ? " today" : ""}`;
    button.innerHTML = `<strong>${day}</strong><span>${statusText}</span>`;
    button.setAttribute("aria-label", `${dateKey} ${statusText}`);
    button.disabled = past || isSaving;
    if (!past) {
      button.addEventListener("click", () => toggleDate(dateKey));
    }
    calendarGrid.append(button);
  }
};

roomSelect.addEventListener("change", () => {
  setStatus("");
  updateCurrentRoomLabel();
  renderCalendar();
});

monthPicker.addEventListener("change", () => {
  const pickedMonth = fromMonthKey(monthPicker.value);
  if (!isMonthInRange(pickedMonth)) {
    currentMonth = clampMonth(pickedMonth);
    setStatus("後台目前只開放本月起算半年的日期。", "error");
  } else {
    currentMonth = pickedMonth;
    setStatus("");
  }
  loadMonth();
});

prevMonth.addEventListener("click", () => {
  currentMonth.setMonth(currentMonth.getMonth() - 1);
  loadMonth();
});

nextMonth.addEventListener("click", () => {
  currentMonth.setMonth(currentMonth.getMonth() + 1);
  loadMonth();
});

todayMonth.addEventListener("click", () => {
  currentMonth = new Date(minMonth);
  setStatus("");
  loadMonth();
});

closeMonth.addEventListener("click", async () => {
  if (isSaving) return;

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth() + 1;
  const confirmed = window.confirm(`確定要把 ${year} 年 ${month} 月全部房型都關閉嗎？`);
  if (!confirmed) return;

  setStatus("正在關閉整個月份...");
  setBusy(true);

  try {
    const data = await jsonp({ action: "closeMonth", year, month });
    updateFromResponse(data, `${year} 年 ${month} 月全部房型已關閉。`);
  } catch {
    setStatus(getSheetUpdateFailMessage("關閉月份"), "error");
  } finally {
    setBusy(false);
  }
});

clearRoom.addEventListener("click", async () => {
  if (isSaving) return;

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth() + 1;
  const roomId = getSelectedRoom();
  const confirmed = window.confirm(`確定要把 ${getRoomName(roomId)} 的 ${year} 年 ${month} 月全部改為可訂嗎？`);
  if (!confirmed) return;

  setStatus("正在改為可訂...");
  setBusy(true);

  try {
    const data = await jsonp({ action: "clearRoomMonth", roomId, year, month });
    updateFromResponse(data, `${getRoomName(roomId)} 的 ${year} 年 ${month} 月已改為可訂。`);
  } catch {
    setStatus(getSheetUpdateFailMessage("改為可訂"), "error");
  } finally {
    setBusy(false);
  }
});

applyBatch.addEventListener("click", async () => {
  if (isSaving) return;

  const text = batchText.value.trim();
  if (!text) {
    setStatus("請先貼上已訂清單。", "error");
    return;
  }

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth() + 1;
  const resetMonth = resetBeforeBatch.checked;
  const confirmed = window.confirm(
    resetMonth
      ? `確定要先把 ${year} 年 ${month} 月全部改為可訂，再套用已訂清單嗎？`
      : `確定要套用 ${year} 年 ${month} 月的已訂清單嗎？`
  );
  if (!confirmed) return;

  setStatus("正在批次更新房況...");
  setBusy(true);

  try {
    const data = await jsonp({
      action: "batchUpdate",
      year,
      month,
      text,
      resetMonth: resetMonth ? "1" : "0"
    });
    const updateCount = data.summary?.updateCount || 0;
    updateFromResponse(data, `批次更新完成，共套用 ${updateCount} 筆房型狀態。`);
  } catch {
    setStatus(getSheetUpdateFailMessage("批次更新"), "error");
  } finally {
    setBusy(false);
  }
});

reloadMonth.addEventListener("click", loadMonth);

const initAdmin = () => {
  if (adminApp) adminApp.hidden = false;
  renderRoomOptions();
  updateMonthControls();
  loadMonth();
};

initAdmin();
