"use strict";

const { createServiceDataAccess } = require("./providers/service-data-access");
const { roomMatchesType } = require("./conversation-coordinator");
const { normalizeGoogleMapsUrl } = require("./google-maps-url");
const { normalizePropertyFacts } = require("./property-facts");
const { normalizeSelfCheckInOutInstructions } = require("./self-check-in-out-instructions");

const ALLOWED_STATUSES = new Set(["available", "closed"]);
const ALLOWED_ACTIONS = new Set(["correct", "needs_fix", "should_handoff"]);
const LINE_USER_ID_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const LINE_URL_HOSTS = new Set(["lin.ee", "line.me"]);
const SAFE_FACT_KEYS = [
  "checkInTime", "checkOutTime", "parkingRule", "bbqRule", "petRule",
  "equipment", "breakfastRule", "drinkingWaterRule", "laundryRule",
  "elevatorRule", "babySuppliesRule", "selfCheckInRule",
  "priceRule", "paymentRule", "lodgingRules", "otherFacts"
];
const INTENT_SAFE_FACTS = {
  parking: "parkingRule",
  bbq: "bbqRule",
  checkin_rule: "checkInTime",
  pet_rule: "petRule",
  equipment: "equipment",
  breakfast: "breakfastRule",
  drinking_water: "drinkingWaterRule",
  laundry: "laundryRule",
  elevator: "elevatorRule",
  baby_supplies: "babySuppliesRule",
  self_checkin: "selfCheckInRule",
  price: "priceRule"
};
const PUBLIC_ROOM_NAME_LIMIT = 100;
const PUBLIC_ROOM_DESCRIPTION_LIMIT = 30;
const NON_PUBLIC_DESCRIPTION_PATTERN = /(?:內部|管理|後台|員工|房務|清潔|備註|勿對外|密碼|交班)/i;
const PRICE_FIELDS = [
  ["mondayThursdayPrice", "週一至週四"],
  ["fridayPrice", "週五"],
  ["saturdayHolidayPrice", "週六及連續假期"],
  ["sundayPrice", "週日"]
];
const FIXED_HUMAN_REPLY = "請稍候，將由真人客服協助確認。";
const FIXED_AVAILABILITY_UNCONFIRMED_REPLY = "目前無法確認房況，請稍候由真人客服協助確認。";
const REVIEW_REASON_LABELS = {
  classifier_not_configured: "AI 分類服務尚未設定，已轉真人確認。",
  classifier_exception: "AI 分類服務暫時無法使用，已轉真人確認。",
  classifier_timeout: "AI 分類逾時，已轉真人確認。",
  classifier_invalid_schema: "AI 分類結果格式不符合安全規格，已轉真人確認。",
  classifier_low_confidence: "系統判斷信心不足，已轉真人確認。",
  unknown_intent: "系統無法可靠判斷問題類型，已轉真人確認。",
  over_capacity: "入住人數超過房型上限，請真人協助確認。",
  availability_data_unavailable: "房況資料缺少或不一致，請人工確認。"
};

