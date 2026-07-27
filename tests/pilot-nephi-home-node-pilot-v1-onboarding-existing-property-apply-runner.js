"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "../pilot/nephi-home-node-pilot-v1");
const { migratePostgres } = require(path.join(ROOT, "lib/providers/postgres-migrate"));
const { seedPostgres } = require(path.join(ROOT, "lib/providers/postgres-seed"));
const { openPostgres } = require(path.join(ROOT, "lib/providers/postgres-client"));
const { createPostgresProviders } = require(path.join(ROOT, "lib/providers/postgres-providers"));
const { upsertAdminUser, sessionTokenHash } = require(path.join(ROOT, "lib/admin-auth"));
const { createApp } = require(path.join(ROOT, "server"));

const checks = [];
function check(name, condition) { assert.ok(condition, name); checks.push(name); }
async function request(url, options = {}) { const response = await fetch(url, options), raw = await response.text(); let body; try { body = JSON.parse(raw); } catch { body = raw; } return { response, body }; }
function submission(id, overrides = {}) {
  const rooms = [
    { key: "source_301", name: "301 更新名稱", type: "double", capacity: 2, mondayThursdayPrice: 2100, fridayPrice: 2400, saturdayHolidayPrice: 2800, sundayPrice: 2200, enabled: true },
    { key: "source_302", name: "302 保留價格", type: "quad", capacity: 4, mondayThursdayPrice: 0, fridayPrice: 0, saturdayHolidayPrice: 0, sundayPrice: 0, enabled: true },
    { key: "source_401", name: "401 更新名稱", type: "double", capacity: 2, mondayThursdayPrice: null, fridayPrice: null, saturdayHolidayPrice: null, sundayPrice: null, enabled: true },
    { key: "source_402", name: "402 更新名稱", type: "quad", capacity: 4, mondayThursdayPrice: 4100, fridayPrice: 4400, saturdayHolidayPrice: 4800, sundayPrice: 4200, enabled: true }
  ];
  return { propertyName: "尼腓更新名稱", contactName: "", phone: "0987654321", email: "new-contact@example.test", address: "更新地址", checkInTime: "16:00", checkOutTime: "11:00", line: { hasOfficialAccount: false, channelId: "SHOULD_NOT_APPLY", contactLink: "https://lin.ee/should-not-apply" }, rooms, bundles: [{ key: "source_bundle", name: "12 人包棟", memberRoomKeys: rooms.map((room) => room.key), capacity: 12, mondayThursdayPrice: 0, fridayPrice: 0, saturdayHolidayPrice: 0, sundayPrice: 0, enabled: true }], knowledge: [{ key: "parking", label: "停車方式", status: "fixed", answer: "更新後停車說明" }, { key: "new_fact", label: "新 FAQ", status: "fixed", answer: "已確認的新內容" }, { key: "empty_fact", label: "空內容", status: "fixed", answer: "" }, { key: "handoff", label: "轉真人", status: "human_handoff", answer: "不要寫入" }], ...overrides, applicationId: id };
}
async function addSubmission(db, id, overrides = {}) { const snapshot = submission(id, overrides); await db.query("INSERT INTO onboarding_applications(application_id,draft_token_hash,status,core_data,submitted_snapshot,submitted_at) VALUES($1,$2,'submitted',$3::jsonb,$4::jsonb,now())", [id, sessionTokenHash(`draft-${id}`), JSON.stringify({ propertyName: snapshot.propertyName }), JSON.stringify(snapshot)]); }
function validPayload() { return { mode: "existing", propertyId: "nephi_home", confirmPropertyId: "nephi_home", roomMappings: [{ sourceKey: "source_301", targetRoomId: "room301" }, { sourceKey: "source_302", targetRoomId: "room302" }, { sourceKey: "source_401", targetRoomId: "room401" }, { sourceKey: "source_402", targetRoomId: "room402" }], bundleMappings: [{ sourceKey: "source_bundle", targetBundleId: "bundle_four_room_whole_house" }] }; }
async function rows(db, table, orderBy) { return (await db.query(`SELECT * FROM ${table}${orderBy ? ` ORDER BY ${orderBy}` : ""}`)).rows; }
async function protectedSnapshot(db) {
  const tables = { availability_days: "property_id,stay_date", inventory_availability_days: "property_id,inventory_id,stay_date", daily_room_notes: "property_id,inventory_type,inventory_id,stay_date", room_price_overrides: "property_id,room_id,stay_date", conversation_states: "property_id,channel_id,line_user_id", message_logs: "property_id,review_id", review_queue_items: "property_id,review_id", event_claims: "property_id,external_event_id", admin_users: "property_id,username", admin_identities: "user_id", admin_user_properties: "user_id,property_id", admin_sessions: "token_hash", platform_admin_grants: "property_id,username", property_admin_invitations: "token_hash" }, result = {};
  for (const [table, orderBy] of Object.entries(tables)) result[table] = await rows(db, table, orderBy);
  return result;
}

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "onboarding-existing-apply-")), connection = { kind: "pglite", dataDir: path.join(temp, "database") };
  let app, providers, base = "", cookie = "", approve;
  async function startRuntime() {
    providers = createPostgresProviders(connection);
    app = createApp({ providers, structuredClassifier: null, adminAuthRequired: true });
    const running = await app.start(0, "127.0.0.1"); base = running.url;
    if (!cookie) { const login = await request(`${base}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId: "platform_review", username: "platform_reviewer", password: "platform-review-password-123" }) }); cookie = login.response.headers.get("set-cookie").split(";")[0]; }
    approve = (id, body) => request(`${base}/api/admin/onboarding/applications/${id}/approve`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  async function stopRuntime() { if (app) { await app.stop(); app = null; } if (providers) { await providers.close(); providers = null; } }
  try {
    await migratePostgres(connection); await seedPostgres(connection);
    let db = await openPostgres(connection);
    try {
      await db.query("INSERT INTO properties(property_id,display_name) VALUES('platform_review','Platform Review'),('other_property','Other Property')");
      await db.query("INSERT INTO property_settings(property_id,settings) VALUES('platform_review','{}'::jsonb),('other_property','{}'::jsonb)");
      const settings = { currency: "TWD", commonAnswers: { parking: "既有停車說明", preserve: "保留內容" }, contactLink: "https://lin.ee/keep-contact-link", businessProfile: { contactName: "既有聯絡人", phone: "0900000000", email: "old@example.test", address: "既有地址", checkInTime: "15:00", checkOutTime: "10:00", line: { hasOfficialAccount: true, channelId: "KEEP_CHANNEL", contactLink: "https://lin.ee/keep-contact-link" } }, onboarding: { isReady: true, sourceApplicationId: "old_source" }, pricing: { preserve: "pricing" }, humanHandoffSituations: ["keep_handoff"] };
      await db.query("UPDATE property_settings SET settings=$2::jsonb WHERE property_id=$1", ["nephi_home", JSON.stringify(settings)]);
      for (const [roomId, prices] of Object.entries({ room301: [1500, 1700, 1900, 1600], room302: [2200, 2400, 2800, 2300], room401: [1700, 1900, 2200, 1800], room402: [2600, 2900, 3300, 2700] })) await db.query("UPDATE room_types SET monday_thursday_price=$3,friday_price=$4,saturday_holiday_price=$5,sunday_price=$6 WHERE property_id=$1 AND room_id=$2", ["nephi_home", roomId, ...prices]);
      await db.query("UPDATE bundle_offers SET base_price=12500,monday_thursday_price=13000,friday_price=14500,saturday_holiday_price=18000,sunday_price=13500 WHERE property_id='nephi_home' AND bundle_id='bundle_four_room_whole_house'");
      await db.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES('nephi_home','room301','2026-08-01','available',1)");
      await db.query("INSERT INTO daily_room_notes(property_id,inventory_type,inventory_id,stay_date,note) VALUES('nephi_home','room','room301','2026-08-01','保留內部備註')");
      await db.query("INSERT INTO room_price_overrides(property_id,room_id,stay_date,price,currency) VALUES('nephi_home','room301','2026-08-01',9999,'TWD')");
      await db.query("INSERT INTO conversation_states(property_id,channel_id,line_user_id,state) VALUES('nephi_home','test-channel','U-test','{\"step\":1}'::jsonb)");
      await db.query("INSERT INTO message_logs(property_id,channel_id,event_id,review_id,line_user_id,processing_status,status,needs_review,payload) VALUES('nephi_home','test-channel','event-1','review-1','U-test','completed','pending',true,'{\"guest\":\"keep\"}'::jsonb)");
      await db.query("INSERT INTO review_queue_items(property_id,review_id,status) VALUES('nephi_home','review-1','pending')");
      await db.query("INSERT INTO event_claims(property_id,external_event_id,channel_id,review_id) VALUES('nephi_home','event-1','test-channel','review-1')");
      for (const id of ["apply_success", "apply_missing_property", "apply_wrong_target", "apply_bad_room", "apply_rollback"]) await addSubmission(db, id);
      const badBundle = submission("apply_bad_bundle").bundles;
      badBundle[0].memberRoomKeys = ["source_301", "source_302", "source_401"];
      await addSubmission(db, "apply_bad_bundle", { bundles: badBundle });
    } finally { await db.close(); }
    await upsertAdminUser(connection, { propertyId: "platform_review", username: "platform_reviewer", password: "platform-review-password-123" });
    db = await openPostgres(connection); try { await db.query("INSERT INTO platform_admin_grants(property_id,username) VALUES('platform_review','platform_reviewer')"); } finally { await db.close(); }
    await startRuntime(); await stopRuntime();
    db = await openPostgres(connection); const propertyBefore = (await db.query("SELECT count(*)::int count FROM properties")).rows[0].count, protectedBefore = await protectedSnapshot(db), settingsBefore = (await db.query("SELECT settings FROM property_settings WHERE property_id='nephi_home'")).rows[0].settings; await db.close();
    await startRuntime();

    let result = await approve("apply_success", validPayload());
    check("套用既有 nephi_home 成功", result.response.status === 200 && result.body.data.propertyId === "nephi_home" && result.body.data.approvalMode === "existing");
    check("成功回應不包含邀請或敏感值", !["adminSetupToken", "adminSetupUrl", "password", "channelId", "contactLink", "token", "secret"].some((key) => Object.hasOwn(result.body.data, key)) && result.body.data.protectedScopes.includes("admin_identity") && result.body.data.protectedScopes.includes("contactLink"));
    await stopRuntime(); db = await openPostgres(connection);
    const property = (await db.query("SELECT display_name FROM properties WHERE property_id='nephi_home'")).rows[0], settings = (await db.query("SELECT settings FROM property_settings WHERE property_id='nephi_home'")).rows[0].settings, roomRows = await rows(db, "room_types", "property_id,room_id"), bundleRows = await rows(db, "bundle_offers", "property_id,bundle_id"), approved = (await db.query("SELECT status,approval_mode,approved_property_id,approved_at,approved_by_property_id,approved_by_username FROM onboarding_applications WHERE application_id='apply_success'")).rows[0], protectedAfter = await protectedSnapshot(db), propertyAfter = (await db.query("SELECT count(*)::int count FROM properties")).rows[0].count; await db.close(); await startRuntime();
    check("不建立第二個 property", propertyAfter === propertyBefore && property.display_name === "尼腓更新名稱");
    check("保存 approved 與核准稽核欄位", approved.status === "approved" && approved.approval_mode === "existing" && approved.approved_property_id === "nephi_home" && approved.approved_at && approved.approved_by_property_id === "platform_review" && approved.approved_by_username === "platform_reviewer");
    check("非空基本資料更新且空聯絡人保留", settings.businessProfile.contactName === "既有聯絡人" && settings.businessProfile.phone === "0987654321" && settings.businessProfile.email === "new-contact@example.test" && settings.businessProfile.address === "更新地址" && settings.businessProfile.checkInTime === "16:00" && settings.businessProfile.checkOutTime === "11:00");
    check("LINE 與 contactLink 保持不變", settings.contactLink === settingsBefore.contactLink && JSON.stringify(settings.businessProfile.line) === JSON.stringify(settingsBefore.businessProfile.line));
    check("owner-confirmed facts 合併且既有 facts 保留", settings.commonAnswers.parking === "更新後停車說明" && settings.commonAnswers.new_fact === "已確認的新內容" && settings.commonAnswers.preserve === "保留內容" && !Object.hasOwn(settings.commonAnswers, "empty_fact"));
    const room301 = roomRows.find((room) => room.property_id === "nephi_home" && room.room_id === "room301"), room302 = roomRows.find((room) => room.property_id === "nephi_home" && room.room_id === "room302"), room401 = roomRows.find((room) => room.property_id === "nephi_home" && room.room_id === "room401"), bundle = bundleRows.find((item) => item.property_id === "nephi_home" && item.bundle_id === "bundle_four_room_whole_house");
    check("房型依明確 ID 更新", room301.name === "301 更新名稱" && Number(room301.monday_thursday_price) === 2100 && Number(room301.sunday_price) === 2200);
    check("0 與缺漏價格不覆蓋", Number(room302.monday_thursday_price) === 2200 && Number(room302.saturday_holiday_price) === 2800 && Number(room401.monday_thursday_price) === 1700);
    check("不完整 12 人包棟價格保留", bundle.name === "12 人包棟" && Number(bundle.base_price) === 12500 && Number(bundle.monday_thursday_price) === 13000 && Number(bundle.saturday_holiday_price) === 18000);
    check("營運與帳號敏感資料全部不變", JSON.stringify(protectedAfter) === JSON.stringify(protectedBefore));
    result = await approve("apply_success", validPayload()); check("重複核准回 409", result.response.status === 409 && result.body.error.code === "APPLICATION_ALREADY_REVIEWED");
    result = await approve("apply_missing_property", { ...validPayload(), propertyId: "missing_property", confirmPropertyId: "missing_property" }); check("property 不存在回 404", result.response.status === 404 && result.body.error.code === "PROPERTY_NOT_FOUND");
    result = await approve("apply_wrong_target", { ...validPayload(), propertyId: "other_property", confirmPropertyId: "other_property" }); check("通用 target 仍依正式 mapping 安全拒絕", result.response.status === 409 && result.body.error.code === "ROOM_MAPPING_INVALID");
    result = await approve("apply_bad_room", { ...validPayload(), confirmPropertyId: "nephi_home_typo" }); check("target propertyId 二次確認不符時拒絕", result.response.status === 400 && result.body.error.code === "PROPERTY_CONFIRMATION_MISMATCH");
    result = await approve("apply_bad_room", { ...validPayload(), roomMappings: validPayload().roomMappings.slice(0, 3) }); check("房型無法安全對應時拒絕", result.response.status === 409 && result.body.error.code === "ROOM_MAPPING_INVALID");
    result = await approve("apply_bad_bundle", validPayload()); check("bundle 成員映射不一致時拒絕", result.response.status === 409 && result.body.error.code === "BUNDLE_MAPPING_INVALID");
    const rollbackPropertyBefore = providers.customerSettings.getProperty("nephi_home"); await stopRuntime(); db = await openPostgres(connection); const rollbackProtectedBefore = await protectedSnapshot(db); await db.query("ALTER TABLE onboarding_applications ADD CONSTRAINT onboarding_existing_apply_rollback_test CHECK (application_id <> 'apply_rollback' OR approved_by_username IS NULL OR approved_by_username <> 'platform_reviewer')"); await db.close(); await startRuntime();
    result = await approve("apply_rollback", validPayload()); check("transaction 中途失敗回 500", result.response.status === 500);
    const rollbackPropertyAfter = providers.customerSettings.getProperty("nephi_home"); await stopRuntime(); db = await openPostgres(connection); const rollbackProtectedAfter = await protectedSnapshot(db), rollbackApplication = (await db.query("SELECT status,approved_property_id FROM onboarding_applications WHERE application_id='apply_rollback'")).rows[0]; await db.query("ALTER TABLE onboarding_applications DROP CONSTRAINT onboarding_existing_apply_rollback_test"); await db.close();
    check("transaction 中途失敗完整 rollback", JSON.stringify(rollbackPropertyAfter) === JSON.stringify(rollbackPropertyBefore) && JSON.stringify(rollbackProtectedAfter) === JSON.stringify(rollbackProtectedBefore) && rollbackApplication.status === "submitted" && !rollbackApplication.approved_property_id); await startRuntime();
    result = await request(`${base}/api/admin/onboarding/properties`, { headers: { cookie } }); const authorizedTargets = result.body.data.items, nephiTarget = authorizedTargets.find((item) => item.propertyId === "nephi_home"); check("後端依 platform 授權列出通用 target 與穩定 inventory ID", result.response.status === 200 && authorizedTargets.some((item) => item.propertyId === "platform_review") && authorizedTargets.some((item) => item.propertyId === "other_property") && nephiTarget.rooms.some((room) => room.id === "room301") && nephiTarget.bundles.some((item) => item.id === "bundle_four_room_whole_house"));
    check("property 清單不洩漏敏感資料", !JSON.stringify(result.body).match(/password|identity|session|grant|channelId|contactLink|secret|token/i));
    const asset = await request(`${base}/assets/admin-onboarding.js`); check("前端有 mapping、二次確認、保護警告與獨立完成結果", asset.response.status === 200 && String(asset.body).includes("roomMappings") && String(asset.body).includes("bundleMappings") && String(asset.body).includes("confirmPropertyId") && String(asset.body).includes("不會修改") && String(asset.body).includes("showApprovalCompletion"));
    console.log(`${checks.length}/${checks.length} PASS`);
  } finally { await stopRuntime(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
