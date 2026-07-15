"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createProviders } = require("./lib/providers/provider-factory");
const {
  createTestOnlyOpenAiStructuredClassifierFromEnv
} = require("./lib/providers/test-only-openai-structured-classifier");
const { createMvpService, AppError } = require("./lib/mvp-service");
const { ConversationCoordinator } = require("./lib/conversation-coordinator");
const { verifyLineSignature, replyToTestLine } = require("./lib/test-line-webhook");
const {
  createAiFirstDecisionPipeline,
  DEFAULT_INTENTS,
  DEFAULT_ROUTES
} = require("./lib/ai-first-decision-pipeline");
const { runtimeConfig } = require("./config/runtime");
const { verifyPassword, sessionTokenHash } = require("./lib/admin-auth");
const { createOnboardingService } = require("./lib/onboarding-service");
const { createPublicBrand } = require("./config/public-brand");
const { renderPublicHtml } = require("./lib/public-brand-html");

const APP_ROOT = __dirname;
const PUBLIC_ROOT = path.join(APP_ROOT, "public");

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function cookieValue(request, name) {
  const item = String(request.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
}

function isAdminDataRoute(pathname) {
  return pathname === "/api/homestays" || pathname === "/api/bootstrap" || pathname === "/api/settings" || pathname.startsWith("/api/availability/month") || pathname === "/api/availability/day" || pathname === "/api/availability/batch" || pathname.startsWith("/api/bundles") || pathname.startsWith("/api/guests") || pathname === "/api/messages" || pathname === "/api/dashboard" || pathname.startsWith("/api/reviews");
}

function sendData(response, data, status = 200) {
  sendJson(response, status, { ok: true, data });
}

function sendError(response, error) {
  const status = error instanceof AppError ? error.status : 500;
  const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
  sendJson(response, status, {
    ok: false,
    error: { code, message: status === 500 ? "Test-only server error" : error.message }
  });
}

function logTestLineDiagnostic(step, details = {}) {
  console.log(JSON.stringify({ scope: "test-only-line-webhook", step, ...details }));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) request.destroy();
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new AppError(400, "INVALID_JSON", "Request body must be valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on("data", (chunk) => {
      length += chunk.length;
      if (length > 1024 * 1024) {
        reject(new AppError(413, "REQUEST_TOO_LARGE", "Request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[extension] || "application/octet-stream";
}

function sendStatic(response, relativePath, publicBrand) {
  const filePath = path.resolve(PUBLIC_ROOT, relativePath);
  if (!filePath.startsWith(PUBLIC_ROOT) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
    return;
  }
  response.writeHead(200, { "content-type": contentType(filePath), "cache-control": "no-store" });
  if (path.extname(filePath).toLowerCase() === ".html") {
    response.end(renderPublicHtml(fs.readFileSync(filePath, "utf8"), publicBrand));
    return;
  }
  fs.createReadStream(filePath).pipe(response);
}

function secretsMatch(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}
function readAttachmentBody(request) {
  return new Promise((resolve,reject)=>{const chunks=[];let length=0;request.on("data",chunk=>{length+=chunk.length;if(length>10*1024*1024){reject(new AppError(413,"ATTACHMENT_TOO_LARGE","附件過大"));request.destroy();return;}chunks.push(chunk);});request.on("end",()=>resolve(Buffer.concat(chunks)));request.on("error",reject);});
}

function nextDateKey(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) {
    throw new AppError(400, "INVALID_DATE", "checkIn must use YYYY-MM-DD");
  }
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey) {
    throw new AppError(400, "INVALID_DATE", "checkIn is invalid");
  }
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function publicAvailabilityResult(result) {
  let lineUrl = "";
  try {
    const parsed = new URL(String(result.lineUrl || ""));
    if (parsed.protocol === "https:" || parsed.protocol === "http:") lineUrl = parsed.toString();
  } catch {}
  const item = (room) => ({
    id: room.id,
    name: room.name,
    capacity: Number(room.capacity || 0),
    basePrice: Number(room.basePrice || 0) || null
  });
  const rooms = result.rooms.filter((room) => room.inventoryType !== "bundle").map(item);
  const bundles = result.rooms.filter((room) => room.inventoryType === "bundle").map(item);
  return {
    propertyId: result.customerId,
    propertyName: result.homestayName,
    checkInDate: result.checkIn,
    checkOutDate: result.checkOut,
    guestCount: result.guests,
    queryMode: result.queryMode,
    roomFilter: result.roomType,
    rooms,
    bundles,
    empty: rooms.length === 0 && bundles.length === 0,
    lineUrl
  };
}

function createRequestHandler(service, options = {}) {
  const testLineSecret = String(options.testLineSecret || "");
  const resolveTestLineRequest = options.resolveTestLineRequest || ((input) => service.resolveTestLine(input));
  const lineWebhookHandler = options.lineWebhookHandler;
  const persistence = options.persistence;
  const customerSettings = options.customerSettings;
  const onboarding = options.onboarding;
  const adminAuthRequired = Boolean(options.adminAuthRequired);
  const publicBrand = options.publicBrand || createPublicBrand();
  return async function handleRequest(request, response) {
    const url = new URL(request.url, "http://127.0.0.1");
    const pathname = url.pathname;

    try {
      if (request.method === "GET" && pathname === "/api/health") {
        return sendData(response, { status: "ready", testOnly: true });
      }
      if (request.method === "GET" && pathname === "/api/public/brand") return sendData(response, publicBrand);
      if (request.method === "POST" && pathname === "/api/test-line/webhook") {
        if (!lineWebhookHandler) throw new AppError(503, "TEST_LINE_WEBHOOK_NOT_CONFIGURED", "Test-only LINE webhook is not configured");
        const result = await lineWebhookHandler({
          rawBody: await readRawBody(request),
          signature: request.headers["x-line-signature"],
          customerId: url.searchParams.get("customerId")
        });
        return sendData(response, result);
      }
      if (request.method === "POST" && pathname === "/api/test-line/resolve") {
        if (!testLineSecret) throw new AppError(503, "TEST_LINE_BRIDGE_NOT_CONFIGURED", "Test-only LINE bridge is not configured");
        if (!secretsMatch(request.headers["x-test-line-secret"], testLineSecret)) {
          throw new AppError(401, "INVALID_TEST_LINE_SECRET", "Invalid test-only bridge secret");
        }
        return sendData(response, await resolveTestLineRequest(await readJsonBody(request)));
      }
      if (request.method === "GET" && (pathname === "/" || pathname === "/guest")) return sendStatic(response, "guest.html", publicBrand);
      if (request.method === "GET" && pathname === "/onboarding") return sendStatic(response, "onboarding.html", publicBrand);
      if (request.method === "GET" && pathname === "/admin/setup") return sendStatic(response, "admin-setup.html", publicBrand);
      if (request.method === "GET" && pathname === "/admin/onboarding") {const token=cookieValue(request,"nephi_admin_session"),session=token&&adminAuthRequired?await persistence.getAdminSession(sessionTokenHash(token)):null;if(!session||!onboarding||!onboarding.isPlatformAdmin(session))throw new AppError(401,"PLATFORM_ADMIN_REQUIRED","需要平台管理者權限");return sendStatic(response,"admin-onboarding.html",publicBrand);}
      if (request.method === "GET" && pathname === "/admin") return sendStatic(response, "admin.html", publicBrand);
      if (request.method === "GET" && pathname.startsWith("/assets/")) return sendStatic(response, pathname.slice(1), publicBrand);

      if(pathname==="/api/public/onboarding/drafts"&&request.method==="POST"){if(!onboarding)throw new AppError(503,"ONBOARDING_NOT_CONFIGURED","業者導入只支援 PostgreSQL");return sendData(response,onboarding.createDraft(),201);}
      const draftMatch=/^\/api\/public\/onboarding\/drafts\/([^/]+)$/.exec(pathname),previewMatch=/^\/api\/public\/onboarding\/drafts\/([^/]+)\/preview$/.exec(pathname),submitMatch=/^\/api\/public\/onboarding\/drafts\/([^/]+)\/submit$/.exec(pathname),attachmentMatch=/^\/api\/public\/onboarding\/drafts\/([^/]+)\/attachments$/.exec(pathname);const draftToken=request.headers["x-onboarding-draft-token"];
      if(draftMatch&&request.method==="GET")return sendData(response,await onboarding.getDraft(draftMatch[1],draftToken));
      if(draftMatch&&request.method==="PATCH")return sendData(response,await onboarding.saveDraft(draftMatch[1],draftToken,await readJsonBody(request)));
      if(previewMatch&&request.method==="GET")return sendData(response,await onboarding.preview(previewMatch[1],draftToken));
      if(submitMatch&&request.method==="POST")return sendData(response,await onboarding.submit(submitMatch[1],draftToken));
      if(attachmentMatch&&request.method==="POST")return sendData(response,await onboarding.addAttachment(attachmentMatch[1],draftToken,{fileName:url.searchParams.get("filename"),contentType:String(request.headers["content-type"]||"").split(";")[0],buffer:await readAttachmentBody(request)}),201);
      if(pathname==="/api/admin/setup"&&request.method==="POST"){const body=await readJsonBody(request);return sendData(response,await onboarding.redeemInvitation(body.token,body.password));}

      if(pathname.startsWith("/api/admin/onboarding/")){
        const token=cookieValue(request,"nephi_admin_session"),session=token&&adminAuthRequired?await persistence.getAdminSession(sessionTokenHash(token)):null;if(!session||!onboarding||!onboarding.isPlatformAdmin(session))throw new AppError(401,"PLATFORM_ADMIN_REQUIRED","需要平台管理者權限");
        if(pathname==="/api/admin/onboarding/applications"&&request.method==="GET")return sendData(response,{items:onboarding.list().map(x=>({...x,completeness:require("./lib/onboarding-service").completeness(x)}))});
        const review=/^\/api\/admin\/onboarding\/applications\/([^/]+)(?:\/(request-changes|reject|approve))?$/.exec(pathname);if(review&&request.method==="GET"&&!review[2])return sendData(response,onboarding.get(review[1]));if(review&&request.method==="POST"){const body=await readJsonBody(request);if(review[2]==="approve")return sendData(response,onboarding.approve(review[1],body,session));return sendData(response,onboarding.review(review[1],review[2]==="reject"?"rejected":"changes_requested",body.reason,session));}
      }

      if (request.method === "GET" && pathname === "/api/public/availability") {
        const propertyId = String(url.searchParams.get("propertyId") || "").trim();
        const checkIn = String(url.searchParams.get("checkIn") || "").trim();
        const checkOut = String(url.searchParams.get("checkOut") || "").trim() || nextDateKey(checkIn);
        const queryMode = String(url.searchParams.get("queryMode") || "any").trim();
        if (!["any", "room_only", "bundle_only"].includes(queryMode)) {
          throw new AppError(400, "INVALID_QUERY_MODE", "Invalid query mode");
        }
        const property = service.getBootstrap(propertyId);
        if (property.publicEnabled === false) throw new AppError(404, "PROPERTY_NOT_AVAILABLE", "Property is not available");
        const result = service.searchAvailability({
          customerId: propertyId,
          checkIn,
          checkOut,
          guests: url.searchParams.get("guests"),
          roomType: String(url.searchParams.get("roomType") || "all").trim() || "all",
          queryMode
        });
        return sendData(response, publicAvailabilityResult(result));
      }

      if (request.method === "POST" && pathname === "/api/admin/login") {
        if (!adminAuthRequired) throw new AppError(503, "ADMIN_AUTH_NOT_CONFIGURED", "Admin login requires PostgreSQL");
        const body = await readJsonBody(request);
        const propertyId = String(body.propertyId || "").trim();
        const username = String(body.username || "").trim();
        const user = await persistence.getAdminUser(propertyId, username);
        if (!user || !await verifyPassword(body.password, user.passwordHash)) throw new AppError(401, "INVALID_LOGIN", "帳號或密碼錯誤");
        const token = crypto.randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
        await persistence.createAdminSession(sessionTokenHash(token), propertyId, username, expiresAt);
        return sendJson(response, 200, { ok: true, data: { propertyId, username } }, { "set-cookie": `nephi_admin_session=${encodeURIComponent(token)}; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict` });
      }
      if (request.method === "POST" && pathname === "/api/admin/logout") {
        const token = cookieValue(request, "nephi_admin_session");
        if (token && adminAuthRequired) await persistence.deleteAdminSession(sessionTokenHash(token));
        return sendJson(response, 200, { ok: true, data: { loggedOut: true } }, { "set-cookie": "nephi_admin_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict" });
      }
      if (request.method === "GET" && pathname === "/api/admin/session") {
        const token = cookieValue(request, "nephi_admin_session");
        const session = token && adminAuthRequired ? await persistence.getAdminSession(sessionTokenHash(token)) : null;
        if (!session) throw new AppError(401, "LOGIN_REQUIRED", "請先登入");
        return sendData(response, session);
      }

      let adminSession = null;
      if (adminAuthRequired && isAdminDataRoute(pathname)) {
        const token = cookieValue(request, "nephi_admin_session");
        adminSession = token ? await persistence.getAdminSession(sessionTokenHash(token)) : null;
        if (!adminSession) throw new AppError(401, "LOGIN_REQUIRED", "請先登入");
        if (request.method !== "GET") request.adminBody = await readJsonBody(request);
        const requestedPropertyId = String(request.method === "GET" ? url.searchParams.get("customerId") || "" : request.adminBody.customerId || "").trim();
        if (requestedPropertyId && requestedPropertyId !== adminSession.propertyId) throw new AppError(403, "PROPERTY_ACCESS_DENIED", "無權存取其他業者資料");
      }

      if (request.method === "GET" && pathname === "/api/homestays") {
        const homestays = service.listHomestays();
        return sendData(response, { homestays: adminSession ? homestays.filter((item) => item.customerId === adminSession.propertyId) : homestays });
      }
      if (request.method === "GET" && pathname === "/api/bootstrap") {
        return sendData(response, service.getBootstrap(url.searchParams.get("customerId")));
      }
      if (request.method === "PUT" && pathname === "/api/settings") {
        return sendData(response, { settings: service.updateSettings(request.adminBody || await readJsonBody(request)) });
      }
      if (request.method === "GET" && pathname === "/api/availability/search") {
        return sendData(response, service.searchAvailability({
          customerId: url.searchParams.get("customerId"),
          checkIn: url.searchParams.get("checkIn"),
          checkOut: url.searchParams.get("checkOut"),
          guests: url.searchParams.get("guests"),
          roomType: url.searchParams.get("roomType")
        }));
      }
      if (request.method === "GET" && pathname === "/api/availability/month") {
        return sendData(response, service.getMonth(
          url.searchParams.get("customerId"),
          url.searchParams.get("year"),
          url.searchParams.get("month")
        ));
      }
      if (request.method === "POST" && pathname === "/api/availability/day") {
        return sendData(response, { row: service.setDay(request.adminBody || await readJsonBody(request)) });
      }
      if (request.method === "POST" && pathname === "/api/availability/month") {
        return sendData(response, service.setMonth(request.adminBody || await readJsonBody(request)));
      }
      if (request.method === "POST" && pathname === "/api/availability/batch") {
        return sendData(response, service.applyBatch(request.adminBody || await readJsonBody(request)));
      }
      if (request.method === "GET" && pathname === "/api/bundles") return sendData(response, { bundles: customerSettings.listBundles(url.searchParams.get("customerId")) });
      if (request.method === "POST" && pathname === "/api/bundles") { const body=request.adminBody||await readJsonBody(request);return sendData(response,{bundle:customerSettings.createBundle(body.customerId,body)},201); }
      const bundleMatch=/^\/api\/bundles\/([^/]+)$/.exec(pathname);
      if(bundleMatch&&request.method==="PUT"){const body=request.adminBody||await readJsonBody(request);return sendData(response,{bundle:customerSettings.updateBundle(body.customerId,bundleMatch[1],body)});}
      if(bundleMatch&&request.method==="DELETE"){const body=request.adminBody||await readJsonBody(request);return sendData(response,{deleted:customerSettings.deleteBundle(body.customerId,bundleMatch[1])});}

      if (request.method === "GET" && pathname === "/api/guests") {
        return sendData(response, { guests: service.listGuests(url.searchParams.get("customerId"), url.searchParams.get("q")) });
      }
      if (request.method === "POST" && pathname === "/api/guests") {
        return sendData(response, { guest: service.createGuest(request.adminBody || await readJsonBody(request)) }, 201);
      }

      const guestMatch = /^\/api\/guests\/([^/]+)$/.exec(pathname);
      if (guestMatch && request.method === "PUT") {
        const body = request.adminBody || await readJsonBody(request);
        return sendData(response, { guest: service.updateGuest(body.customerId, guestMatch[1], body) });
      }

      const notesMatch = /^\/api\/guests\/([^/]+)\/notes$/.exec(pathname);
      if (notesMatch && request.method === "GET") {
        return sendData(response, { notes: service.listNotes(url.searchParams.get("customerId"), notesMatch[1]) });
      }
      if (notesMatch && request.method === "POST") {
        const body = request.adminBody || await readJsonBody(request);
        return sendData(response, { note: service.addNote(body.customerId, notesMatch[1], body.text) }, 201);
      }
      const noteEditMatch = /^\/api\/guests\/([^/]+)\/notes\/([^/]+)$/.exec(pathname);
      if (noteEditMatch && request.method === "PUT") {
        const body = request.adminBody || await readJsonBody(request);
        return sendData(response, {
          note: service.updateNote(body.customerId, noteEditMatch[1], noteEditMatch[2], body.text)
        });
      }

      const guestMessagesMatch = /^\/api\/guests\/([^/]+)\/messages$/.exec(pathname);
      if (guestMessagesMatch && request.method === "GET") {
        return sendData(response, {
          items: service.listGuestMessages(url.searchParams.get("customerId"), guestMessagesMatch[1])
        });
      }

      if (request.method === "POST" && pathname === "/api/messages") {
        return sendData(response, { item: service.writeMessage(request.adminBody || await readJsonBody(request)) }, 201);
      }

      if (request.method === "GET" && pathname === "/api/dashboard") {
        return sendData(response, { summary: service.getDashboard(url.searchParams.get("customerId")) });
      }
      if (request.method === "GET" && pathname === "/api/reviews") {
        return sendData(response, {
          items: service.listReviews(url.searchParams.get("customerId"), url.searchParams.get("status") || "pending")
        });
      }
      const reviewMatch = /^\/api\/reviews\/([^/]+)\/resolve$/.exec(pathname);
      if (reviewMatch && request.method === "POST") {
        const body = request.adminBody || await readJsonBody(request);
        return sendData(response, {
          item: service.resolveReview(body.customerId, reviewMatch[1], body.ownerAction, body.reviewNote)
        });
      }

      sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
    } catch (error) {
      sendError(response, error);
    }
  };
}

function createApp(options = {}) {
  const config = runtimeConfig();
  const publicBrand = options.publicBrand || createPublicBrand(options.publicBrandEnv || process.env);
  const dataFile = options.dataFile || config.dataFile;
  const seedFile = options.seedFile || config.seedFile;
  const now = options.now || (() => new Date());
  const timeZone = options.timeZone || config.timeZone;
  const testLineSecret = options.testLineSecret || config.lineBridgeSecret;
  const lineChannelSecret = options.lineChannelSecret || config.lineChannelSecret;
  const lineChannelAccessToken = options.lineChannelAccessToken || config.lineChannelAccessToken;
  const lineReplyFetch = options.lineReplyFetch || fetch;
  const providers = options.providers || createProviders({ databaseUrl: config.databaseUrl, dataFile, seedFile, now });
  const adminAuthRequired = Object.hasOwn(options, "adminAuthRequired") ? Boolean(options.adminAuthRequired) : providers.kind === "postgres";
  const service = createMvpService(providers, { now });
  const onboarding = createOnboardingService(providers.onboarding);
  const structuredClassifier = Object.hasOwn(options, "structuredClassifier")
    ? options.structuredClassifier
    : createTestOnlyOpenAiStructuredClassifierFromEnv({
      env: options.openAiTestEnv || process.env,
      fetchImpl: options.openAiTestFetch || globalThis.fetch,
      timeoutMs: options.classifierTimeoutMs || config.classifierTimeoutMs
    });
  const decisionPipeline = createAiFirstDecisionPipeline({
    classifier: structuredClassifier,
    timeoutMs: options.classifierTimeoutMs || config.classifierTimeoutMs,
    minConfidence: options.classifierMinConfidence || config.classifierMinConfidence
  });
  const coordinatorOptions = {
    persistence: providers.persistence,
    now,
    timeZone,
    debounceMs: options.conversationDebounceMs || config.conversationDebounceMs,
    ttlMs: options.conversationTtlMs || config.conversationTtlMs,
    recentMessageLimit: options.recentMessageLimit || config.recentMessageLimit,
    recentMessageWindowMs: options.recentMessageWindowMs || config.recentMessageWindowMs,
    decisionPipeline,
    getProperty: (propertyId) => providers.customerSettings.getProperty(propertyId),
    availableIntents: DEFAULT_INTENTS,
    availableRoutes: DEFAULT_ROUTES,
    onDiagnostic: options.conversationDiagnostic || ((details) => {
      console.error(JSON.stringify({ scope: "conversation-coordinator", step: "flush_exception", ...details }));
    }),
    resolveMerged: (input) => service.resolveTestLine(input)
    ,availabilityFingerprint: (fields) => { try { const result=service.searchAvailability({customerId:fields.propertyId||"",checkIn:fields.checkInDate,checkOut:fields.checkOutDate,guests:fields.guestCount,roomType:fields.roomType||"all",queryMode:fields.queryMode||"any"});return JSON.stringify([result.availabilityReliable,result.rooms.map(room=>room.id)]); } catch { return ""; } }
  };
  const conversationCoordinator = new ConversationCoordinator({
    ...coordinatorOptions,
    externalReplyToken: true,
  });
  const claimEvent = async (input) => providers.persistence.claimMessageEvent(
    input.customerId,
    input.channelId,
    input.eventId,
    {
      lineUserId: String(input.lineUserId || ""),
      eventTimestamp: input.eventTimestamp || "",
      guestMessage: String(input.messageText || ""),
      replyType: "processing",
      replyText: "",
      route: "",
      decisionReason: "",
      humanHandoff: false,
      silentIgnore: false
    }
  );
  const updateEventStatus = async (customerId, channelId, eventId, patch) => (
    providers.persistence.updateMessageEvent(customerId, channelId, eventId, patch)
  );
  const resolveTestLineRequest = async (input) => {
    const customerId = String(input && input.customerId || "").trim();
    const eventId = String(input && input.eventId || "").trim();
    if (!customerId) throw new AppError(400, "MISSING_CUSTOMER_ID", "customerId is required");
    if (!providers.customerSettings.getProperty(customerId)) throw new AppError(404, "UNKNOWN_CUSTOMER_ID", "Unknown Pilot customerId");
    if (!eventId) throw new AppError(400, "MISSING_EVENT_ID", "LINE webhook eventId is required");
    const channelId = String(input.channelId || "test-line-bridge");
    const claimed = await claimEvent({ ...input, customerId, channelId, eventId });
    if (!claimed.claimed) {
      return { shouldReply: false, noReply: true, duplicate: true, replyToken: "", superseded: false };
    }
    return conversationCoordinator.enqueue({ ...input, channelId }).catch(async (error) => {
      await updateEventStatus(customerId, channelId, eventId, {
        processingStatus: "processing_failed",
        deliveryErrorCode: "message_processing_exception",
        needsReview: true,
        status: "pending",
        reviewNote: "訊息處理失敗，請人工確認。"
      });
      throw error;
    });
  };
  const lineWebhookCoordinator = new ConversationCoordinator({
    ...coordinatorOptions
  });
  const lineWebhookHandler = async ({ rawBody, signature, customerId }) => {
    logTestLineDiagnostic("received", { hasBody: rawBody.length > 0, hasSignature: Boolean(signature) });
    if (!lineChannelSecret || !lineChannelAccessToken) {
      logTestLineDiagnostic("configuration_missing", { hasChannelSecret: Boolean(lineChannelSecret), hasChannelAccessToken: Boolean(lineChannelAccessToken) });
      throw new AppError(503, "TEST_LINE_WEBHOOK_NOT_CONFIGURED", "Test-only LINE webhook is not configured");
    }
    if (!verifyLineSignature(rawBody, signature, lineChannelSecret)) {
      logTestLineDiagnostic("signature_rejected");
      throw new AppError(401, "INVALID_LINE_SIGNATURE", "Invalid LINE signature");
    }
    logTestLineDiagnostic("signature_verified");
    let payload;
    try { payload = JSON.parse(rawBody.toString("utf8")); } catch {
      throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
    }
    const id = String(customerId || "").trim();
    if (!id) throw new AppError(400, "MISSING_CUSTOMER_ID", "customerId is required");
    if (!providers.customerSettings.getProperty(id)) throw new AppError(404, "UNKNOWN_CUSTOMER_ID", "Unknown Pilot customerId");
    const channelId = String(payload.destination || "").trim();
    if (!channelId) throw new AppError(400, "MISSING_CHANNEL_ID", "LINE destination channel identifier is required");
    const textEvents = (payload.events || []).filter((event) => event && event.type === "message" && event.message && event.message.type === "text");
    logTestLineDiagnostic("payload_parsed", { customerId: id, eventCount: (payload.events || []).length, textEventCount: textEvents.length });
    for (const event of textEvents) {
      const eventId = String(event.webhookEventId || event.message.id || "");
      logTestLineDiagnostic("coordinator_enter", { customerId: id, hasEventId: Boolean(eventId), hasReplyToken: Boolean(event.replyToken) });
      const eventInput = {
        customerId: id,
        channelId,
        lineUserId: event.source && event.source.userId || "",
        eventId,
        eventTimestamp: event.timestamp || "",
        replyToken: event.replyToken || "",
        messageText: event.message.text || ""
      };
      const claimed = await claimEvent(eventInput);
      if (!claimed.claimed) {
        logTestLineDiagnostic("persistent_duplicate", { customerId: id, eventId });
        continue;
      }
      lineWebhookCoordinator.enqueue(eventInput).then(async (result) => {
        logTestLineDiagnostic("coordinator_result", { customerId: id, shouldReply: Boolean(result.shouldReply), hasReplyText: Boolean(result.replyText), hasReplyToken: Boolean(result.replyToken), duplicate: Boolean(result.duplicate), silent: Boolean(result.silent) });
        if (!result.shouldReply || !result.replyText || !result.replyToken) {
          await updateEventStatus(id, channelId, eventId, { processingStatus: "no_reply", shouldReply: false, noReply: true });
          return;
        }
        let reply;
        try {
          reply = await replyToTestLine(result.replyToken, result.replyText, lineChannelAccessToken, lineReplyFetch);
        } catch {
          await updateEventStatus(id, channelId, eventId, {
            processingStatus: "reply_failed",
            deliveryErrorCode: "line_reply_exception",
            replyDelivered: false,
            needsReview: true,
            status: "pending",
            reviewNote: "LINE 回覆傳送失敗，請人工確認是否需要聯絡客人。"
          });
          logTestLineDiagnostic("reply_api_exception", { customerId: id, eventId });
          return;
        }
        logTestLineDiagnostic("reply_api_result", { status: reply.status, ok: reply.ok });
        if (!reply.ok) {
          await updateEventStatus(id, channelId, eventId, {
            processingStatus: "reply_failed",
            deliveryErrorCode: "line_reply_http_error",
            replyDelivered: false,
            needsReview: true,
            status: "pending",
            reviewNote: "LINE 回覆傳送失敗，請人工確認是否需要聯絡客人。"
          });
          return;
        }
        await updateEventStatus(id, channelId, eventId, {
          processingStatus: "reply_succeeded",
          deliveryErrorCode: "",
          replyDelivered: true
        });
      }).catch(async (error) => {
        await updateEventStatus(id, channelId, eventId, {
          processingStatus: "processing_failed",
          deliveryErrorCode: "message_processing_exception",
          needsReview: true,
          status: "pending",
          reviewNote: "訊息處理失敗，請人工確認。"
        });
        console.error(JSON.stringify({ scope: "test-only-line-webhook", step: "background_error", code: error.code || "INTERNAL_ERROR" }));
      });
    }
    return { accepted: true };
  };
  const server = http.createServer(createRequestHandler(service, { testLineSecret, resolveTestLineRequest, lineWebhookHandler, persistence: providers.persistence, customerSettings: providers.customerSettings, onboarding, adminAuthRequired, publicBrand }));

  return {
    providers,
    service,
    conversationCoordinator,
    lineWebhookCoordinator,
    start(port = config.port, host = config.host) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          const address = server.address();
          resolve({ url: `http://${host}:${address.port}`, port: address.port, host });
        });
      });
    },
    async stop() {
      await new Promise((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => error ? reject(error) : resolve());
      });
      if (typeof providers.close === "function") await providers.close();
    }
  };
}

if (require.main === module) {
  const app = createApp();
  app.start().then(({ url }) => {
    console.log(`Nephi Home Node Pilot v1: ${url}`);
  }).catch((error) => {
    console.error(error.stack || error);
    process.exit(1);
  });
}

module.exports = { createApp };