class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function normalizedPublicText(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizedMatchText(value) {
  return normalizedPublicText(value).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function publicRoomName(room) {
  const name = normalizedPublicText(room && (room.publicDisplayName || room.displayName || room.publicName || room.name)).slice(0, 60);
  const type = normalizedPublicText(room && room.type).slice(0, 24);
  const nameKey = normalizedMatchText(name);
  const typeKey = normalizedMatchText(type);
  const parts = [name];
  if (type && typeKey && !nameKey.includes(typeKey) && !typeKey.includes(nameKey)) parts.push(type);
  const base = parts.filter(Boolean).join(" ");
  const rawDescription = normalizedPublicText(room && (room.publicShortFeature || room.shortFeature || room.description));
  const description = rawDescription.replace(/[。！？!?,，；;]+$/u, "");
  const descriptionKey = normalizedMatchText(description);
  const canShowDescription = room && room.inventoryType !== "bundle"
    && description.length > 0 && description.length <= PUBLIC_ROOM_DESCRIPTION_LIMIT
    && !NON_PUBLIC_DESCRIPTION_PATTERN.test(description)
    && !/[\r\n]/.test(rawDescription)
    && !normalizedMatchText(base).includes(descriptionKey);
  return `${base}${canShowDescription ? `（${description}）` : ""}`.slice(0, PUBLIC_ROOM_NAME_LIMIT) || "可詢問房型";
}

function isEquipmentOverview(message) {
  const text = normalizedPublicText(message);
  return /(?:哪些|什麼|甚麼).{0,6}(?:設備|設施)|(?:設備|設施).{0,6}(?:有哪些|有什麼|有甚麼|是什麼)/u.test(text);
}

function requestedEquipmentSubject(message) {
  return normalizedPublicText(message)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .replace(/^(?:請問|想問|想知道|你們|民宿|房間|房內|這裡|住宿)*/u, "")
    .replace(/^(?:有沒有|是否有|有提供|提供|備有|有|可以使用|可使用|能使用|能用|可以借|可借)/u, "")
    .replace(/(?:可以使用|可使用|能使用|能用|可以借|可借|有提供|提供)?(?:嗎|呢|嘛|麼|么)$/u, "")
    .replace(/(?:設備|設施)$/u, "");
}

function equipmentHasConfirmedEvidence(homestay, message) {
  const fact = homestay && homestay.safeFacts && homestay.safeFacts.equipment;
  const factText = Array.isArray(fact) ? fact.join("、") : normalizedPublicText(fact);
  if (!factText) return false;
  if (isEquipmentOverview(message)) return true;
  const subject = requestedEquipmentSubject(message);
  if (normalizedMatchText(subject).length < 2) return false;
  const faqText = (homestay.faqs || [])
    .filter((item) => item && item.knowledgeKey === "equipment")
    .map((item) => `${item.question || ""} ${item.answer || ""}`)
    .join(" ");
  return normalizedMatchText(`${factText} ${faqText}`).includes(normalizedMatchText(subject));
}

function selectedInventory(rooms, fields = {}) {
  const queryMode = ["bundle_only", "room_only", "any"].includes(fields.queryMode) ? fields.queryMode : "any";
  const roomType = String(fields.roomType || "all");
  return (rooms || []).filter((room) => {
    if (queryMode === "bundle_only" && room.inventoryType !== "bundle") return false;
    if (queryMode === "room_only" && room.inventoryType === "bundle") return false;
    return roomType === "all" || roomMatchesType(room, roomType);
  });
}

function structuredPriceReply(rooms) {
  if (!rooms.length) return "";
  const lines = rooms.map((room) => {
    const values = PRICE_FIELDS.map(([key, label]) => [label, Number(room[key])]);
    if (values.some(([, value]) => !Number.isInteger(value) || value <= 0)) return "";
    return `${publicRoomName(room)}：${values.map(([label, value]) => `${label} ${value} 元`).join("、")}`;
  }).filter(Boolean);
  return lines.length === rooms.length ? `一般價格表：\n${lines.join("\n")}\n特定日期價格或連續假期仍以業者確認為準。` : "";
}

function regexEscape(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function legacyConfirmedPriceReply(homestay, rooms) {
  if (!rooms.length) return "";
  const raw = normalizedPublicText(homestay && homestay.safeFacts && homestay.safeFacts.priceRule);
  if (!raw) return "";
  const allRooms = homestay.rooms || [];
  const lines = rooms.map((room) => {
    const aliases = normalizedPublicText(room.name).split(/\s+/u)
      .map((item) => item.replace(/[^\p{L}\p{N}]/gu, ""))
      .filter((item) => item.length >= 2)
      .filter((item) => allRooms.filter((candidate) => normalizedMatchText(candidate.name).includes(normalizedMatchText(item))).length === 1)
      .sort((a, b) => b.length - a.length);
    let price = null;
    for (const alias of aliases) {
      const match = raw.match(new RegExp(`${regexEscape(alias)}[^0-9]{0,20}([0-9]{3,8})`, "iu"));
      if (match) { price = Number(match[1]); break; }
    }
    if (!Number.isInteger(price) || price <= 0) return "";
    return `${publicRoomName(room)}：週一至週四 ${price} 元、週五 未確認、週六及連續假期 未確認、週日 未確認`;
  }).filter(Boolean);
  return lines.length === rooms.length ? `一般價格表：\n${lines.join("\n")}\n未確認的價格類別與特定日期價格請由業者確認。` : "";
}

function parseDateKey(value, field) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new AppError(400, "INVALID_DATE", `${field} must use YYYY-MM-DD`);
  }
  const date = new Date(text + "T00:00:00.000Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new AppError(400, "INVALID_DATE", `${field} is invalid`);
  }
  return text;
}

function addDays(dateKey, amount) {
  const date = new Date(dateKey + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function stayDates(checkIn, checkOut) {
  const dates = [];
  let cursor = checkIn;
  while (cursor < checkOut && dates.length <= 31) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  if (!dates.length || cursor !== checkOut || dates.length > 31) {
    throw new AppError(400, "INVALID_STAY_RANGE", "Stay must be between 1 and 31 nights");
  }
  return dates;
}

function monthDateKeys(year, month) {
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const keys = [];
  for (let day = 1; day <= count; day += 1) {
    keys.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return keys;
}

function cleanText(value, maxLength = 1000) {
  const text = String(value || "").trim();
  if (text.length > maxLength) throw new AppError(400, "TEXT_TOO_LONG", `Text must not exceed ${maxLength} characters`);
  return text;
}

function validateLineUserId(value) {
  const id = String(value || "").trim();
  if (id && !LINE_USER_ID_PATTERN.test(id)) {
    throw new AppError(400, "INVALID_LINE_USER_ID", "LINE user identifier format is invalid");
  }
  return id;
}

function validDateKey(year, month, day) {
  const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  try {
    return parseDateKey(key, "date");
  } catch {
    return "";
  }
}

function parseAvailabilityStay(messageText, now) {
  const text = String(messageText || "");
  const isoMatches = [...text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)];
  let dates = isoMatches.map((match) => validDateKey(Number(match[1]), Number(match[2]), Number(match[3]))).filter(Boolean);
  if (!dates.length) {
    const year = now().getUTCFullYear();
    const shortMatches = [...text.matchAll(/(?:^|[^\d])(\d{1,2})\s*(?:\/|月)\s*(\d{1,2})\s*(?:日)?/g)];
    dates = shortMatches.map((match) => validDateKey(year, Number(match[1]), Number(match[2]))).filter(Boolean);
  }
  if (!dates.length) return null;
  const checkIn = dates[0];
  const checkOut = dates.length > 1 ? dates[1] : addDays(checkIn, 1);
  if (checkOut <= checkIn) return null;
  try {
    stayDates(checkIn, checkOut);
  } catch {
    return null;
  }
  return { checkIn, checkOut };
}

function isGenericRecentAvailabilityQuery(messageText) {
  const text = String(messageText || "");
  return /(?:還有|最近|近期).*(?:空房|有房|房間)|(?:空房|有房).*(?:最近|近期)/.test(text);
}

function createMvpService(providers, { now = () => new Date(), safeTraceFormatter = () => null } = {}) {
  const repository = createServiceDataAccess(providers);
  function requireCustomerId(customerId) {
    const id = String(customerId || "").trim();
    if (!id) throw new AppError(400, "MISSING_CUSTOMER_ID", "customerId is required");
    const homestay = repository.getHomestay(id);
    if (!homestay) throw new AppError(404, "UNKNOWN_CUSTOMER_ID", "Unknown test-only customerId");
    return homestay;
  }

  function listHomestays() {
    return repository.listHomestays();
  }

  function getBootstrap(customerId) {
    const homestay = requireCustomerId(customerId);
    return {
      customerId: homestay.customerId,
      homestayName: homestay.name,
      lineUrl: homestay.lineUrl || "",
      publicEnabled: homestay.publicEnabled !== false,
      rooms: homestay.rooms || [],
      safeFacts: homestay.safeFacts || {}
    };
  }

  function updateSettings(input) {
    const homestay = requireCustomerId(input.customerId);
    const name = cleanText(input.name, 80);
    if (!name) throw new AppError(400, "INVALID_HOMESTAY_NAME", "Homestay name is required");
    if (!Array.isArray(input.rooms) || !input.rooms.length) {
      throw new AppError(400, "INVALID_ROOM", "At least one room is required");
    }
    const seenRoomIds = new Set();
    const rooms = input.rooms.map((raw) => {
      const id = String(raw && raw.id || "").trim();
      const roomName = cleanText(raw && raw.name, 80);
      const capacity = Number(raw && raw.capacity);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id) || seenRoomIds.has(id) || !roomName || !Number.isInteger(capacity) || capacity < 1 || capacity > 50) {
        throw new AppError(400, "INVALID_ROOM", "Room name, slot and capacity are required");
      }
      seenRoomIds.add(id);
      return {
        id,
        name: roomName,
        capacity,
        type: cleanText(raw.type || "custom", 40),
        description: cleanText(raw.description, 500)
      };
    });
    const rawFacts = input.safeFacts && typeof input.safeFacts === "object" ? input.safeFacts : {};
    const checkInTime = cleanText(rawFacts.checkInTime, 5);
    const checkOutTime = cleanText(rawFacts.checkOutTime, 5);
    if (!TIME_PATTERN.test(checkInTime) || !TIME_PATTERN.test(checkOutTime)) {
      throw new AppError(400, "INVALID_TIME", "Check-in and check-out must use HH:MM");
    }
    const safeFacts = {};
    SAFE_FACT_KEYS.forEach((key) => {
      if (key === "equipment") {
        const values = Array.isArray(rawFacts.equipment) ? rawFacts.equipment : String(rawFacts.equipment || "").split(/[，,、]/);
        safeFacts.equipment = values.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 30);
      } else {
        safeFacts[key] = key === "checkInTime" ? checkInTime : key === "checkOutTime" ? checkOutTime : cleanText(rawFacts[key], 1000);
      }
    });
    const updated = repository.updateHomestay(homestay.customerId, { name, rooms, safeFacts });
    return getBootstrap(updated.customerId);
  }

  function searchAvailability(query) {
    const homestay = requireCustomerId(query.customerId);
    const checkIn = parseDateKey(query.checkIn, "checkIn");
    const checkOut = parseDateKey(query.checkOut, "checkOut");
    const dates = stayDates(checkIn, checkOut);
    const requestedGuests = Number(query.guests);
    const guests = Number.isFinite(requestedGuests) && requestedGuests > 0 ? requestedGuests : null;
    const roomType = String(query.roomType || "all");
    const roomTypeSet = Array.isArray(query.roomTypeSet) ? [...new Set(query.roomTypeSet.map((item) => String(item || "").trim()).filter(Boolean))] : [];
    const queryMode = ["bundle_only","room_only","any"].includes(query.queryMode) ? query.queryMode : "any";
    const rows = repository.getAvailabilityRows(homestay.customerId, checkIn, checkOut);
    const byDate = Object.fromEntries(rows.map((row) => [row.date, row]));
    const availabilityReliable = rows.length === dates.length && dates.every((date) => {
      const row = byDate[date];
      if (!row || row.date !== date) return false;
      return (homestay.rooms || []).every((room) => row[room.id] === "available" || row[room.id] === "closed");
    });
    const candidateRooms = (homestay.rooms || []).filter((room) => {
      if (queryMode === "bundle_only" && room.inventoryType !== "bundle") return false;
      if (queryMode === "room_only" && room.inventoryType === "bundle") return false;
      if (roomTypeSet.length ? !roomTypeSet.includes(room.id) : roomType !== "all" && !roomMatchesType(room, roomType)) return false;
      return guests === null || Number(room.capacity || 0) >= guests;
    });

    const rooms = availabilityReliable ? candidateRooms.filter((room) => dates.every((date) => {
      const row = byDate[date];
      if (!row) return false;
      if (room.inventoryType === "bundle") {
        return row[room.id] === "available";
      }
      return row[room.id] === "available";
    })) : [];

    return {
      customerId: homestay.customerId,
      homestayName: homestay.name,
      checkIn,
      checkOut,
      nightCount: dates.length,
      guests,
      roomType,
      roomTypeSet,
      queryMode,
      availabilityReliable,
      rooms,
      lineUrl: homestay.lineUrl || ""
    };
  }

  function getMonth(customerId, yearValue, monthValue) {
    const homestay = requireCustomerId(customerId);
    const year = Number(yearValue);
    const month = Number(monthValue);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new AppError(400, "INVALID_MONTH", "year and month are required");
    }
    const from = `${year}-${String(month).padStart(2, "0")}-01`;
    const to = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const notesByDate = {};
      for (const item of repository.getAvailabilityDayNotes(homestay.customerId, from, to)) {
        notesByDate[item.date] = notesByDate[item.date] || {};
        notesByDate[item.date][`${item.inventoryType}:${item.inventoryId}`] = item;
    }
    return {
      propertyId: homestay.customerId,
      customerId: homestay.customerId,
      year,
      month,
      rooms: homestay.rooms,
      rows: repository.getAvailabilityRows(homestay.customerId, from, to),
      notesByDate
    };
  }

  function getPropertyProfile(customerId) {
    const property = requireCustomerId(customerId);
    return {
      propertyName: property.name,
      availabilityAutoReplyEnabled: property.availabilityAutoReplyEnabled !== false,
      selfCheckInOutInstructions: normalizeSelfCheckInOutInstructions(property.selfCheckInOutInstructions),
      aiName: String(property.businessProfile && property.businessProfile.aiName || ""),
      address: String(property.businessProfile && property.businessProfile.address || ""),
      googleMapsUrl: normalizeGoogleMapsUrl(property.businessProfile && property.businessProfile.googleMapsUrl),
      lineUrl: property.lineUrl || "",
      contactInfo: String(property.businessProfile && property.businessProfile.contactInfo || ""),
      checkInTime: String(property.safeFacts && property.safeFacts.checkInTime || ""),
      earlyCheckInPolicy: String(property.safeFacts && property.safeFacts.earlyCheckInPolicy || ""),
      latestArrivalTime: String(property.safeFacts && property.safeFacts.latestArrivalTime || ""),
      checkOutTime: String(property.safeFacts && property.safeFacts.checkOutTime || "")
    };
  }

  function updatePropertyProfile(input) {
    const property = requireCustomerId(input.customerId);
    const propertyName = cleanText(input.propertyName, 80);
    const aiName = cleanText(input.aiName, 40);
    const address = cleanText(input.address, 300);
    const googleMapsUrl = normalizeGoogleMapsUrl(input.googleMapsUrl);
    const contactInfo = cleanText(input.contactInfo, 300);
    const checkInTime = cleanText(input.checkInTime, 5);
    const earlyCheckInPolicy = cleanText(input.earlyCheckInPolicy, 500);
    const latestArrivalTime = cleanText(input.latestArrivalTime, 500);
    const checkOutTime = cleanText(input.checkOutTime, 5);
    const lineUrl = cleanText(input.lineUrl, 500);
    const availabilityAutoReplyEnabled = input.availabilityAutoReplyEnabled === undefined
      ? property.availabilityAutoReplyEnabled !== false
      : input.availabilityAutoReplyEnabled !== false;
    let selfCheckInOutInstructions;
    try {
      selfCheckInOutInstructions = normalizeSelfCheckInOutInstructions(input.selfCheckInOutInstructions === undefined ? property.selfCheckInOutInstructions : input.selfCheckInOutInstructions);
    } catch {
      throw new AppError(400, "INVALID_SELF_CHECK_IN_OUT_INSTRUCTIONS", "自助入住／退房說明格式不正確");
    }
    if (!propertyName || !TIME_PATTERN.test(checkInTime) || !TIME_PATTERN.test(checkOutTime)) throw new AppError(400, "INVALID_PROFILE", "請填寫民宿名稱與有效的入住、退房時間");
    if (input.googleMapsUrl && !googleMapsUrl) throw new AppError(400, "INVALID_GOOGLE_MAPS_URL", "Google Maps 網址格式不正確");
    if (lineUrl) {
      let parsed;
      try { parsed = new URL(lineUrl); } catch { throw new AppError(400, "INVALID_LINE_URL", "LINE 官方帳號網址格式不正確"); }
      if (parsed.protocol !== "https:" || !LINE_URL_HOSTS.has(parsed.hostname.toLowerCase())) throw new AppError(400, "INVALID_LINE_URL", "LINE 官方帳號網址格式不正確");
    }
    const commonAnswers = { ...(property.safeFacts || {}), checkInTime, checkOutTime };
    if (earlyCheckInPolicy) commonAnswers.earlyCheckInPolicy = earlyCheckInPolicy;
    else delete commonAnswers.earlyCheckInPolicy;
    if (latestArrivalTime) commonAnswers.latestArrivalTime = latestArrivalTime;
    else delete commonAnswers.latestArrivalTime;
    const updated = repository.updatePropertyProfile(property.customerId, {
      displayName: propertyName,
      businessProfile: { ...(property.businessProfile || {}), aiName, address, googleMapsUrl, contactInfo },
      contactLink: lineUrl,
      availabilityAutoReplyEnabled,
      selfCheckInOutInstructions,
      commonAnswers
    });
    return {
      propertyName: updated.displayName,
      availabilityAutoReplyEnabled: updated.availabilityAutoReplyEnabled !== false,
      selfCheckInOutInstructions: normalizeSelfCheckInOutInstructions(updated.selfCheckInOutInstructions),
      aiName: String(updated.businessProfile && updated.businessProfile.aiName || ""),
      address: String(updated.businessProfile && updated.businessProfile.address || ""),
      googleMapsUrl: normalizeGoogleMapsUrl(updated.businessProfile && updated.businessProfile.googleMapsUrl),
      lineUrl: updated.contactLink || "",
      contactInfo: String(updated.businessProfile && updated.businessProfile.contactInfo || ""),
      checkInTime: String(updated.commonAnswers && updated.commonAnswers.checkInTime || ""),
      earlyCheckInPolicy: String(updated.commonAnswers && updated.commonAnswers.earlyCheckInPolicy || ""),
      latestArrivalTime: String(updated.commonAnswers && updated.commonAnswers.latestArrivalTime || ""),
      checkOutTime: String(updated.commonAnswers && updated.commonAnswers.checkOutTime || "")
    };
  }

  function getPropertyFacts(customerId) {
    const property = providers.customerSettings.getProperty(String(customerId || "").trim());
    if (!property) throw new AppError(404, "UNKNOWN_CUSTOMER_ID", "Unknown propertyId");
    return { propertyId: property.propertyId, facts: property.propertyFacts || [] };
  }

  function updatePropertyFacts(input) {
    const propertyId = String(input.customerId || input.propertyId || "").trim();
    const property = providers.customerSettings.getProperty(propertyId);
    if (!property) throw new AppError(404, "UNKNOWN_CUSTOMER_ID", "Unknown propertyId");
    let facts;
    try {
      facts = normalizePropertyFacts(input.facts);
    } catch {
      throw new AppError(400, "INVALID_PROPERTY_FACT", "Property facts are invalid");
    }
    const updated = providers.customerSettings.updatePropertyFacts(propertyId, facts);
    return { propertyId: updated.propertyId, facts: updated.propertyFacts || [] };
  }

  function searchAvailableDates(query) {
    const from = parseDateKey(query.dateFrom, "dateFrom"), to = parseDateKey(query.dateTo, "dateTo");
    const nights = Number.isInteger(Number(query.nights)) && Number(query.nights) > 0 ? Number(query.nights) : 1;
    const dates = [];
    for (let checkIn = from; checkIn < to; checkIn = addDays(checkIn, 1)) {
      const checkOut = addDays(checkIn, nights);
      if (checkOut > to) break;
      const result = searchAvailability({ customerId: query.customerId, checkIn, checkOut, guests: query.guests, roomType: query.roomType || "all", roomTypeSet: query.roomTypeSet, queryMode: query.queryMode || "any" });
      if (!result.availabilityReliable) return { status: "unreliable", dates: [], source: "property_resolver" };
      dates.push({ checkIn, checkOut, available: result.rooms.length > 0, roomTypes: result.rooms.map((room) => ({ roomTypeId: room.id, roomTypeName: publicRoomName(room) })) });
    }
    return { status: "answered", dates, source: "property_resolver" };
  }

  function setDay(input) {
    const homestay = requireCustomerId(input.customerId);
    const date = parseDateKey(input.date, "date");
    const roomId = String(input.roomId || "");
    const status = String(input.status || "");
    if (!(homestay.rooms || []).some((room) => room.id === roomId)) {
      throw new AppError(400, "UNKNOWN_ROOM", "Unknown roomId");
    }
    if (!ALLOWED_STATUSES.has(status)) {
      throw new AppError(400, "INVALID_STATUS", "status must be available or closed");
    }
    return repository.setAvailabilityDay(homestay.customerId, date, roomId, status);
  }

  function setDayNote(input) {
    const homestay = requireCustomerId(input.propertyId);
    let date;
    try { date = parseDateKey(input.date, "date"); }
    catch { throw new AppError(400, "INVALID_DATE", "請輸入有效日期"); }
    const inventoryType = String(input.inventoryType || "room");
    const inventoryId = String(input.inventoryId || input.roomTypeId || "");
    if (!["room", "bundle"].includes(inventoryType)) throw new AppError(400, "INVALID_INVENTORY_TYPE", "可售單位類型錯誤");
    if (!(homestay.rooms || []).some((room) => room.id === inventoryId && (room.inventoryType === "bundle" ? "bundle" : "room") === inventoryType)) {
      throw new AppError(400, "UNKNOWN_INVENTORY", "找不到可管理的房型或方案");
    }
    if (typeof input.note !== "string") throw new AppError(400, "INVALID_NOTE", "備註格式錯誤");
    const note = input.note.trim();
    if (note.length > 1000) throw new AppError(400, "NOTE_TOO_LONG", "內部備註不可超過 1000 字");
    return repository.setAvailabilityDayNote(homestay.customerId, inventoryType, inventoryId, date, note);
  }

  function setMonth(input) {
    const homestay = requireCustomerId(input.customerId);
    const year = Number(input.year);
    const month = Number(input.month);
    const roomId = String(input.roomId || "");
    const status = String(input.status || "");
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new AppError(400, "INVALID_MONTH", "Invalid year or month");
    }
    if (!(homestay.rooms || []).some((room) => room.id === roomId)) {
      throw new AppError(400, "UNKNOWN_ROOM", "Unknown roomId");
    }
    if (!ALLOWED_STATUSES.has(status)) {
      throw new AppError(400, "INVALID_STATUS", "Invalid availability status");
    }
    const dates = monthDateKeys(year, month);
    dates.forEach((date) => repository.setAvailabilityDay(homestay.customerId, date, roomId, status));
    return { customerId: homestay.customerId, year, month, roomId, status, updated: dates.length };
  }

  function parseBatchText(text, year, month, rooms = []) {
    const rows = [];
    const invalidLines = [];
    String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
      const normalized = line.replace(/[，,、]/g, " ");
      const full = /^(\d{1,2})[/-](\d{1,2})\s+(.+)$/.exec(normalized);
      const short = /^(\d{1,2})\s+(.+)$/.exec(normalized);
      const rowMonth = full ? Number(full[1]) : month;
      const day = full ? Number(full[2]) : short ? Number(short[1]) : 0;
      const roomText = full ? full[3] : short ? short[2] : "";
      const roomIds = (rooms || []).filter((room) => {
        const aliases = [room.id, room.roomCode, room.displayName, room.name]
          .map((value) => String(value || "").trim())
          .filter(Boolean);
        return aliases.some((alias) => roomText.toLowerCase().includes(alias.toLowerCase()));
      }).map((room) => room.id);
      const date = `${year}-${String(rowMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      try {
        parseDateKey(date, "batch date");
        if (!roomIds.length) throw new Error("missing room");
        rows.push({ date, roomIds: [...new Set(roomIds)] });
      } catch {
        invalidLines.push(line);
      }
    });
    return { rows, invalidLines };
  }

  function applyBatch(input) {
    const homestay = requireCustomerId(input.customerId);
    if (input.mode === "all_inventory") {
      const startDate = parseDateKey(input.startDate, "startDate");
      const endDate = parseDateKey(input.endDate, "endDate");
      const status = String(input.status || "");
      if (endDate < startDate) throw new AppError(400, "INVALID_DATE_RANGE", "endDate must not be before startDate");
      if (startDate < now().toISOString().slice(0, 10)) throw new AppError(400, "PAST_DATE_FORBIDDEN", "Past availability cannot be changed");
      if (!ALLOWED_STATUSES.has(status)) throw new AppError(400, "INVALID_STATUS", "Invalid availability status");
      const inventory = homestay.rooms || [];
      if (!inventory.length) throw new AppError(400, "NO_INVENTORY", "No inventory to update");
      const dates = [];
      for (let date = startDate; date <= endDate; date = addDays(date, 1)) dates.push(date);
      for (const date of dates) for (const room of inventory) repository.setAvailabilityDay(homestay.customerId, date, room.id, status);
      return { customerId: homestay.customerId, startDate, endDate, status, updated: dates.length * inventory.length };
    }
    const year = Number(input.year);
    const month = Number(input.month);
    if (!Number.isInteger(year) || !Number.isInteger(month)) {
      throw new AppError(400, "INVALID_MONTH", "Invalid batch year or month");
    }
    const parsed = parseBatchText(input.text, year, month, homestay.rooms || []);
    if (parsed.invalidLines.length || !parsed.rows.length) {
      throw new AppError(400, "INVALID_BATCH", "Batch text contains invalid lines");
    }
    if (input.resetMonth) {
      for (const room of homestay.rooms || []) {
        setMonth({ customerId: homestay.customerId, year, month, roomId: room.id, status: "available" });
      }
    }
    let updated = 0;
    parsed.rows.forEach((row) => row.roomIds.forEach((roomId) => {
      repository.setAvailabilityDay(homestay.customerId, row.date, roomId, "closed");
      updated += 1;
    }));
    return { customerId: homestay.customerId, updated, invalidLines: [] };
  }

  function listGuests(customerId, query) {
    const homestay = requireCustomerId(customerId);
    const needle = String(query || "").trim().toLowerCase();
    const guests = repository.listGuests(homestay.customerId).filter((guest) => {
      if (!needle) return true;
      return [guest.name, guest.phone, guest.email].some((value) => String(value || "").toLowerCase().includes(needle));
    });
    return guests;
  }

  function createGuest(input) {
    const homestay = requireCustomerId(input.customerId);
    if (!String(input.name || "").trim()) throw new AppError(400, "MISSING_GUEST_NAME", "Guest name is required");
    const lineUserId = validateLineUserId(input.lineUserId);
    if (lineUserId && repository.findGuestByLineUserId(homestay.customerId, lineUserId)) {
      throw new AppError(409, "LINE_USER_ALREADY_LINKED", "LINE user identifier is already linked");
    }
    const guest = repository.createGuest(homestay.customerId, { ...input, lineUserId });
    if (lineUserId) repository.linkMessagesToGuest(homestay.customerId, lineUserId, guest.guestId);
    return guest;
  }

  function updateGuest(customerId, guestId, input) {
    const homestay = requireCustomerId(customerId);
    const current = repository.getGuest(homestay.customerId, guestId);
    if (!current) throw new AppError(404, "GUEST_NOT_FOUND", "Guest not found for customerId");
    const lineUserId = input.lineUserId === undefined ? current.lineUserId || "" : validateLineUserId(input.lineUserId);
    const linked = lineUserId ? repository.findGuestByLineUserId(homestay.customerId, lineUserId) : null;
    if (linked && linked.guestId !== guestId) {
      throw new AppError(409, "LINE_USER_ALREADY_LINKED", "LINE user identifier is already linked");
    }
    const guest = repository.updateGuest(homestay.customerId, guestId, { ...input, lineUserId });
    if (lineUserId) repository.linkMessagesToGuest(homestay.customerId, lineUserId, guest.guestId);
    return guest;
  }

  function listGuestMessages(customerId, guestId) {
    const homestay = requireCustomerId(customerId);
    if (!repository.getGuest(homestay.customerId, guestId)) {
      throw new AppError(404, "GUEST_NOT_FOUND", "Guest not found for customerId");
    }
    return repository.listGuestMessages(homestay.customerId, guestId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function persistMessageEvent(customerId, input) {
    const eventId = cleanText(input.eventId, 200);
    const channelId = cleanText(input.channelId, 200);
    const processingStatus = input.processingStatus
      || (input.noReply || input.shouldReply === false ? "no_reply" : "decided");
    const record = { ...input, eventId, channelId, processingStatus };
    const existing = eventId ? repository.findMessageByEventId(customerId, eventId, channelId) : null;
    if (existing) return repository.updateMessageEvent(customerId, channelId, eventId, record);
    return repository.appendMessageLog(customerId, record);
  }

  function writeMessage(input) {
    const homestay = requireCustomerId(input.customerId);
    const guestMessage = cleanText(input.guestMessage, 2000);
    if (!guestMessage) throw new AppError(400, "MISSING_GUEST_MESSAGE", "Guest message is required");
    const lineUserId = validateLineUserId(input.lineUserId);
    const guest = lineUserId ? repository.findGuestByLineUserId(homestay.customerId, lineUserId) : null;
    const detectedIntent = cleanText(input.detectedIntent || "unclear_handoff", 80);
    const safeFactKey = INTENT_SAFE_FACTS[detectedIntent] || "";
    const factValue = safeFactKey ? homestay.safeFacts && homestay.safeFacts[safeFactKey] : "";
    const fixedReply = Array.isArray(factValue) ? factValue.join("、") : cleanText(factValue, 1000);
    const canUseFixedReply = Boolean(
      input.replyType === "fixed_reply" && !input.humanHandoff && !input.needsReview && safeFactKey && fixedReply
    );
    const humanHandoff = !canUseFixedReply || Boolean(input.humanHandoff);
    const needsReview = humanHandoff || Boolean(input.needsReview);
    const item = persistMessageEvent(homestay.customerId, {
      guestId: guest ? guest.guestId : "",
      channelId: cleanText(input.channelId, 200),
      lineUserId,
      eventId: cleanText(input.eventId, 200),
      eventTimestamp: input.eventTimestamp || "",
      guestMessage,
      detectedIntent,
      replyType: canUseFixedReply ? "fixed_reply" : "human_handoff",
      replyText: canUseFixedReply ? fixedReply : FIXED_HUMAN_REPLY,
      usedSafeFactKey: canUseFixedReply ? safeFactKey : "",
      route: cleanText(input.route, 80),
      confidence: Number(input.confidence || 0),
      decisionReason: cleanText(input.decisionReason, 120),
      shouldReply: true,
      noReply: false,
      silentIgnore: false,
      humanHandoff,
      needsReview,
      reviewNote: cleanText(input.reviewNote || (humanHandoff ? "此問題需要人工確認。" : ""), 500),
      ownerAction: "",
      status: needsReview ? "pending" : "resolved"
    });
    return item;
  }

  function appendMergedEventLogs(input, item) {
    const records = Array.isArray(input && input.eventRecords) ? input.eventRecords : [];
    records.slice(0, -1).forEach((record) => {
      if (!record.eventId) return;
      persistMessageEvent(item.customerId, {
        guestId: item.guestId || "",
        channelId: input.channelId,
        lineUserId: input.lineUserId,
        eventId: record.eventId,
        eventTimestamp: record.eventTimestamp || "",
        guestMessage: cleanText(record.messageText, 2000),
        detectedIntent: item.detectedIntent,
        replyType: "merged_no_reply",
        replyText: "",
        route: item.route || "",
        confidence: item.confidence || 0,
        decisionReason: "merged_into_trailing_reply",
        shouldReply: false,
        noReply: true,
        silentIgnore: false,
        humanHandoff: false,
        needsReview: false,
        reviewNote: "",
        ownerAction: "",
        status: "resolved",
        processingStatus: "no_reply",
        mergedIntoEventId: item.eventId
      });
    });
  }

  function bridgeResult(item, duplicate, input) {
    if (duplicate) {
      return {
        customerId: item.customerId,
        guestId: item.guestId || "",
        eventId: item.eventId || "",
        duplicate: true,
        shouldReply: false,
        noReply: true,
        replyToken: ""
      };
    }
    appendMergedEventLogs(input, item);
    if (item.noReply || item.shouldReply === false) {
      return {
        customerId: item.customerId,
        guestId: item.guestId || "",
        eventId: item.eventId || "",
        duplicate: false,
        shouldReply: false,
        noReply: true,
        replyToken: "",
        silent: Boolean(item.silentIgnore),
        detectedIntent: item.detectedIntent,
        decisionReason: item.decisionReason || ""
      };
    }
    return {
      customerId: item.customerId,
      guestId: item.guestId || "",
      eventId: item.eventId || "",
      duplicate: false,
      shouldReply: true,
      replyText: item.replyText,
      replyType: item.replyType,
      detectedIntent: item.detectedIntent,
      usedSafeFactKey: item.usedSafeFactKey || "",
      humanHandoff: !!item.humanHandoff,
      needsReview: !!item.needsReview,
      reviewId: item.reviewId,
      status: item.status || "pending"
    };
  }

  function appendFixedBridgeMessage(homestay, guest, input, detectedIntent, replyText, usedSafeFactKey) {
    return persistMessageEvent(homestay.customerId, {
      guestId: guest.guestId,
      channelId: input.channelId,
      lineUserId: input.lineUserId,
      eventId: input.eventId,
      eventTimestamp: input.eventTimestamp || "",
      guestMessage: cleanText(input.messageText, 2000),
      detectedIntent,
      replyType: "fixed_reply",
      replyText,
      usedSafeFactKey,
      route: input.route && input.route.route || "auto_reply_allowed",
      confidence: Number(input.route && input.route.confidence || 0),
      decisionReason: input.route && input.route.reason || "",
      shouldReply: true,
      noReply: false,
      silentIgnore: false,
      humanHandoff: false,
      needsReview: false,
      reviewNote: "",
      ownerAction: "",
      status: "resolved"
    });
  }

  function appendSilentBridgeMessage(homestay, guest, input, route) {
    return persistMessageEvent(homestay.customerId, {
      guestId: guest.guestId || "",
      channelId: input.channelId,
      lineUserId: input.lineUserId,
      eventId: input.eventId,
      eventTimestamp: input.eventTimestamp || "",
      guestMessage: cleanText(input.messageText, 2000),
      detectedIntent: route.intent,
      replyType: "no_reply",
      replyText: "",
      usedSafeFactKey: "",
      route: "no_reply_silent_ignore",
      confidence: Number(route.confidence || 0),
      decisionReason: route.reason || "silent_ignore",
      shouldReply: false,
      noReply: true,
      silentIgnore: true,
      humanHandoff: false,
      needsReview: false,
      reviewNote: "",
      ownerAction: "",
      status: "resolved",
      processingStatus: "no_reply"
    });
  }

  function resolveTestLine(input) {
    const homestay = requireCustomerId(input.customerId);
    const eventId = cleanText(input.eventId, 200);
    if (!eventId) throw new AppError(400, "MISSING_EVENT_ID", "LINE webhook eventId is required");
    const lineUserId = validateLineUserId(input.lineUserId);
    const messageText = cleanText(input.messageText, 2000);
    if (!messageText) throw new AppError(400, "MISSING_GUEST_MESSAGE", "Guest message is required");
    const route = input.route && typeof input.route === "object" ? input.route : {};
    const routeIntent = cleanText(route.intent, 80);
    const confidence = Number(route.confidence || 0);
    const guest = lineUserId ? repository.findGuestByLineUserId(homestay.customerId, lineUserId) : null;
    const baseMessage = {
      customerId: homestay.customerId,
      channelId: cleanText(input.channelId, 200),
      lineUserId,
      eventId,
      eventTimestamp: input.eventTimestamp || "",
      guestMessage: messageText
    };

    if (route.shouldIgnore || route.route === "no_reply_silent_ignore") {
      const item = appendSilentBridgeMessage(homestay, guest || {}, { ...input, ...baseMessage, messageText }, route);
      return bridgeResult(item, false, input);
    }

    const reviewReason = REVIEW_REASON_LABELS[route.reason]
      || (String(route.reason || "").startsWith("high_risk_") ? "此問題屬於高風險類型，請人工確認。" : "此問題分類為不確定或高風險，請人工確認。");
    if (route.needsHuman || route.route === "human_handoff_required") {
      const item = writeMessage({
        ...baseMessage,
        detectedIntent: routeIntent || "unknown",
        route: route.route,
        confidence,
        decisionReason: route.reason,
        humanHandoff: true,
        needsReview: true,
        reviewNote: reviewReason
      });
      return bridgeResult(item, false, input);
    }

    if (routeIntent === "availability") {
      const fields = route.extractedFields || {};
      if (!fields.checkInDate) {
        const item = appendFixedBridgeMessage(homestay, guest || {}, { ...input, ...baseMessage }, "availability", "請問預計哪一天入住呢？", "availability");
        return bridgeResult(item, false, input);
      }
      if (!fields.checkOutDate) {
        const item = appendFixedBridgeMessage(homestay, guest || {}, { ...input, ...baseMessage }, "availability", "請問預計住幾晚呢？", "availability");
        return bridgeResult(item, false, input);
      }
      const availability = searchAvailability({
        customerId: homestay.customerId,
        checkIn: fields.checkInDate,
        checkOut: fields.checkOutDate,
        guests: fields.guestCount,
        roomType: fields.roomType || "all",
        queryMode: fields.queryMode || "any"
      });
      if (!availability.availabilityReliable) {
        const item = persistMessageEvent(homestay.customerId, {
          ...baseMessage,
          guestId: guest && guest.guestId || "",
          detectedIntent: "availability",
          replyType: "human_handoff",
          replyText: FIXED_AVAILABILITY_UNCONFIRMED_REPLY,
          route: "human_handoff_required",
          confidence,
          decisionReason: "availability_data_unavailable",
          shouldReply: true,
          noReply: false,
          silentIgnore: false,
          humanHandoff: true,
          needsReview: true,
          reviewNote: REVIEW_REASON_LABELS.availability_data_unavailable,
          ownerAction: "",
          status: "pending"
        });
        return bridgeResult(item, false, input);
      }
      const replyText = availability.rooms.length
        ? `${fields.checkInDate} 至 ${fields.checkOutDate} 可詢問房型：${availability.rooms.map(publicRoomName).join("、")}。實際訂房請由業者確認。`
        : `${fields.checkInDate} 至 ${fields.checkOutDate} 目前沒有符合條件的可訂房型，請由真人協助確認。`;
      const item = appendFixedBridgeMessage(homestay, guest || {}, { ...input, ...baseMessage }, "availability", replyText, "availability");
      return bridgeResult(item, false, input);
    }

    if (routeIntent === "room_type_capacity") {
      const replyText = `目前可詢問房型：${(homestay.rooms || []).map((item) => `${publicRoomName(item)}（最多 ${item.capacity} 人）`).join("、")}。`;
      return bridgeResult(appendFixedBridgeMessage(homestay, guest || {}, { ...input, ...baseMessage }, "room_type_capacity", replyText, "rooms"), false, input);
    }

    if (routeIntent === "greeting") {
      return bridgeResult(appendFixedBridgeMessage(
        homestay,
        guest || {},
        { ...input, ...baseMessage },
        "greeting",
        `您好，這裡是${homestay.name}，請問想詢問房況或住宿資訊呢？`,
        "homestayName"
      ), false, input);
    }

    if (routeIntent === "equipment" && !equipmentHasConfirmedEvidence(homestay, messageText)) {
      const item = writeMessage({
        ...baseMessage,
        detectedIntent: "equipment",
        replyType: "human_handoff",
        route: "human_handoff_required",
        confidence,
        decisionReason: "equipment_fact_not_confirmed",
        humanHandoff: true,
        needsReview: true,
        reviewNote: "設備問題未在業者已確認資料中找到明確答案，請真人確認。"
      });
      return bridgeResult(item, false, input);
    }

    if (routeIntent === "price") {
      const rooms = selectedInventory(homestay.rooms, route.extractedFields || {});
      const replyText = structuredPriceReply(rooms) || legacyConfirmedPriceReply(homestay, rooms);
      if (replyText) {
        return bridgeResult(appendFixedBridgeMessage(homestay, guest || {}, { ...input, ...baseMessage }, "price", replyText, "structuredPricing"), false, input);
      }
      const item = writeMessage({
        ...baseMessage,
        detectedIntent: "price",
        replyType: "human_handoff",
        route: "human_handoff_required",
        confidence,
        decisionReason: "structured_price_not_confirmed",
        humanHandoff: true,
        needsReview: true,
        reviewNote: "四類結構化價格不完整，請真人確認。"
      });
      return bridgeResult(item, false, input);
    }

    const safeFactKey = INTENT_SAFE_FACTS[routeIntent];
    if (safeFactKey) {
      const item = writeMessage({
        ...baseMessage,
        detectedIntent: routeIntent,
        replyType: "fixed_reply",
        route: route.route,
        confidence,
        decisionReason: route.reason,
        humanHandoff: false,
        needsReview: false
      });
      return bridgeResult(item, false, input);
    }

    const item = writeMessage({
      ...baseMessage,
      detectedIntent: routeIntent || "unknown",
      route: "human_handoff_required",
      confidence,
      decisionReason: "unknown_intent",
      humanHandoff: true,
      needsReview: true,
      reviewNote: REVIEW_REASON_LABELS.unknown_intent
    });
    return bridgeResult(item, false, input);
  }

  function listNotes(customerId, guestId) {
    const homestay = requireCustomerId(customerId);
    if (!repository.getGuest(homestay.customerId, guestId)) {
      throw new AppError(404, "GUEST_NOT_FOUND", "Guest not found for customerId");
    }
    return repository.listNotes(homestay.customerId, guestId);
  }

  function addNote(customerId, guestId, text) {
    const homestay = requireCustomerId(customerId);
    if (!repository.getGuest(homestay.customerId, guestId)) {
      throw new AppError(404, "GUEST_NOT_FOUND", "Guest not found for customerId");
    }
    if (!String(text || "").trim()) throw new AppError(400, "MISSING_NOTE", "Note text is required");
    return repository.addNote(homestay.customerId, guestId, text);
  }

  function updateNote(customerId, guestId, noteId, text) {
    const homestay = requireCustomerId(customerId);
    if (!repository.getGuest(homestay.customerId, guestId)) {
      throw new AppError(404, "GUEST_NOT_FOUND", "Guest not found for customerId");
    }
    if (!String(text || "").trim()) throw new AppError(400, "MISSING_NOTE", "Note text is required");
    const note = repository.updateNote(homestay.customerId, guestId, noteId, text);
    if (!note) throw new AppError(404, "NOTE_NOT_FOUND", "Note not found for customerId");
    return note;
  }

  function getDashboard(customerId) {
    const homestay = requireCustomerId(customerId);
    const logs = repository.listMessageLogs(homestay.customerId);
    const pending = logs.filter((item) => item.needsReview && item.status !== "resolved");
    return {
      customerId: homestay.customerId,
      homestayName: homestay.name,
      todayMessageCount: logs.filter((item) => String(item.createdAt || "").slice(0, 10) === now().toISOString().slice(0, 10)).length,
      pendingReviewCount: pending.length,
      pendingHumanHandoffCount: pending.filter((item) => item.humanHandoff).length,
      lastMessageAt: logs.reduce((last, item) => String(item.createdAt || "") > last ? String(item.createdAt) : last, "")
    };
  }

  function listReviews(customerId, status = "pending", limit = 50) {
    const homestay = requireCustomerId(customerId);
    const normalizedStatus = String(status || "pending").trim() || "pending";
    const requestedLimit = Number(limit);
    const normalizedLimit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(100, Math.floor(requestedLimit))
      : 50;
    const formatSafeTrace = typeof safeTraceFormatter === "function" ? safeTraceFormatter : () => null;
    return repository.listMessageLogs(homestay.customerId, { status: normalizedStatus, limit: normalizedLimit })
      .map((item) => ({
        reviewId: item.reviewId,
        guestId: item.guestId || "",
        lineUserId: item.lineUserId || "",
        createdAt: item.createdAt,
        guestMessage: item.guestMessage,
        replyText: item.replyText,
        processingStatus: item.processingStatus || "",
        decisionReason: item.decisionReason || "",
        safeTrace: (Array.isArray(item.safeTrace) ? item.safeTrace : [])
          .slice(-40)
          .map((entry) => formatSafeTrace(entry))
          .filter(Boolean),
        reviewReason: item.reviewReason || item.reviewNote || "需要業者確認後再回覆客人。",
        availableActions: [
          { action: "correct", label: "確認內容正確" },
          { action: "edit", label: "修改後採用" },
          { action: "dismiss", label: "略過這一則" }
        ],
        ownerAction: item.ownerAction || "",
        status: item.status || "pending"
      }));
  }

  function resolveReview(customerId, reviewId, ownerAction, reviewNote) {
    const homestay = requireCustomerId(customerId);
    if (!ALLOWED_ACTIONS.has(ownerAction)) throw new AppError(400, "INVALID_OWNER_ACTION", "Invalid ownerAction");
    const item = repository.resolveReview(homestay.customerId, reviewId, ownerAction, String(reviewNote || ""));
    if (!item) throw new AppError(404, "REVIEW_NOT_FOUND", "Review not found for customerId");
    return item;
  }

  return {
    listHomestays,
    getBootstrap,
    getPropertyProfile,
    updatePropertyProfile,
    getPropertyFacts,
    updatePropertyFacts,
    updateSettings,
    searchAvailability,
    searchAvailableDates,
    getMonth,
    setDay,
    setDayNote,
    setMonth,
    applyBatch,
    listGuests,
    createGuest,
    updateGuest,
    listGuestMessages,
    writeMessage,
    resolveTestLine,
    listNotes,
    addNote,
    updateNote,
    getDashboard,
    listReviews,
    resolveReview
  };
}

module.exports = { createMvpService, AppError, stayDates };
