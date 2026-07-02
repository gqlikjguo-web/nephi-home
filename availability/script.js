const lineWebUrl = "https://line.me/R/ti/p/@846zghrc";
const lineAppUrl = "line://ti/p/@846zghrc";

const fallbackRooms = [
  {
    id: "room301",
    name: "301雙人房附衛浴",
    capacity: 2,
    price: "請以 LINE 詢問為準",
    description: "雙人房型，附獨立衛浴。",
    tags: ["最多2人", "附衛浴", "301"]
  },
  {
    id: "room302",
    name: "302四人房附衛浴",
    capacity: 4,
    price: "請以 LINE 詢問為準",
    description: "四人房型，附獨立衛浴。",
    tags: ["最多4人", "附衛浴", "302"]
  },
  {
    id: "room401",
    name: "401雙人房有浴缸",
    capacity: 2,
    price: "請以 LINE 詢問為準",
    description: "雙人房型，房內有浴缸。",
    tags: ["最多2人", "有浴缸", "401"]
  },
  {
    id: "room402",
    name: "402四人房有浴缸",
    capacity: 4,
    price: "請以 LINE 詢問為準",
    description: "四人房型，房內有浴缸。",
    tags: ["最多4人", "有浴缸", "402"]
  },
  {
    id: "wholeHouse",
    name: "包棟四個房間",
    capacity: 12,
    price: "請以 LINE 詢問為準",
    description: "包棟可使用四個房間，適合家庭或朋友同行。",
    tags: ["包棟", "四個房間", "最多12人"]
  }
];

const form = document.querySelector("#searchForm");
const checkInInput = document.querySelector("#checkIn");
const roomTypeInput = document.querySelector("#roomType");
const roomList = document.querySelector("#roomList");
const resultSummary = document.querySelector("#resultSummary");
const emptyState = document.querySelector("#emptyState");
const template = document.querySelector("#roomCardTemplate");

const appsScriptUrl = typeof APPS_SCRIPT_URL === "string" ? APPS_SCRIPT_URL.trim() : "";

const today = new Date();
const todayKey = formatDateKey(today);
const maxSearchDate = new Date(today);
maxSearchDate.setMonth(maxSearchDate.getMonth() + 6);
const maxSearchDateKey = formatDateKey(maxSearchDate);

checkInInput.min = todayKey;
checkInInput.max = maxSearchDateKey;
if (!checkInInput.value || toDate(checkInInput.value) < toDate(todayKey)) {
  checkInInput.value = todayKey;
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function openLineOfficialAccount() {
  if (isMobileDevice()) {
    window.location.href = lineAppUrl;
    window.setTimeout(() => {
      window.location.href = lineWebUrl;
    }, 900);
    return;
  }

  window.open(lineWebUrl, "_blank", "noreferrer");
}

function setupStaticLineLinks() {
  document.querySelectorAll('a[href*="line.me/R/ti/p/@846zghrc"]').forEach((link) => {
    link.href = isMobileDevice() ? lineAppUrl : lineWebUrl;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openLineOfficialAccount();
    });
  });
}

