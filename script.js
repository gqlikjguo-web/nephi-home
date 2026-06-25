(() => {
  const STATUS_BOOKED = "已訂";
  const LINE_URL = "https://line.me/R/ti/p/@846zghrc";
  const LATEST_FRONT_URL = "https://gqlikjguo-web.github.io/nephi-home/";

  const rooms = [
    {
      id: "room301",
      short: "301",
      name: "301雙人房附衛浴",
      type: "double",
      capacity: 2,
      description: "雙人房型，附獨立衛浴。",
      tags: ["最多2人", "附衛浴", "301"]
    },
    {
      id: "room302",
      short: "302",
      name: "302四人房附衛浴",
      type: "quad",
      capacity: 4,
      description: "四人房型，附獨立衛浴。",
      tags: ["最多4人", "附衛浴", "302"]
    },
    {
      id: "room401",
      short: "401",
      name: "401雙人房有浴缸",
      type: "double",
      capacity: 2,
      description: "雙人房型，有浴缸。",
      tags: ["最多2人", "有浴缸", "401"]
    },
    {
      id: "room402",
      short: "402",
      name: "402四人房有浴缸",
      type: "quad",
      capacity: 4,
      description: "四人房型，有浴缸。",
      tags: ["最多4人", "有浴缸", "402"]
    },
    {
      id: "wholeHouse",
      short: "包棟",
      name: "包棟四個房間",
      type: "wholeHouse",
      capacity: 12,
      description: "包棟使用四個房間，最多12人。",
      tags: ["最多12人", "四個房間", "包棟"]
    }
  ];

  const form = document.querySelector("#searchForm");
  const checkInInput = document.querySelector("#checkIn");
  const roomTypeInput = document.querySelector("#roomType");
  const resultSummary = document.querySelector("#resultSummary");
  const emptyState = document.querySelector("#emptyState");
  const roomList = document.querySelector("#roomList");
  const template = document.querySelector("#roomCardTemplate");

  const appsScriptUrl = typeof APPS_SCRIPT_URL === "string" ? APPS_SCRIPT_URL.trim() : "";
  const individualRoomIds = rooms.filter((room) => room.id !== "wholeHouse").map((room) => room.id);

  const toDateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const fromDateKey = (dateKey) => {
    const [year, month, day] = dateKey.split("-").map(Number);
    return new Date(year, month - 1, day);
  };

  const addDays = (dateKey, amount) => {
    const date = fromDateKey(dateKey);
    date.setDate(date.getDate() + amount);
    return toDateKey(date);
  };

  const toDisplayDate = (dateKey) => dateKey.replaceAll("-", "/");
  const isPastDateKey = (dateKey) => dateKey < toDateKey(new Date());
  const isOldNetlifyHost = () => window.location.hostname.includes("netlify.app");

  const jsonp = (params) => {
    return new Promise((resolve, reject) => {
      if (!appsScriptUrl) {
        reject(new Error("Missing Apps Script URL"));
        return;
      }

      const callback = `nephiFrontCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const url = new URL(appsScriptUrl);
      Object.entries({ ...params, callback }).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });

      const script = document.createElement("script");
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Apps Script request timed out"));
      }, 12000);

      function cleanup() {
        window.clearTimeout(timeout);
        delete window[callback];
        script.remove();
      }

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

  const getMonthAvailability = async (dateKey) => {
    const date = fromDateKey(dateKey);
    return jsonp({
      action: "month",
      year: String(date.getFullYear()),
      month: String(date.getMonth() + 1)
    });
  };

  const getRoomStatus = (availability, roomId, dateKey) => {
    return availability?.[roomId]?.[dateKey] || "可訂";
  };

  const roomIsBooked = (availability, roomId, dateKey) => {
    return getRoomStatus(availability, roomId, dateKey) === STATUS_BOOKED;
  };

  const roomIsOpen = (room, dateKey, availability) => {
    if (isPastDateKey(dateKey)) return false;

    if (!availability) return true;

    if (room.id === "wholeHouse") {
      if (roomIsBooked(availability, "wholeHouse", dateKey)) return false;
      return individualRoomIds.every((roomId) => !roomIsBooked(availability, roomId, dateKey));
    }

    if (roomIsBooked(availability, "wholeHouse", dateKey)) return false;
    return !roomIsBooked(availability, room.id, dateKey);
  };

  const roomMatchesType = (room, selectedType) => {
    if (!selectedType || selectedType === "all") return true;
    if (selectedType === "double" || selectedType === "quad" || selectedType === "wholeHouse") {
      return room.type === selectedType;
    }
    return room.id === selectedType;
  };

  const buildInquiryText = (room, checkInKey) => {
    const checkOutKey = addDays(checkInKey, 1);
    return `您好，我想詢問 ${toDisplayDate(checkInKey)} 入住、${toDisplayDate(checkOutKey)} 退房，${room.name} 是否可以預訂？`;
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      textarea.remove();
      return ok;
    }
  };

  const setSummary = (text) => {
    resultSummary.textContent = text;
  };

  const clearRooms = () => {
    roomList.innerHTML = "";
  };

  const renderRoom = (room, dateKey) => {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".room-card");
    const name = fragment.querySelector(".room-name");
    const description = fragment.querySelector(".room-description");
    const tagList = fragment.querySelector(".tag-list");
    const copyButton = fragment.querySelector(".copy-button");
    const lineButton = fragment.querySelector(".line-button");
    const inquiryText = buildInquiryText(room, dateKey);

    name.textContent = room.name;
    description.textContent = room.description;
    tagList.innerHTML = "";

    room.tags.forEach((tag) => {
      const li = document.createElement("li");
      li.textContent = tag;
      tagList.append(li);
    });

    copyButton.addEventListener("click", async () => {
      copyButton.textContent = (await copyText(inquiryText)) ? "已複製" : "請手動複製";
      window.setTimeout(() => {
        copyButton.textContent = "複製詢問文字";
      }, 1600);
    });

    lineButton.href = LINE_URL;
    lineButton.target = "_blank";
    lineButton.rel = "noopener";
    card.dataset.roomId = room.id;
    roomList.append(fragment);
  };

  const renderResults = ({ dateKey, selectedType, availability, hasConnectionError }) => {
    clearRooms();
    const matchedRooms = rooms
      .filter((room) => roomMatchesType(room, selectedType))
      .filter((room) => roomIsOpen(room, dateKey, availability));

    emptyState.hidden = matchedRooms.length > 0;

    if (hasConnectionError) {
      setSummary("目前連線到房況表失敗，以下先顯示房型資訊。請改用 LINE 詢問，我們會為您確認。");
    } else if (matchedRooms.length > 0) {
      setSummary(`${toDisplayDate(dateKey)} 入住，找到 ${matchedRooms.length} 個可詢問房型。`);
    } else {
      setSummary(`${toDisplayDate(dateKey)} 入住目前沒有符合條件的可詢問房型。`);
      emptyState.textContent = "可以換其他日期或房型再查詢，也可以直接用 LINE 詢問。";
    }

    matchedRooms.forEach((room) => renderRoom(room, dateKey));
  };

  const runSearch = async () => {
    const dateKey = checkInInput.value;
    const selectedType = roomTypeInput.value;

    if (!dateKey) {
      setSummary("請先選擇入住日期。");
      return;
    }

    setSummary("正在查詢房況...");
    emptyState.hidden = true;
    clearRooms();

    if (isOldNetlifyHost()) {
      setSummary(`你現在開到的是舊的 Netlify 網址，請改用最新前台：${LATEST_FRONT_URL}`);
      return;
    }

    try {
      const data = await getMonthAvailability(dateKey);
      const availability = data?.availability || data?.data || data || {};
      renderResults({ dateKey, selectedType, availability, hasConnectionError: false });
    } catch {
      renderResults({ dateKey, selectedType, availability: null, hasConnectionError: true });
    }
  };

  const init = () => {
    const todayKey = toDateKey(new Date());
    checkInInput.min = todayKey;
    if (!checkInInput.value) checkInInput.value = todayKey;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      runSearch();
    });
  };

  init();
})();