function jsonp(params) {
  return new Promise((resolve, reject) => {
    if (!appsScriptUrl) {
      reject(new Error("Missing Apps Script URL"));
      return;
    }

    const callback = `nephiCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
}

function toDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  return value.replaceAll("-", "/");
}

function getNextDateKey(value) {
  const date = toDate(value);
  date.setDate(date.getDate() + 1);
  return formatDateKey(date);
}

function isWholeHouseOnlyPeriod(checkIn, checkOut) {
  const cursor = toDate(checkIn);
  const end = toDate(checkOut);

  while (cursor < end) {
    const month = cursor.getMonth() + 1;
    if (month === 8 || month === 9) return true;
    cursor.setDate(cursor.getDate() + 1);
  }

  return false;
}

function normalizeRoom(room) {
  const fallback = fallbackRooms.find((item) => item.id === room.id || item.name === room.name);
  return {
    ...fallback,
    ...room,
    price: room.price || fallback?.price || "請以 LINE 詢問為準",
    description: room.description || fallback?.description || "",
    tags: room.tags || fallback?.tags || []
  };
}

function extractRoomsFromSearchResponse_(data) {
  if (Array.isArray(data.rooms)) return data.rooms;
  if (data.data && Array.isArray(data.data.rooms)) return data.data.rooms;
  if (data.data && Array.isArray(data.data.availableRoomIds)) {
    return data.data.availableRoomIds
      .map((roomId) => fallbackRooms.find((room) => room.id === roomId))
      .filter(Boolean);
  }
  return [];
}

function inferGuests(roomType) {
  if (roomType === "302" || roomType === "402" || roomType === "四人房") return 4;
  if (roomType === "包棟") return 12;
  if (roomType) return 2;
  return 1;
}

function buildLineText(room, checkIn, checkOut) {
  return `您好，我想詢問尼腓的家訂房。

入住日期：${formatDate(checkIn)}
退房日期：${formatDate(checkOut)}
想詢問房型：${room.name}

請問這天是否還可以預訂？謝謝。`;
}

function renderRoom(rawRoom, query) {
  const room = normalizeRoom(rawRoom);
  const node = template.content.firstElementChild.cloneNode(true);
  const title = node.querySelector("h3");
  const meta = node.querySelector(".room-meta");
  const desc = node.querySelector(".room-desc");
  const badge = node.querySelector(".status-badge");
  const tagRow = node.querySelector(".tag-row");
  const copyButton = node.querySelector(".copy-room");
  const lineButton = node.querySelector(".line-room");
  const message = buildLineText(room, query.checkIn, query.checkOut);

  title.textContent = room.name;
  meta.textContent = `${room.price} | 最多 ${room.capacity} 人`;
  desc.textContent = room.description || "可透過 LINE 詢問細節。";
  badge.textContent = "可詢問";

  (room.tags || []).forEach((tag) => {
    const span = document.createElement("span");
    span.textContent = tag;
    tagRow.append(span);
  });

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(message);
      copyButton.textContent = "已複製";
      window.setTimeout(() => {
        copyButton.textContent = "複製詢問文字";
      }, 1600);
    } catch {
      copyButton.textContent = "請手動複製";
    }
  });

  lineButton.href = isMobileDevice() ? lineAppUrl : lineWebUrl;
  lineButton.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      // LINE still opens if clipboard access is blocked.
    }
    openLineOfficialAccount();
  });

  return node;
}

function showConnectionFallback(query) {
  resultSummary.textContent = "目前連線到房況表失敗，請改用 LINE 詢問，我們會為您確認。";
  fallbackRooms
    .filter((room) => query.roomType !== "包棟" || room.id === "wholeHouse")
    .filter((room) => !isWholeHouseOnlyPeriod(query.checkIn, query.checkOut) || room.id === "wholeHouse")
    .filter((room) => !query.roomType || roomMatchesSelection(room, query.roomType))
    .forEach((room) => roomList.append(renderRoom(room, query)));
}

function roomMatchesSelection(room, roomType) {
  if (!roomType) return true;
  if (roomType === "包棟") return room.id === "wholeHouse";
  if (roomType === "雙人房") return room.id === "room301" || room.id === "room401";
  if (roomType === "四人房") return room.id === "room302" || room.id === "room402";
  return room.name.includes(roomType);
}

async function searchRooms() {
  const checkIn = checkInInput.value;
  const roomType = roomTypeInput.value;

  if (!checkIn) return;

  if (toDate(checkIn) > toDate(maxSearchDateKey)) {
    resultSummary.textContent = "目前只開放查詢未來半年內的日期，請重新選擇日期。";
    roomList.replaceChildren();
    emptyState.hidden = true;
    return;
  }

  const checkOut = getNextDateKey(checkIn);
  const guests = inferGuests(roomType);
  const query = { checkIn, checkOut, guests, roomType };

  resultSummary.textContent = "正在查詢空房...";
  roomList.replaceChildren();
  emptyState.hidden = true;

  try {
    const data = await jsonp({
      action: "search",
      checkIn,
      checkOut,
      guests,
      text: roomType || ""
    });

    if (!data.ok) throw new Error(data.error || "Search failed");

    const matchedRooms = extractRoomsFromSearchResponse_(data)
      .filter((room) => roomMatchesSelection(normalizeRoom(room), roomType));
    matchedRooms.forEach((room) => {
      roomList.append(renderRoom(room, query));
    });

    const dateText = `${formatDate(checkIn)} 入住，${formatDate(checkOut)} 退房`;
    const wholeHouseOnlyNote = isWholeHouseOnlyPeriod(checkIn, checkOut)
      ? "提醒：8月、9月目前只開放包棟預訂。"
      : "";

    resultSummary.textContent = matchedRooms.length
      ? `${dateText}，找到 ${matchedRooms.length} 個可詢問房型。`
      : `${dateText}，目前沒有符合條件的房型可以預訂。`;

    if (wholeHouseOnlyNote) {
      resultSummary.textContent += ` ${wholeHouseOnlyNote}`;
    }

    emptyState.hidden = matchedRooms.length > 0;
  } catch {
    showConnectionFallback(query);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  searchRooms();
  document.querySelector("#result-title").scrollIntoView({ behavior: "smooth", block: "start" });
});

setupStaticLineLinks();
