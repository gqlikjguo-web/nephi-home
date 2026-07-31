"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const crypto = require("node:crypto");
const { openPostgres } = require("./postgres-client");
const { normalizeEntertainmentAmenities } = require("../bundle-entertainment");
let client;
const ADMIN_INVITATION_EMAIL_SQL = "COALESCE(NULLIF(trim(i.email),''),NULLIF(trim(s.settings #>> '{businessProfile,email}'),''))";

function payload(row) { return row ? (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) : null; }
function dataValue(row) { return row ? (typeof row.data === "string" ? JSON.parse(row.data) : row.data) : null; }
function iso(value) { return value ? new Date(value).toISOString() : new Date().toISOString(); }
function sqlDate(value) { return value ? (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)) : ""; }
function lineBindingRow(row) {
  return row ? {
    propertyId: row.property_id,
    webhookKey: row.webhook_key,
    channelSecretEncrypted: payload({ payload: row.channel_secret_encrypted }),
    channelAccessTokenEncrypted: payload({ payload: row.channel_access_token_encrypted }),
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastWebhookObservedAt: row.last_webhook_observed_at || null,
    lastValidWebhookAt: row.last_valid_webhook_at || null
  } : null;
}
function lineSetupRow(row) {
  return row ? {
    setupId: row.setup_id,
    tokenHash: row.token_hash,
    propertyId: row.property_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at || null,
    usedAt: row.used_at || null,
    createdByPropertyId: row.created_by_property_id,
    createdByUsername: row.created_by_username,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } : null;
}
function customReplyRow(row) {
  return row ? {
    ruleId: row.rule_id,
    propertyId: row.property_id,
    name: row.name,
    topic: row.topic,
    scope: row.scope,
    roomTypeId: row.room_type_id || "",
    stayStartDate: sqlDate(row.stay_start_date),
    stayEndDate: sqlDate(row.stay_end_date),
    effectiveStartDate: sqlDate(row.effective_start_date),
    effectiveEndDate: sqlDate(row.effective_end_date),
    approvedReply: row.approved_reply,
    enabled: Boolean(row.enabled),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  } : null;
}
async function loadOnboarding(id){const a=await client.query("SELECT * FROM onboarding_applications WHERE application_id=$1",[id]);if(!a.rows[0])return null;const row=a.rows[0],core=typeof row.core_data==="string"?JSON.parse(row.core_data):row.core_data||{};const rooms=await client.query("SELECT data FROM onboarding_room_types WHERE application_id=$1 ORDER BY position",[id]),bundles=await client.query("SELECT data FROM onboarding_bundle_offers WHERE application_id=$1 ORDER BY position",[id]),knowledge=await client.query("SELECT data FROM onboarding_knowledge_items WHERE application_id=$1 ORDER BY position",[id]),attachments=await client.query("SELECT attachment_id,file_name,content_type,byte_size,sha256,review_status,created_at FROM onboarding_attachments WHERE application_id=$1 ORDER BY created_at",[id]),notes=await client.query("SELECT action,note,reviewer_property_id,reviewer_username,created_at FROM onboarding_review_notes WHERE application_id=$1 ORDER BY created_at",[id]);return{...core,applicationId:id,status:row.status,propertyIdSuggestion:row.property_id_suggestion,inviteExpiresAt:iso(row.invite_expires_at),inviteRevoked:Boolean(row.invite_revoked_at),approvalMode:row.approval_mode||"",approvedPropertyId:row.approved_property_id||"",approvedAt:row.approved_at?iso(row.approved_at):"",approvedBy:row.approved_by_property_id||row.approved_by_username?{propertyId:row.approved_by_property_id||"",username:row.approved_by_username||""}:null,submittedAt:iso(row.submitted_at),updatedAt:iso(row.updated_at),rooms:rooms.rows.map(dataValue),bundles:bundles.rows.map(dataValue),knowledge:knowledge.rows.map(dataValue),attachments:attachments.rows.map(x=>({attachmentId:x.attachment_id,fileName:x.file_name,contentType:x.content_type,byteSize:x.byte_size,sha256:x.sha256,reviewStatus:x.review_status,createdAt:iso(x.created_at)})),reviewNotes:notes.rows.map(x=>({action:x.action,note:x.note,reviewerPropertyId:x.reviewer_property_id||"",reviewerUsername:x.reviewer_username||"",createdAt:iso(x.created_at)}))};}
function onboardingSnapshot(app){return{propertyName:String(app.propertyName||""),contactName:String(app.contactName||""),phone:String(app.phone||""),email:String(app.email||""),address:String(app.address||""),googleMapsUrl:String(app.googleMapsUrl||""),checkInTime:String(app.checkInTime||""),checkOutTime:String(app.checkOutTime||""),line:{hasOfficialAccount:Boolean(app.line&&app.line.hasOfficialAccount),contactLink:String(app.line&&app.line.contactLink||"")},propertyIdSuggestion:String(app.propertyIdSuggestion||""),rooms:(app.rooms||[]).map(x=>({key:String(x.key||""),roomCode:String(x.roomCode||"").trim(),displayName:String(x.displayName||x.name||"").trim(),name:String(x.displayName||x.name||"").trim(),highlights:Array.isArray(x.highlights)?x.highlights.map(v=>String(v||"").trim()).filter(Boolean):[],type:String(x.type||""),capacity:Number.isFinite(Number(x.capacity))?Number(x.capacity):null,mondayThursdayPrice:Number.isFinite(Number(x.mondayThursdayPrice))?Number(x.mondayThursdayPrice):null,fridayPrice:Number.isFinite(Number(x.fridayPrice))?Number(x.fridayPrice):null,saturdayHolidayPrice:Number.isFinite(Number(x.saturdayHolidayPrice))?Number(x.saturdayHolidayPrice):null,sundayPrice:Number.isFinite(Number(x.sundayPrice))?Number(x.sundayPrice):null,enabled:x.enabled!==false})),bundles:(app.bundles||[]).map(x=>({key:String(x.key||""),name:String(x.name||""),memberRoomKeys:(x.memberRoomKeys||[]).map(String),capacity:Number.isFinite(Number(x.capacity))?Number(x.capacity):null,mondayThursdayPrice:Number.isFinite(Number(x.mondayThursdayPrice))?Number(x.mondayThursdayPrice):null,fridayPrice:Number.isFinite(Number(x.fridayPrice))?Number(x.fridayPrice):null,saturdayHolidayPrice:Number.isFinite(Number(x.saturdayHolidayPrice))?Number(x.saturdayHolidayPrice):null,sundayPrice:Number.isFinite(Number(x.sundayPrice))?Number(x.sundayPrice):null,enabled:x.enabled!==false,entertainmentAmenities:normalizeEntertainmentAmenities(x.entertainmentAmenities)})),knowledge:(app.knowledge||[]).map(x=>({key:String(x.key||""),label:String(x.label||""),status:String(x.status||"undecided"),answer:String(x.answer||"")}))};}
async function addChangeRequestState(app){if(!app)return app;const result=await client.query("SELECT n.note,n.created_at,d.status FROM onboarding_review_notes n LEFT JOIN onboarding_email_deliveries d ON d.review_note_id=n.note_id WHERE n.application_id=$1 AND n.action IN ('changes_requested','reopened_changes_requested') ORDER BY n.created_at DESC LIMIT 1",[app.applicationId]);const row=result.rows[0];return{...app,latestChangeRequest:row?{reason:row.note,createdAt:iso(row.created_at)}:null,emailDelivery:row?{status:row.status||"pending"}:null};}
async function loadOnboardingForReview(id){const row=await client.query("SELECT status,submitted_snapshot,approval_mode,approved_property_id,approved_at,approved_by_property_id,approved_by_username,submitted_at,updated_at FROM onboarding_applications WHERE application_id=$1",[id]);if(!row.rows[0])return null;const live=await loadOnboarding(id),stored=typeof row.rows[0].submitted_snapshot==="string"?JSON.parse(row.rows[0].submitted_snapshot):row.rows[0].submitted_snapshot;return addChangeRequestState({...(stored||onboardingSnapshot(live)),applicationId:id,status:row.rows[0].status,approvalMode:row.rows[0].approval_mode||"",approvedPropertyId:row.rows[0].approved_property_id||"",approvedAt:row.rows[0].approved_at?iso(row.rows[0].approved_at):"",approvedBy:row.rows[0].approved_by_property_id||row.rows[0].approved_by_username?{propertyId:row.rows[0].approved_by_property_id||"",username:row.rows[0].approved_by_username||""}:null,submittedAt:iso(row.rows[0].submitted_at),updatedAt:iso(row.rows[0].updated_at),reviewNotes:live.reviewNotes||[]});}
async function adminMemberships(userId){const r=await client.query("SELECT m.property_id,m.username,p.display_name FROM admin_user_properties m JOIN properties p ON p.property_id=m.property_id WHERE m.user_id=$1 ORDER BY p.display_name,m.property_id",[userId]);return r.rows.map(x=>({propertyId:x.property_id,username:x.username,propertyName:x.display_name}));}
async function loadAdminIdentity(email){const normalizedEmail=String(email||"").trim().toLowerCase(),r=await client.query("SELECT user_id,email,password_hash FROM admin_identities WHERE normalized_email=$1",[normalizedEmail]);if(!r.rows[0])return null;const row=r.rows[0],properties=await adminMemberships(row.user_id),grant=await client.query("SELECT 1 FROM platform_admin_grants g JOIN admin_user_properties m ON m.property_id=g.property_id AND m.username=g.username WHERE m.user_id=$1 LIMIT 1",[row.user_id]);return{userId:row.user_id,email:row.email,passwordHash:row.password_hash,properties,platformAdmin:Boolean(grant.rows.length)};}
async function loadAdminSession(tokenHash){const r=await client.query("SELECT token_hash,user_id,property_id,username,expires_at FROM admin_sessions WHERE token_hash=$1 AND expires_at>now()",[tokenHash]);if(!r.rows[0])return null;const row=r.rows[0];if(!row.user_id){const membership=await client.query("SELECT u.property_id,u.username,p.display_name FROM admin_users u JOIN properties p ON p.property_id=u.property_id WHERE u.property_id=$1 AND u.username=$2",[row.property_id,row.username]);if(!membership.rows[0])return null;const property=membership.rows[0],grant=await client.query("SELECT 1 FROM platform_admin_grants WHERE property_id=$1 AND username=$2",[property.property_id,property.username]);return{propertyId:property.property_id,username:property.username,properties:[{propertyId:property.property_id,username:property.username,propertyName:property.display_name}],requiresPropertySelection:false,platformAdmin:Boolean(grant.rows.length),expiresAt:new Date(row.expires_at).toISOString()};}const identity=await client.query("SELECT email FROM admin_identities WHERE user_id=$1",[row.user_id]);if(!identity.rows[0])return null;const properties=await adminMemberships(row.user_id),grant=await client.query("SELECT 1 FROM platform_admin_grants g JOIN admin_user_properties m ON m.property_id=g.property_id AND m.username=g.username WHERE m.user_id=$1 LIMIT 1",[row.user_id]);return{userId:row.user_id,email:identity.rows[0].email,propertyId:row.property_id||"",username:row.username||"",properties,requiresPropertySelection:!row.property_id&&properties.length>1,platformAdmin:Boolean(grant.rows.length),expiresAt:new Date(row.expires_at).toISOString()};}

async function operation(name, args) {
  if (name === "ready") return true;
  if(name==="customReplies_list"){
    const r=await client.query("SELECT * FROM property_custom_replies WHERE property_id=$1 ORDER BY created_at,rule_id",[args[0]]);
    return r.rows.map(customReplyRow);
  }
  if(name==="customReplies_create"){
    const x=args[0],r=await client.query("INSERT INTO property_custom_replies(rule_id,property_id,name,topic,scope,room_type_id,stay_start_date,stay_end_date,effective_start_date,effective_end_date,approved_reply,enabled,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *",[x.ruleId,x.propertyId,x.name,x.topic,x.scope,x.roomTypeId||null,x.stayStartDate||null,x.stayEndDate||null,x.effectiveStartDate,x.effectiveEndDate,x.approvedReply,Boolean(x.enabled),x.createdAt,x.updatedAt]);
    return customReplyRow(r.rows[0]);
  }
  if(name==="customReplies_update"){
    const [propertyId,ruleId,x]=args,r=await client.query("UPDATE property_custom_replies SET name=$3,topic=$4,scope=$5,room_type_id=$6,stay_start_date=$7,stay_end_date=$8,effective_start_date=$9,effective_end_date=$10,approved_reply=$11,enabled=$12,updated_at=$13 WHERE property_id=$1 AND rule_id=$2 RETURNING *",[propertyId,ruleId,x.name,x.topic,x.scope,x.roomTypeId||null,x.stayStartDate||null,x.stayEndDate||null,x.effectiveStartDate,x.effectiveEndDate,x.approvedReply,Boolean(x.enabled),x.updatedAt]);
    return customReplyRow(r.rows[0]);
  }
  if(name==="customReplies_remove"){
    const r=await client.query("DELETE FROM property_custom_replies WHERE property_id=$1 AND rule_id=$2 RETURNING rule_id",args);
    return Boolean(r.rows.length);
  }
  if (name === "getProperty" || name === "listProperties") {
    const filter = name === "getProperty" ? "WHERE p.property_id=$1" : "";
    const result = await client.query(`SELECT p.property_id,p.display_name,s.settings,
      COALESCE((SELECT json_agg(json_build_object('id',r.room_id,'roomCode',r.room_code,'displayName',COALESCE(NULLIF(r.display_name,''),r.name),'name',COALESCE(NULLIF(r.display_name,''),r.name),'capacity',r.capacity,'highlights',r.highlights,'type',r.type,'description',r.description,'mondayThursdayPrice',r.monday_thursday_price,'fridayPrice',r.friday_price,'saturdayHolidayPrice',r.saturday_holiday_price,'sundayPrice',r.sunday_price,'enabled',r.enabled) ORDER BY r.position) FROM room_types r WHERE r.property_id=p.property_id AND r.enabled=true),'[]') rooms,
      COALESCE((SELECT json_agg(json_build_object('knowledgeId',k.knowledge_id,'question',k.question,'answer',k.answer,'knowledgeKey',k.knowledge_key) ORDER BY k.position) FROM knowledge_items k WHERE k.property_id=p.property_id),'[]') faqs
      FROM properties p LEFT JOIN property_settings s ON s.property_id=p.property_id ${filter} ORDER BY p.property_id`, name === "getProperty" ? [args[0]] : []);
    const mapped = result.rows.map((row) => {
      const settings = typeof row.settings === "string" ? JSON.parse(row.settings) : (row.settings || {});
      return { propertyId: row.property_id, displayName: row.display_name, currency:settings.currency||"TWD", rooms: row.rooms || [], commonAnswers: settings.commonAnswers || {}, propertyFacts: settings.propertyFacts || [], pricing: settings.pricing || {}, faqs: row.faqs || [], humanHandoffSituations: settings.humanHandoffSituations || [], businessProfile:settings.businessProfile||{}, contactLink: settings.contactLink || settings.businessProfile&&settings.businessProfile.line&&settings.businessProfile.line.contactLink || "", onboarding: settings.onboarding || { isReady: true } };
    });
    for (const item of mapped) {
      const bundles = await operation("listBundles", [item.propertyId]);
      item.rooms.push(...bundles.filter((bundle) => bundle.enabled).map((bundle) => ({ id:bundle.id,name:bundle.name,capacity:bundle.capacity,type:"包棟",description:"組合型可售方案",memberRoomIds:bundle.memberRoomIds,entertainmentAmenities:bundle.entertainmentAmenities,basePrice:bundle.basePrice,mondayThursdayPrice:bundle.mondayThursdayPrice,fridayPrice:bundle.fridayPrice,saturdayHolidayPrice:bundle.saturdayHolidayPrice,sundayPrice:bundle.sundayPrice,inventoryType:"bundle" })));
    }
    return name === "getProperty" ? (mapped[0] || null) : mapped;
  }
  if (name === "listBundles") {
    const r=await client.query("SELECT b.bundle_id,b.name,b.capacity,b.base_price,b.monday_thursday_price,b.friday_price,b.saturday_holiday_price,b.sunday_price,b.enabled,b.entertainment_amenities,COALESCE(json_agg(m.room_id ORDER BY m.position) FILTER (WHERE m.room_id IS NOT NULL),'[]') members FROM bundle_offers b LEFT JOIN bundle_offer_members m ON m.property_id=b.property_id AND m.bundle_id=b.bundle_id WHERE b.property_id=$1 GROUP BY b.bundle_id,b.name,b.capacity,b.base_price,b.monday_thursday_price,b.friday_price,b.saturday_holiday_price,b.sunday_price,b.enabled,b.entertainment_amenities ORDER BY b.bundle_id",[args[0]]);
    return r.rows.map(x=>({id:x.bundle_id,name:x.name,capacity:Number(x.capacity),basePrice:Number(x.base_price),mondayThursdayPrice:Number(x.monday_thursday_price),fridayPrice:Number(x.friday_price),saturdayHolidayPrice:Number(x.saturday_holiday_price),sundayPrice:Number(x.sunday_price),enabled:Boolean(x.enabled),memberRoomIds:x.members||[],entertainmentAmenities:normalizeEntertainmentAmenities(x.entertainment_amenities)}));
  }
  if (name === "listRoomRecords") {
    const r=await client.query("SELECT room_id,room_code,COALESCE(NULLIF(display_name,''),name) display_name,capacity,highlights,type,description,monday_thursday_price,friday_price,saturday_holiday_price,sunday_price,enabled FROM room_types WHERE property_id=$1 ORDER BY position,room_id",[args[0]]);
    return r.rows.map(x=>({id:x.room_id,roomCode:x.room_code||"",displayName:x.display_name,name:x.display_name,capacity:Number(x.capacity),highlights:Array.isArray(x.highlights)?x.highlights:[],type:x.type,description:x.description,mondayThursdayPrice:Number(x.monday_thursday_price),fridayPrice:Number(x.friday_price),saturdayHolidayPrice:Number(x.saturday_holiday_price),sundayPrice:Number(x.sunday_price),enabled:Boolean(x.enabled)}));
  }
  if (name === "createBundle" || name === "updateBundle") {
    const propertyId=args[0], input=name==="createBundle"?args[1]:args[2], bundleId=name==="createBundle"?`bundle_${crypto.randomUUID()}`:args[1];
    if(name==="updateBundle"){const used=await client.query("SELECT 1 FROM bundle_availability_days WHERE property_id=$1 AND bundle_id=$2 LIMIT 1",[propertyId,bundleId]);if(used.rows.length)throw new Error("bundle already used");}
    const members=[...new Set((input.memberRoomIds||[]).map(String))],amenities=normalizeEntertainmentAmenities(input.entertainmentAmenities),legacy=Number(input.basePrice),prices={};for(const key of ["mondayThursdayPrice","fridayPrice","saturdayHolidayPrice","sundayPrice"]){const raw=input[key]===undefined||input[key]===null||input[key]===""?legacy:Number(input[key]);if(!Number.isInteger(raw)||raw<0)throw new Error("invalid bundle price");prices[key]=raw;} if(!input.name||!members.length||!Number.isInteger(Number(input.capacity))||Number(input.capacity)<1)throw new Error("invalid bundle");
    const rooms=await client.query("SELECT room_id FROM room_types WHERE property_id=$1 AND room_id=ANY($2::text[])",[propertyId,members]);if(rooms.rows.length!==members.length)throw new Error("invalid bundle member");
    await client.query("BEGIN");try{if(name==="createBundle")await client.query("INSERT INTO bundle_offers(property_id,bundle_id,name,capacity,base_price,monday_thursday_price,friday_price,saturday_holiday_price,sunday_price,enabled,entertainment_amenities) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)",[propertyId,bundleId,input.name,Number(input.capacity),prices.mondayThursdayPrice,prices.mondayThursdayPrice,prices.fridayPrice,prices.saturdayHolidayPrice,prices.sundayPrice,input.enabled!==false,JSON.stringify(amenities)]);else await client.query("UPDATE bundle_offers SET name=$3,capacity=$4,base_price=$5,monday_thursday_price=$6,friday_price=$7,saturday_holiday_price=$8,sunday_price=$9,enabled=$10,entertainment_amenities=$11::jsonb,updated_at=now() WHERE property_id=$1 AND bundle_id=$2",[propertyId,bundleId,input.name,Number(input.capacity),prices.mondayThursdayPrice,prices.mondayThursdayPrice,prices.fridayPrice,prices.saturdayHolidayPrice,prices.sundayPrice,input.enabled!==false,JSON.stringify(amenities)]);await client.query("DELETE FROM bundle_offer_members WHERE property_id=$1 AND bundle_id=$2",[propertyId,bundleId]);for(let i=0;i<members.length;i++)await client.query("INSERT INTO bundle_offer_members(property_id,bundle_id,room_id,position) VALUES($1,$2,$3,$4)",[propertyId,bundleId,members[i],i]);await client.query("COMMIT");}catch(e){await client.query("ROLLBACK");throw e;}return (await operation("listBundles",[propertyId])).find(x=>x.id===bundleId)||null;
  }
  if (name === "deleteBundle") { const used=await client.query("SELECT 1 FROM bundle_availability_days WHERE property_id=$1 AND bundle_id=$2 UNION ALL SELECT 1 FROM daily_room_notes WHERE property_id=$1 AND inventory_type='bundle' AND inventory_id=$2 LIMIT 1",args);if(used.rows.length)throw new Error("bundle already used");const r=await client.query("DELETE FROM bundle_offers WHERE property_id=$1 AND bundle_id=$2 RETURNING bundle_id",args);return Boolean(r.rows.length); }
  if(name==="updateRoomPricing"){const [propertyId,roomId,input]=args;const r=await client.query("UPDATE room_types SET monday_thursday_price=$3,friday_price=$4,saturday_holiday_price=$5,sunday_price=$6 WHERE property_id=$1 AND room_id=$2 RETURNING room_id",[propertyId,roomId,input.mondayThursdayPrice,input.fridayPrice,input.saturdayHolidayPrice,input.sundayPrice]);if(!r.rows.length)throw new Error("room not found");return operation("getProperty",[propertyId]);}
  if(name==="updateRoomPricingBatch"){
    const [propertyId,items]=args,ids=items.map((item)=>item.roomTypeId);
    await client.query("BEGIN");
    try{
      const locked=await client.query("SELECT room_id FROM room_types WHERE property_id=$1 AND room_id=ANY($2::text[]) FOR UPDATE",[propertyId,ids]);
      if(locked.rows.length!==ids.length)throw new Error("room not found");
      for(const item of items)await client.query("UPDATE room_types SET monday_thursday_price=$3,friday_price=$4,saturday_holiday_price=$5,sunday_price=$6,room_code=COALESCE($7,room_code),display_name=COALESCE(NULLIF($8,''),display_name),name=COALESCE(NULLIF($8,''),name),capacity=COALESCE($9,capacity),highlights=COALESCE($10::jsonb,highlights),enabled=COALESCE($11,enabled) WHERE property_id=$1 AND room_id=$2",[propertyId,item.roomTypeId,item.mondayThursdayPrice,item.fridayPrice,item.saturdayHolidayPrice,item.sundayPrice,item.roomCode===undefined?null:item.roomCode,item.displayName===undefined?null:item.displayName,item.capacity===undefined?null:item.capacity,item.highlights===undefined?null:JSON.stringify(item.highlights),item.enabled===undefined?null:item.enabled]);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}
    return operation("getProperty",[propertyId]);
  }
  if(name==="setRoomPriceOverride"){const [propertyId,roomId,date,price,currency]=args;await client.query("INSERT INTO room_price_overrides(property_id,room_id,stay_date,price,currency) VALUES($1,$2,$3,$4,$5) ON CONFLICT(property_id,room_id,stay_date) DO UPDATE SET price=excluded.price,currency=excluded.currency,updated_at=now()",[propertyId,roomId,date,price,currency]);return{propertyId,roomId,date,price,currency};}
  if(name==="listRoomPriceOverrides"){const r=await client.query("SELECT room_id,stay_date::text date,price,currency FROM room_price_overrides WHERE property_id=$1 ORDER BY stay_date,room_id",[args[0]]);return r.rows.map(x=>({roomId:x.room_id,date:x.date.slice(0,10),price:Number(x.price),currency:x.currency}));}
  if (name === "getRows") {
    const [propertyId, from, to] = args;
    const normalized = await client.query("SELECT stay_date::text date,inventory_id,status FROM inventory_availability_days WHERE property_id=$1 AND ($2::date IS NULL OR stay_date >= $2::date) AND ($3::date IS NULL OR stay_date < $3::date) ORDER BY stay_date,inventory_id",[propertyId,from||null,to||null]);
    const legacy = await client.query("SELECT stay_date::text date,to_jsonb(a)-'property_id'-'stay_date' inventory FROM availability_days a WHERE property_id=$1 AND ($2::date IS NULL OR stay_date >= $2::date) AND ($3::date IS NULL OR stay_date < $3::date) ORDER BY stay_date",[propertyId,from||null,to||null]);
    const roomRecords=await client.query("SELECT room_id FROM room_types WHERE property_id=$1",[propertyId]),roomIds=new Set(roomRecords.rows.map(row=>row.room_id)),by={},legacyDates=new Set();
    for(const item of legacy.rows){const date=item.date.slice(0,10),inventory=typeof item.inventory==="string"?JSON.parse(item.inventory):item.inventory||{};by[date]=by[date]||{date};legacyDates.add(date);for(const [inventoryId,status] of Object.entries(inventory))if(roomIds.has(inventoryId)&&["available","closed"].includes(status))by[date][inventoryId]=status;}
    for(const item of normalized.rows){const date=item.date.slice(0,10);by[date]=by[date]||{date};by[date][item.inventory_id]=item.status;}
    const bundleAvailability=await client.query("SELECT bundle_id,stay_date::text date,status FROM bundle_availability_days WHERE property_id=$1 AND ($2::date IS NULL OR stay_date >= $2::date) AND ($3::date IS NULL OR stay_date < $3::date)",[propertyId,from||null,to||null]),bundleStatus=new Map(bundleAvailability.rows.map(item=>[`${item.date.slice(0,10)}\u0000${item.bundle_id}`,item.status])),bundles=await operation("listBundles",[propertyId]);
    for(const row of Object.values(by))for(const bundle of bundles){const own=row[bundle.id]||bundleStatus.get(`${row.date}\u0000${bundle.id}`)||(legacyDates.has(row.date)?"available":"closed");row[bundle.id]=bundle.enabled&&bundle.memberRoomIds.length>0&&own==="available"&&bundle.memberRoomIds.every(id=>row[id]==="available")?"available":"closed";}
    return Object.values(by).sort((left,right)=>left.date.localeCompare(right.date));
  }
  if (name === "getDayNotes") {
    const [propertyId,from,to]=args;
    const result=await client.query("SELECT property_id,inventory_type,inventory_id,stay_date::text date,note,created_at,updated_at FROM daily_room_notes WHERE property_id=$1 AND ($2::date IS NULL OR stay_date >= $2::date) AND ($3::date IS NULL OR stay_date < $3::date) ORDER BY stay_date,inventory_type,inventory_id",[propertyId,from||null,to||null]);
    return result.rows.map((row)=>({propertyId:row.property_id,inventoryType:row.inventory_type,inventoryId:row.inventory_id,date:row.date.slice(0,10),note:row.note,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)}));
  }
  if (name === "setDayNote") {
    const [propertyId,inventoryType,inventoryId,date,value]=args,note=String(value||"").trim();
    if(!["room","bundle"].includes(inventoryType))throw new Error("invalid inventory type");
    const table=inventoryType==="bundle"?"bundle_offers":"room_types",column=inventoryType==="bundle"?"bundle_id":"room_id";
    const exists=await client.query(`SELECT 1 FROM ${table} WHERE property_id=$1 AND ${column}=$2`,[propertyId,inventoryId]);
    if(!exists.rows.length)throw new Error("inventory not found");
    if(!note){await client.query("DELETE FROM daily_room_notes WHERE property_id=$1 AND inventory_type=$2 AND inventory_id=$3 AND stay_date=$4",[propertyId,inventoryType,inventoryId,date]);return null;}
    const result=await client.query("INSERT INTO daily_room_notes(property_id,inventory_type,inventory_id,stay_date,note) VALUES($1,$2,$3,$4,$5) ON CONFLICT(property_id,inventory_type,inventory_id,stay_date) DO UPDATE SET note=excluded.note,updated_at=now() RETURNING property_id,inventory_type,inventory_id,stay_date::text date,note,created_at,updated_at",[propertyId,inventoryType,inventoryId,date,note]);
    const row=result.rows[0];return{propertyId:row.property_id,inventoryType:row.inventory_type,inventoryId:row.inventory_id,date:row.date.slice(0,10),note:row.note,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)};
  }
  if (name === "updateProperty") {
    const [propertyId,input]=args; const current=await operation("getProperty",[propertyId]); if(!current)return null;
    await client.query("BEGIN");
    try{
      await client.query("UPDATE properties SET display_name=$2,updated_at=now() WHERE property_id=$1",[propertyId,input.displayName]);
      await client.query("DELETE FROM room_types WHERE property_id=$1",[propertyId]);
      for(let i=0;i<(input.rooms||[]).length;i+=1){const room=input.rooms[i],displayName=String(room.displayName||room.name||"").trim();await client.query("INSERT INTO room_types(property_id,room_id,name,room_code,display_name,capacity,highlights,type,description,position) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)",[propertyId,room.id,displayName,String(room.roomCode||"").trim(),displayName,room.capacity,JSON.stringify(Array.isArray(room.highlights)?room.highlights:[]),room.type||"custom",room.description||"",i]);}
      const settings={...(current.pricing?{pricing:current.pricing}:{}),commonAnswers:input.commonAnswers||{},humanHandoffSituations:current.humanHandoffSituations||[],businessProfile:current.businessProfile||{},contactLink:current.contactLink||"",onboarding:current.onboarding||{isReady:true}};
      await client.query("UPDATE property_settings SET settings=$2::jsonb WHERE property_id=$1",[propertyId,JSON.stringify(settings)]);await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}
    return operation("getProperty",[propertyId]);
  }
  if (name === "setDay") {
    const [propertyId,date,roomId,status] = args;
    const room=await client.query("SELECT 1 FROM room_types WHERE property_id=$1 AND room_id=$2",[propertyId,roomId]),bundle=(await operation("listBundles",[propertyId])).find(item=>item.id===roomId);
    if(!room.rows.length&&!bundle)throw new Error("invalid inventory");
    const inventoryIds=bundle?[bundle.id,...bundle.memberRoomIds]:[roomId];
    for(const inventoryId of inventoryIds)await client.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) VALUES($1,$2,$3,$4,$5) ON CONFLICT(property_id,inventory_id,stay_date) DO UPDATE SET status=excluded.status,remaining=excluded.remaining,updated_at=now()",[propertyId,inventoryId,date,status,status==="available"?1:0]);
    return (await operation("getRows", [propertyId,date,new Date(Date.parse(date)+86400000).toISOString().slice(0,10)]))[0];
  }
  if (name === "updatePropertyProfile") {
    const [propertyId,input]=args,current=await operation("getProperty",[propertyId]);if(!current)return null;
    const stored=await client.query("SELECT settings FROM property_settings WHERE property_id=$1",[propertyId]);
    const existingSettings=stored.rows[0]?(typeof stored.rows[0].settings==="string"?JSON.parse(stored.rows[0].settings):stored.rows[0].settings||{}):{};
    await client.query("BEGIN");
    try { await client.query("UPDATE properties SET display_name=$2,updated_at=now() WHERE property_id=$1",[propertyId,input.displayName]);const settings={...existingSettings,commonAnswers:input.commonAnswers||current.commonAnswers||{},businessProfile:input.businessProfile||current.businessProfile||{},contactLink:input.contactLink||""};await client.query("UPDATE property_settings SET settings=$2::jsonb WHERE property_id=$1",[propertyId,JSON.stringify(settings)]);await client.query("COMMIT"); } catch(error) { await client.query("ROLLBACK");throw error; }
    return operation("getProperty",[propertyId]);
  }
  if (name === "updatePropertyFacts") {
    const [propertyId, propertyFacts] = args;
    const current = await operation("getProperty", [propertyId]);
    if (!current) return null;
    const stored = await client.query("SELECT settings FROM property_settings WHERE property_id=$1", [propertyId]);
    const settings = stored.rows[0] ? (typeof stored.rows[0].settings === "string" ? JSON.parse(stored.rows[0].settings) : stored.rows[0].settings || {}) : {};
    await client.query(
      "UPDATE property_settings SET settings=$2::jsonb WHERE property_id=$1",
      [propertyId, JSON.stringify({ ...settings, propertyFacts })]
    );
    return operation("getProperty", [propertyId]);
  }
  if(name==="createOnboarding"){await client.query("INSERT INTO onboarding_applications(application_id,draft_token_hash) VALUES($1,$2)",args);return loadOnboarding(args[0]);}
  if(name==="createOnboardingInvitation"){
    const [id,tokenHash,expiresAt,createdByPropertyId,createdByUsername]=args;
    await client.query("INSERT INTO onboarding_applications(application_id,draft_token_hash,invite_expires_at,invite_created_by_property_id,invite_created_by_username) VALUES($1,$2,$3,$4,$5)",[id,tokenHash,expiresAt,createdByPropertyId,createdByUsername]);
    return loadOnboarding(id);
  }
  if(name==="resolveOnboardingInvitation"){const r=await client.query("SELECT application_id,status,invite_expires_at FROM onboarding_applications WHERE draft_token_hash=$1 AND invite_expires_at>now() AND invite_revoked_at IS NULL",[args[0]]);return r.rows[0]?{applicationId:r.rows[0].application_id,status:r.rows[0].status,expiresAt:iso(r.rows[0].invite_expires_at)}:null;}
  if(name==="revokeOnboardingInvitation"){const r=await client.query("UPDATE onboarding_applications SET invite_revoked_at=now(),updated_at=now() WHERE application_id=$1 AND status='draft' AND invite_expires_at IS NOT NULL AND invite_revoked_at IS NULL RETURNING application_id",[args[0]]);return Boolean(r.rows.length);}
  if(name==="verifyOnboardingToken"){const r=await client.query("SELECT 1 FROM onboarding_applications a WHERE a.application_id=$1 AND ((a.draft_token_hash=$2 AND (a.invite_expires_at IS NULL OR (a.invite_expires_at>now() AND a.invite_revoked_at IS NULL))) OR EXISTS(SELECT 1 FROM onboarding_resume_tokens t WHERE t.application_id=a.application_id AND t.token_hash=$2 AND t.expires_at>now()))",args);return Boolean(r.rows.length);}
  if(name==="resolveOnboardingResumeToken"){const r=await client.query("SELECT application_id FROM onboarding_resume_tokens WHERE token_hash=$1 AND expires_at>now()",args);return r.rows[0]?{applicationId:r.rows[0].application_id}:null;}
  if(name==="rotateOnboardingResumeToken"){
    const [id,tokenHash,expiresAt]=args;await client.query("BEGIN");try{const application=await client.query("SELECT status FROM onboarding_applications WHERE application_id=$1 FOR UPDATE",[id]);if(!application.rows[0])throw new Error("application not found");if(application.rows[0].status!=="changes_requested")throw new Error("application is not awaiting changes");const note=await client.query("SELECT note_id FROM onboarding_review_notes WHERE application_id=$1 AND action IN ('changes_requested','reopened_changes_requested') ORDER BY created_at DESC LIMIT 1",[id]);if(!note.rows[0])throw new Error("change request not found");await client.query("DELETE FROM onboarding_resume_tokens WHERE application_id=$1",[id]);await client.query("INSERT INTO onboarding_resume_tokens(token_hash,application_id,review_note_id,expires_at) VALUES($1,$2,$3,$4)",[tokenHash,id,note.rows[0].note_id,expiresAt]);await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}return true;
  }
  if(name==="getOnboarding")return addChangeRequestState(await loadOnboarding(args[0]));
  if(name==="getOnboardingForReview")return loadOnboardingForReview(args[0]);
  if(name==="saveOnboarding"){
    const [id,input]=args,current=await loadOnboarding(id);if(!current||!["draft","changes_requested"].includes(current.status))throw new Error("application is not editable");
    const core={...input};delete core.rooms;delete core.bundles;delete core.knowledge;for(const k of ["secret","token","channelSecret","channelAccessToken","lineChannelSecret","lineChannelAccessToken"])delete core[k];
    await client.query("BEGIN");try{await client.query("UPDATE onboarding_applications SET core_data=$2::jsonb,property_id_suggestion=$3,updated_at=now() WHERE application_id=$1",[id,JSON.stringify(core),String(input.propertyIdSuggestion||"")]);for(const table of ["onboarding_bundle_members","onboarding_bundle_offers","onboarding_room_types","onboarding_knowledge_items"])await client.query(`DELETE FROM ${table} WHERE application_id=$1`,[id]);for(let i=0;i<(input.rooms||[]).length;i++){const x=input.rooms[i];await client.query("INSERT INTO onboarding_room_types(application_id,room_key,data,position) VALUES($1,$2,$3::jsonb,$4)",[id,x.key,JSON.stringify(x),i]);}for(let i=0;i<(input.bundles||[]).length;i++){const x=input.bundles[i];await client.query("INSERT INTO onboarding_bundle_offers(application_id,bundle_key,data,position) VALUES($1,$2,$3::jsonb,$4)",[id,x.key,JSON.stringify(x),i]);for(let j=0;j<(x.memberRoomKeys||[]).length;j++)await client.query("INSERT INTO onboarding_bundle_members(application_id,bundle_key,room_key,position) VALUES($1,$2,$3,$4)",[id,x.key,x.memberRoomKeys[j],j]);}for(let i=0;i<(input.knowledge||[]).length;i++){const x=input.knowledge[i];await client.query("INSERT INTO onboarding_knowledge_items(application_id,knowledge_key,data,position) VALUES($1,$2,$3::jsonb,$4)",[id,x.key,JSON.stringify(x),i]);}await client.query("COMMIT");}catch(e){await client.query("ROLLBACK");throw e;}return loadOnboarding(id);
  }
  if(name==="addOnboardingAttachment"){const [id,x]=args;await client.query("INSERT INTO onboarding_attachments(attachment_id,application_id,file_name,content_type,byte_size,sha256,content) VALUES($1,$2,$3,$4,$5,$6,$7)",[x.attachmentId,id,x.fileName,x.contentType,x.byteSize,x.sha256,Buffer.from(x.base64,"base64")]);return{attachmentId:x.attachmentId,fileName:x.fileName,contentType:x.contentType,byteSize:x.byteSize,sha256:x.sha256,reviewStatus:"pending_review"};}
  if(name==="submitOnboarding"){const id=args[0];await client.query("BEGIN");try{const locked=await client.query("SELECT status FROM onboarding_applications WHERE application_id=$1 FOR UPDATE",[id]);if(!locked.rows[0])throw new Error("application not found");if(["submitted","resubmitted","approved"].includes(locked.rows[0].status)){await client.query("COMMIT");return loadOnboardingForReview(id);}if(!["draft","changes_requested"].includes(locked.rows[0].status))throw new Error("application cannot be submitted");const current=await loadOnboarding(id),status=locked.rows[0].status==="changes_requested"?"resubmitted":"submitted",snapshot=onboardingSnapshot(current);await client.query("UPDATE onboarding_applications SET status=$2,submitted_snapshot=$3::jsonb,submitted_at=COALESCE(submitted_at,now()),updated_at=now() WHERE application_id=$1",[id,status,JSON.stringify(snapshot)]);if(locked.rows[0].status==="changes_requested")await client.query("DELETE FROM onboarding_resume_tokens WHERE application_id=$1",[id]);await client.query("COMMIT");return loadOnboardingForReview(id);}catch(error){await client.query("ROLLBACK");throw error;}}
  if(name==="isPlatformAdmin"){const [propertyId,username,userId]=args;if(userId){const r=await client.query("SELECT 1 FROM platform_admin_grants g JOIN admin_user_properties m ON m.property_id=g.property_id AND m.username=g.username WHERE m.user_id=$1 LIMIT 1",[userId]);return Boolean(r.rows.length);}const r=await client.query("SELECT 1 FROM platform_admin_grants WHERE property_id=$1 AND username=$2",[propertyId,username]);return Boolean(r.rows.length);}
  if(name==="listOnboarding"){const r=await client.query("SELECT application_id FROM onboarding_applications ORDER BY updated_at DESC");const out=[];for(const x of r.rows)out.push(await loadOnboardingForReview(x.application_id));return out;}
  if(name==="listOnboardingProperties"){
    const scope=args[0]&&typeof args[0]==="object"?args[0]:{},allowedPropertyIds=[...new Set((Array.isArray(scope.propertyIds)?scope.propertyIds:[]).map(value=>String(value||"")).filter(Boolean))];
    if(!scope.all&&!allowedPropertyIds.length)return[];
    const properties=scope.all
      ?await client.query("SELECT property_id,display_name FROM properties ORDER BY display_name,property_id")
      :await client.query("SELECT property_id,display_name FROM properties WHERE property_id=ANY($1::text[]) ORDER BY display_name,property_id",[allowedPropertyIds]),items=[];
    for(const property of properties.rows){
      const rooms=await client.query("SELECT room_id,name FROM room_types WHERE property_id=$1 ORDER BY position,room_id",[property.property_id]);
      const bundles=await operation("listBundles",[property.property_id]);
      items.push({propertyId:property.property_id,propertyName:property.display_name,rooms:rooms.rows.map(room=>({id:room.room_id,name:room.name})),bundles:bundles.map(bundle=>({id:bundle.id,name:bundle.name,memberRoomIds:bundle.memberRoomIds}))});
    }
    return items;
  }
  if(name==="onboardingPropertyExists"){const r=await client.query("SELECT 1 FROM properties WHERE property_id=$1",args);return Boolean(r.rows.length);}
  if(name==="getOnboardingMembershipSafety"){const propertyId=args[0],r=await client.query("SELECT count(*)::int membership_count,count(*) FILTER(WHERE u.username LIKE 'onboarding\\_%' ESCAPE '\\')::int internal_count,count(*) FILTER(WHERE u.password_hash='disabled$identity-only')::int disabled_count,count(*) FILTER(WHERE i.used_at IS NOT NULL)::int used_invitation_count FROM admin_users u JOIN admin_user_properties m USING(property_id,username) LEFT JOIN property_admin_invitations i USING(property_id,username) WHERE u.property_id=$1",[propertyId]),owner=await client.query("SELECT count(*)::int count FROM admin_users WHERE property_id=$1 AND username='owner'",[propertyId]),nephiAdmin=await client.query("SELECT count(*)::int count FROM admin_users WHERE property_id=$1 AND username='nephi_admin'",[propertyId]),grants=await client.query("SELECT count(*)::int count FROM platform_admin_grants WHERE property_id=$1",[propertyId]);return{...r.rows[0],ownerCount:owner.rows[0].count,nephiAdminCount:nephiAdmin.rows[0].count,platformGrantCount:grants.rows[0].count};}
  if(name==="reviewOnboarding"){
    const [id,status,note,propertyId,username,resumeTokenHash,resumeExpiresAt,emailConfigured]=args;
    if(!["changes_requested","rejected"].includes(status))throw new Error("invalid review status");
    let noteId,shouldNotify=false;
    await client.query("BEGIN");
    try{
      const locked=await client.query("SELECT status,submitted_snapshot FROM onboarding_applications WHERE application_id=$1 FOR UPDATE",[id]);
      if(!locked.rows[0])throw new Error("application not found");
      if(!["submitted","resubmitted"].includes(locked.rows[0].status))throw new Error("application already reviewed");
      noteId=crypto.randomUUID();
      await client.query("UPDATE onboarding_applications SET status=$2,updated_at=now() WHERE application_id=$1",[id,status]);
      await client.query("INSERT INTO onboarding_review_notes(note_id,application_id,action,note,reviewer_property_id,reviewer_username) VALUES($1,$2,$3,$4,$5,$6)",[noteId,id,status,note||"",propertyId,username]);
      if(status==="changes_requested"){
        const snapshot=typeof locked.rows[0].submitted_snapshot==="string"?JSON.parse(locked.rows[0].submitted_snapshot):locked.rows[0].submitted_snapshot||{},recipient=String(snapshot.email||"");
        await client.query("DELETE FROM onboarding_resume_tokens WHERE application_id=$1",[id]);
        await client.query("INSERT INTO onboarding_resume_tokens(token_hash,application_id,review_note_id,expires_at) VALUES($1,$2,$3,$4)",[resumeTokenHash,id,noteId,resumeExpiresAt]);
        await client.query("INSERT INTO onboarding_email_deliveries(review_note_id,application_id,recipient,status) VALUES($1,$2,$3,$4)",[noteId,id,recipient,emailConfigured?"pending":"not_configured"]);
        shouldNotify=Boolean(emailConfigured);
      }
      const application=await loadOnboardingForReview(id);
      await client.query("COMMIT");
      return{application,notification:{noteId,shouldNotify}};
    }catch(error){await client.query("ROLLBACK");throw error;}
  }
  if(name==="reopenOnboarding"){
    const [id,note,propertyId,username,resumeTokenHash,resumeExpiresAt,emailConfigured]=args;
    let noteId,shouldNotify=false;
    await client.query("BEGIN");
    try{
      const locked=await client.query("SELECT status,submitted_snapshot FROM onboarding_applications WHERE application_id=$1 FOR UPDATE",[id]);
      if(!locked.rows[0])throw new Error("application not found");
      if(locked.rows[0].status!=="rejected")throw new Error("application is not rejected");
      noteId=crypto.randomUUID();
      await client.query("DELETE FROM onboarding_resume_tokens WHERE application_id=$1",[id]);
      await client.query("UPDATE onboarding_applications SET status='changes_requested',updated_at=now() WHERE application_id=$1",[id]);
      await client.query("INSERT INTO onboarding_review_notes(note_id,application_id,action,note,reviewer_property_id,reviewer_username) VALUES($1,$2,'reopened_changes_requested',$3,$4,$5)",[noteId,id,note,propertyId,username]);
      await client.query("INSERT INTO onboarding_resume_tokens(token_hash,application_id,review_note_id,expires_at) VALUES($1,$2,$3,$4)",[resumeTokenHash,id,noteId,resumeExpiresAt]);
      const snapshot=typeof locked.rows[0].submitted_snapshot==="string"?JSON.parse(locked.rows[0].submitted_snapshot):locked.rows[0].submitted_snapshot||{},recipient=String(snapshot.email||"");
      await client.query("INSERT INTO onboarding_email_deliveries(review_note_id,application_id,recipient,status) VALUES($1,$2,$3,$4)",[noteId,id,recipient,emailConfigured?"pending":"not_configured"]);
      shouldNotify=Boolean(emailConfigured);
      const application=await loadOnboardingForReview(id);
      await client.query("COMMIT");
      return{application,notification:{noteId,shouldNotify}};
    }catch(error){await client.query("ROLLBACK");throw error;}
  }
  if(name==="claimOnboardingEmailDelivery"){const r=await client.query("UPDATE onboarding_email_deliveries SET status='sending',attempted_at=now(),updated_at=now() WHERE review_note_id=$1 AND status IN ('pending','failed','not_configured') RETURNING recipient",args);return r.rows[0]?{claimed:true,recipient:r.rows[0].recipient}:{claimed:false};}
  if(name==="completeOnboardingEmailDelivery"){const [noteId,status,providerMessageId,lastError]=args;await client.query("UPDATE onboarding_email_deliveries SET status=$2,provider_message_id=$3,last_error=$4,updated_at=now() WHERE review_note_id=$1",[noteId,status,providerMessageId||null,lastError||null]);return true;}
  if(name==="approveOnboardingExisting"){
    const [id,propertyId,roomMappings,bundleMappings,reviewerPropertyId,reviewerUsername]=args;
    await client.query("BEGIN");
    try{
      const lockedApplication=await client.query("SELECT status,submitted_snapshot FROM onboarding_applications WHERE application_id=$1 FOR UPDATE",[id]);
      if(!lockedApplication.rows[0]||!["submitted","resubmitted"].includes(lockedApplication.rows[0].status))throw new Error("application cannot be approved");
      const lockedProperty=await client.query("SELECT p.display_name,s.settings FROM properties p JOIN property_settings s ON s.property_id=p.property_id WHERE p.property_id=$1 FOR UPDATE OF p,s",[propertyId]);
      if(!lockedProperty.rows[0])throw new Error("property not found");
      const app=typeof lockedApplication.rows[0].submitted_snapshot==="string"?JSON.parse(lockedApplication.rows[0].submitted_snapshot):lockedApplication.rows[0].submitted_snapshot||{};
      const submittedRooms=Array.isArray(app.rooms)?app.rooms:[],submittedBundles=Array.isArray(app.bundles)?app.bundles:[];
      const existingRooms=await client.query("SELECT room_id,name,room_code,display_name,capacity,highlights,type,description,position,monday_thursday_price,friday_price,saturday_holiday_price,sunday_price,enabled FROM room_types WHERE property_id=$1 FOR UPDATE",[propertyId]);
      const existingBundles=await client.query("SELECT bundle_id,name,capacity,base_price,monday_thursday_price,friday_price,saturday_holiday_price,sunday_price,enabled FROM bundle_offers WHERE property_id=$1 FOR UPDATE",[propertyId]);
      const submittedRoomKeys=new Set(submittedRooms.map(room=>String(room.key||""))),targetRoomIds=new Set(existingRooms.rows.map(room=>room.room_id)),roomSourceKeys=(roomMappings||[]).map(item=>String(item.sourceKey||"")),roomTargets=(roomMappings||[]).map(item=>String(item.targetRoomId||""));
      if(roomMappings.length!==submittedRooms.length||new Set(roomSourceKeys).size!==roomSourceKeys.length||new Set(roomTargets).size!==roomTargets.length||roomSourceKeys.some(key=>!submittedRoomKeys.has(key))||roomTargets.some(roomId=>!targetRoomIds.has(roomId)))throw new Error("room mapping invalid");
      const roomMap=new Map(roomMappings.map(item=>[String(item.sourceKey),String(item.targetRoomId)]));
      if([...submittedRoomKeys].some(key=>!roomMap.has(key)))throw new Error("room mapping invalid");
      const submittedBundleKeys=new Set(submittedBundles.map(bundle=>String(bundle.key||""))),targetBundleIds=new Set(existingBundles.rows.map(bundle=>bundle.bundle_id)),bundleSourceKeys=(bundleMappings||[]).map(item=>String(item.sourceKey||"")),bundleTargets=(bundleMappings||[]).map(item=>String(item.targetBundleId||""));
      if(bundleMappings.length!==submittedBundles.length||new Set(bundleSourceKeys).size!==bundleSourceKeys.length||new Set(bundleTargets).size!==bundleTargets.length||bundleSourceKeys.some(key=>!submittedBundleKeys.has(key))||bundleTargets.some(bundleId=>!targetBundleIds.has(bundleId)))throw new Error("bundle mapping invalid");
      const bundleMap=new Map(bundleMappings.map(item=>[String(item.sourceKey),String(item.targetBundleId)]));
      if([...submittedBundleKeys].some(key=>!bundleMap.has(key)))throw new Error("bundle mapping invalid");
      for(const bundle of submittedBundles){
        const bundleId=bundleMap.get(String(bundle.key)),members=await client.query("SELECT room_id FROM bundle_offer_members WHERE property_id=$1 AND bundle_id=$2 ORDER BY room_id",[propertyId,bundleId]),mappedMembers=(bundle.memberRoomKeys||[]).map(key=>roomMap.get(String(key))).filter(Boolean).sort(),existingMembers=members.rows.map(row=>row.room_id).sort();
        if(mappedMembers.length!==(bundle.memberRoomKeys||[]).length||JSON.stringify(mappedMembers)!==JSON.stringify(existingMembers))throw new Error("bundle mapping invalid");
      }
      const present=value=>typeof value==="string"?value.trim():"",positive=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
      const propertyName=present(app.propertyName);if(propertyName)await client.query("UPDATE properties SET display_name=$2,updated_at=now() WHERE property_id=$1",[propertyId,propertyName]);
      const settings=typeof lockedProperty.rows[0].settings==="string"?JSON.parse(lockedProperty.rows[0].settings):lockedProperty.rows[0].settings||{},businessProfile={...(settings.businessProfile||{})};
      for(const key of ["contactName","phone","email","address","googleMapsUrl","checkInTime","checkOutTime"]){const value=present(app[key]);if(value)businessProfile[key]=value;}
      const commonAnswers={...(settings.commonAnswers||{})},confirmedFacts=(Array.isArray(app.knowledge)?app.knowledge:[]).filter(item=>item&&item.status==="fixed"&&present(item.answer));
      for(const fact of confirmedFacts)commonAnswers[String(fact.key)]=present(fact.answer);
      await client.query("UPDATE property_settings SET settings=$2::jsonb WHERE property_id=$1",[propertyId,JSON.stringify({...settings,businessProfile,commonAnswers})]);
      for(const room of submittedRooms){
        const roomId=roomMap.get(String(room.key)),current=existingRooms.rows.find(item=>item.room_id===roomId),displayName=present(room.displayName||room.name)||current.display_name||current.name,roomCode=Object.hasOwn(room,"roomCode")?present(room.roomCode):current.room_code,type=present(room.type)||current.type,capacity=Number.isInteger(Number(room.capacity))&&Number(room.capacity)>0?Number(room.capacity):current.capacity,highlights=Array.isArray(room.highlights)?room.highlights:current.highlights||[],enabled=typeof room.enabled==="boolean"?room.enabled:current.enabled;
        await client.query("UPDATE room_types SET name=$3,display_name=$3,room_code=$4,type=$5,capacity=$6,highlights=$7::jsonb,monday_thursday_price=$8,friday_price=$9,saturday_holiday_price=$10,sunday_price=$11,enabled=$12 WHERE property_id=$1 AND room_id=$2",[propertyId,roomId,displayName,roomCode,type,capacity,JSON.stringify(highlights),positive(room.mondayThursdayPrice)??current.monday_thursday_price,positive(room.fridayPrice)??current.friday_price,positive(room.saturdayHolidayPrice)??current.saturday_holiday_price,positive(room.sundayPrice)??current.sunday_price,enabled]);
      }
      for(const bundle of submittedBundles){
        const bundleId=bundleMap.get(String(bundle.key)),current=existingBundles.rows.find(item=>item.bundle_id===bundleId),name=present(bundle.name)||current.name,capacity=Number.isInteger(Number(bundle.capacity))&&Number(bundle.capacity)>0?Number(bundle.capacity):current.capacity,enabled=typeof bundle.enabled==="boolean"?bundle.enabled:current.enabled,submittedMonday=positive(bundle.mondayThursdayPrice),monday=submittedMonday??current.monday_thursday_price,basePrice=submittedMonday??current.base_price;
        const entertainmentAmenities=Object.hasOwn(bundle,"entertainmentAmenities")?normalizeEntertainmentAmenities(bundle.entertainmentAmenities):null;
        await client.query("UPDATE bundle_offers SET name=$3,capacity=$4,base_price=$5,monday_thursday_price=$6,friday_price=$7,saturday_holiday_price=$8,sunday_price=$9,enabled=$10,entertainment_amenities=COALESCE($11::jsonb,entertainment_amenities),updated_at=now() WHERE property_id=$1 AND bundle_id=$2",[propertyId,bundleId,name,capacity,basePrice,monday,positive(bundle.fridayPrice)??current.friday_price,positive(bundle.saturdayHolidayPrice)??current.saturday_holiday_price,positive(bundle.sundayPrice)??current.sunday_price,enabled,entertainmentAmenities===null?null:JSON.stringify(entertainmentAmenities)]);
      }
      let position=Number((await client.query("SELECT COALESCE(max(position),-1)::int position FROM knowledge_items WHERE property_id=$1",[propertyId])).rows[0].position)+1;
      for(const fact of confirmedFacts){
        const key=String(fact.key||""),matches=await client.query("SELECT knowledge_id FROM knowledge_items WHERE property_id=$1 AND knowledge_key=$2",[propertyId,key]);
        if(matches.rows.length>1)throw new Error("knowledge mapping ambiguous");
        if(matches.rows.length)await client.query("UPDATE knowledge_items SET question=$3,answer=$4 WHERE property_id=$1 AND knowledge_id=$2",[propertyId,matches.rows[0].knowledge_id,present(fact.label)||key,present(fact.answer)]);
        else{const suffix=crypto.createHash("sha256").update(key).digest("hex").slice(0,12),knowledgeId=`onboarding_${suffix}`;await client.query("INSERT INTO knowledge_items(property_id,knowledge_id,question,answer,knowledge_key,position) VALUES($1,$2,$3,$4,$5,$6)",[propertyId,knowledgeId,present(fact.label)||key,present(fact.answer),key,position++]);}
      }
      const audit=await client.query("UPDATE onboarding_applications SET status='approved',approval_mode='existing',approved_property_id=$2,approved_at=now(),approved_by_property_id=$3,approved_by_username=$4,updated_at=now() WHERE application_id=$1 RETURNING approved_at",[id,propertyId,reviewerPropertyId,reviewerUsername]);
      await client.query("INSERT INTO onboarding_review_notes(note_id,application_id,action,note,reviewer_property_id,reviewer_username) VALUES($1,$2,'approved','existing property apply',$3,$4)",[crypto.randomUUID(),id,reviewerPropertyId,reviewerUsername]);
      await client.query("COMMIT");
      return{propertyId,approvalMode:"existing",approvedAt:iso(audit.rows[0].approved_at),approvedBy:{propertyId:reviewerPropertyId,username:reviewerUsername}};
    }catch(error){await client.query("ROLLBACK");throw error;}
  }
  if(name==="approveOnboardingV2"){
    const [id,propertyId,adminUsername,inviteHash,expiresAt,reviewerPropertyId,reviewerUsername]=args;
    await client.query("BEGIN");
    try{
      const locked=await client.query("SELECT status FROM onboarding_applications WHERE application_id=$1 FOR UPDATE",[id]);
      if(!locked.rows[0]||!["submitted","resubmitted"].includes(locked.rows[0].status))throw new Error("application cannot be approved");
      if((await client.query("SELECT 1 FROM properties WHERE property_id=$1",[propertyId])).rows.length)throw new Error("propertyId already exists");
      const app=await loadOnboardingForReview(id);
      await client.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)",[propertyId,app.propertyName]);
      const fixed=Object.fromEntries((app.knowledge||[]).filter(x=>x.status==="fixed").map(x=>[x.key,x.answer]));
      const handoff=(app.knowledge||[]).filter(x=>x.status==="human_handoff").map(x=>x.key);
      const settings={currency:"TWD",commonAnswers:fixed,contactLink:app.line&&app.line.contactLink||"",humanHandoffSituations:handoff,businessProfile:{contactName:app.contactName||"",phone:app.phone||"",email:app.email||"",address:app.address||"",googleMapsUrl:app.googleMapsUrl||"",checkInTime:app.checkInTime||"",checkOutTime:app.checkOutTime||"",line:{hasOfficialAccount:Boolean(app.line&&app.line.hasOfficialAccount),channelId:app.line&&app.line.channelId||"",contactLink:app.line&&app.line.contactLink||""}},onboarding:{isReady:true,sourceApplicationId:id},pricing:{}};
      await client.query("INSERT INTO property_settings(property_id,settings) VALUES($1,$2::jsonb)",[propertyId,JSON.stringify(settings)]);
      const roomMap={};
      for(let i=0;i<app.rooms.length;i++){
        const x=app.rooms[i],roomId=`room_${String(x.key).replace(/[^a-zA-Z0-9_-]/g,"")}`;roomMap[x.key]=roomId;
        const displayName=String(x.displayName||x.name||"").trim();
        await client.query("INSERT INTO room_types(property_id,room_id,name,room_code,display_name,capacity,highlights,type,description,position,base_price,weekday_price,friday_price,saturday_price,monday_thursday_price,saturday_holiday_price,sunday_price,enabled) VALUES($1,$2,$3,$4,$3,$5,$6::jsonb,$7,'',$8,0,0,$9,0,$10,$11,$12,$13)",[propertyId,roomId,displayName,String(x.roomCode||"").trim(),x.capacity,JSON.stringify(Array.isArray(x.highlights)?x.highlights:[]),x.type||"custom",i,x.fridayPrice||0,x.mondayThursdayPrice||0,x.saturdayHolidayPrice||0,x.sundayPrice||0,x.enabled!==false]);
      }
      for(const x of app.bundles){const bundleId=`bundle_${String(x.key).replace(/[^a-zA-Z0-9_-]/g,"")}`,legacy=Number.isFinite(Number(x.basePrice))?Number(x.basePrice):0,monday=Number.isFinite(Number(x.mondayThursdayPrice))?Number(x.mondayThursdayPrice):legacy,friday=Number.isFinite(Number(x.fridayPrice))?Number(x.fridayPrice):legacy,saturday=Number.isFinite(Number(x.saturdayHolidayPrice))?Number(x.saturdayHolidayPrice):legacy,sunday=Number.isFinite(Number(x.sundayPrice))?Number(x.sundayPrice):legacy,amenities=normalizeEntertainmentAmenities(x.entertainmentAmenities);await client.query("INSERT INTO bundle_offers(property_id,bundle_id,name,capacity,base_price,monday_thursday_price,friday_price,saturday_holiday_price,sunday_price,enabled,entertainment_amenities) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)",[propertyId,bundleId,x.name,x.capacity,monday,monday,friday,saturday,sunday,x.enabled!==false,JSON.stringify(amenities)]);for(let i=0;i<x.memberRoomKeys.length;i++){const memberId=roomMap[x.memberRoomKeys[i]];if(!memberId)throw new Error("invalid bundle member mapping");await client.query("INSERT INTO bundle_offer_members(property_id,bundle_id,room_id,position) VALUES($1,$2,$3,$4)",[propertyId,bundleId,memberId,i]);}}
      let pos=0;for(const x of app.knowledge.filter(x=>x.status==="fixed"))await client.query("INSERT INTO knowledge_items(property_id,knowledge_id,question,answer,knowledge_key,position) VALUES($1,$2,$3,$4,$5,$6)",[propertyId,`faq_${++pos}`,x.label||x.key,x.answer,x.key,pos]);
      const inventory=[...Object.values(roomMap),...app.bundles.map(x=>`bundle_${String(x.key).replace(/[^a-zA-Z0-9_-]/g,"")}`)];for(const inventoryId of inventory)await client.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) SELECT $1,$2,d,'closed',0 FROM generate_series(current_date,current_date+364,interval '1 day') d",[propertyId,inventoryId]);
      await client.query("INSERT INTO property_admin_invitations(token_hash,property_id,username,email,expires_at) VALUES($1,$2,$3,$4,$5)",[inviteHash,propertyId,adminUsername,app.email,expiresAt]);
      await client.query("UPDATE onboarding_applications SET status='approved',approved_property_id=$2,approved_at=now(),updated_at=now() WHERE application_id=$1",[id,propertyId]);
      await client.query("INSERT INTO onboarding_review_notes(note_id,application_id,action,note,reviewer_property_id,reviewer_username) VALUES($1,$2,'approved','',$3,$4)",[crypto.randomUUID(),id,reviewerPropertyId,reviewerUsername]);
      await client.query("COMMIT");return{propertyId,adminUsername};
    }catch(e){await client.query("ROLLBACK");throw e;}
  }
  if(name==="approveOnboarding"){
    const [id,propertyId,adminUsername,inviteHash,expiresAt,reviewerPropertyId,reviewerUsername]=args;await client.query("BEGIN");try{const locked=await client.query("SELECT status FROM onboarding_applications WHERE application_id=$1 FOR UPDATE",[id]);if(!locked.rows[0]||!["submitted","resubmitted"].includes(locked.rows[0].status))throw new Error("application cannot be approved");const exists=await client.query("SELECT 1 FROM properties WHERE property_id=$1",[propertyId]);if(exists.rows.length)throw new Error("propertyId already exists");const app=await loadOnboarding(id);await client.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)",[propertyId,app.propertyName]);const fixed=Object.fromEntries((app.knowledge||[]).filter(x=>x.status==="fixed").map(x=>[x.key,x.answer]));const handoff=(app.knowledge||[]).filter(x=>x.status==="human_handoff").map(x=>x.key);const settings={commonAnswers:fixed,contactLink:app.line&&app.line.contactLink||"",humanHandoffSituations:handoff,onboarding:{isReady:true,sourceApplicationId:id},pricing:{}};await client.query("INSERT INTO property_settings(property_id,settings) VALUES($1,$2::jsonb)",[propertyId,JSON.stringify(settings)]);const roomMap={};for(let i=0;i<app.rooms.length;i++){const x=app.rooms[i],roomId=`room_${String(x.key).replace(/[^a-zA-Z0-9_-]/g,"")}`;roomMap[x.key]=roomId;await client.query("INSERT INTO room_types(property_id,room_id,name,capacity,type,description,position,base_price,weekday_price,friday_price,saturday_price,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",[propertyId,roomId,x.name,x.capacity,x.type||"custom",x.features||"",i,x.basePrice||0,x.weekdayPrice||0,x.fridayPrice||0,x.saturdayPrice||0,x.enabled!==false]);}for(const x of app.bundles){const bundleId=`bundle_${String(x.key).replace(/[^a-zA-Z0-9_-]/g,"")}`;await client.query("INSERT INTO bundle_offers(property_id,bundle_id,name,capacity,base_price,enabled) VALUES($1,$2,$3,$4,$5,$6)",[propertyId,bundleId,x.name,x.capacity,x.basePrice||0,x.enabled!==false]);for(let i=0;i<x.memberRoomKeys.length;i++)await client.query("INSERT INTO bundle_offer_members(property_id,bundle_id,room_id,position) VALUES($1,$2,$3,$4)",[propertyId,bundleId,roomMap[x.memberRoomKeys[i]],i]);}let pos=0;for(const x of app.knowledge.filter(x=>x.status==="fixed"))await client.query("INSERT INTO knowledge_items(property_id,knowledge_id,question,answer,knowledge_key,position) VALUES($1,$2,$3,$4,$5,$6)",[propertyId,`faq_${++pos}`,x.label||x.key,x.answer,x.key,pos]);const inventory=[...Object.values(roomMap),...app.bundles.map(x=>`bundle_${String(x.key).replace(/[^a-zA-Z0-9_-]/g,"")}`)];for(const inventoryId of inventory)await client.query("INSERT INTO inventory_availability_days(property_id,inventory_id,stay_date,status,remaining) SELECT $1,$2,d,'closed',0 FROM generate_series(current_date,current_date+364,interval '1 day') d",[propertyId,inventoryId]);await client.query("INSERT INTO property_admin_invitations(token_hash,property_id,username,expires_at) VALUES($1,$2,$3,$4)",[inviteHash,propertyId,adminUsername,expiresAt]);await client.query("UPDATE onboarding_applications SET status='approved',approved_property_id=$2,approved_at=now(),updated_at=now() WHERE application_id=$1",[id,propertyId]);await client.query("INSERT INTO onboarding_review_notes(note_id,application_id,action,note,reviewer_property_id,reviewer_username) VALUES($1,$2,'approved','',$3,$4)",[crypto.randomUUID(),id,reviewerPropertyId,reviewerUsername]);await client.query("COMMIT");return{propertyId,adminUsername};}catch(e){await client.query("ROLLBACK");throw e;}
  }
  if(name==="getAdminInvitation"){
    const r=await client.query(`SELECT i.property_id,${ADMIN_INVITATION_EMAIL_SQL} email,p.display_name,EXISTS(SELECT 1 FROM admin_identities a WHERE a.normalized_email=lower(${ADMIN_INVITATION_EMAIL_SQL})) existing_identity FROM property_admin_invitations i JOIN properties p ON p.property_id=i.property_id LEFT JOIN property_settings s ON s.property_id=i.property_id WHERE i.token_hash=$1 AND i.used_at IS NULL AND i.expires_at>now()`,args),row=r.rows[0];
    return row?{propertyId:row.property_id,propertyName:row.display_name,email:row.email,existingIdentity:Boolean(row.existing_identity)}:null;
  }
  if(name==="redeemAdminInvitation"){
    const [tokenHash,passwordHash]=args;
    await client.query("BEGIN");
    try{
      const r=await client.query(`SELECT i.property_id,i.username,${ADMIN_INVITATION_EMAIL_SQL} email FROM property_admin_invitations i LEFT JOIN property_settings s ON s.property_id=i.property_id WHERE i.token_hash=$1 AND i.used_at IS NULL AND i.expires_at>now() FOR UPDATE OF i`,[tokenHash]);
      if(!r.rows[0])throw new Error("invalid or expired invitation");
      const row=r.rows[0],normalizedEmail=String(row.email||"").trim().toLowerCase();
      if(!normalizedEmail)throw new Error("invitation email is missing");
      let identity=await client.query("SELECT user_id FROM admin_identities WHERE normalized_email=$1",[normalizedEmail]),userId=identity.rows[0]&&identity.rows[0].user_id,existingIdentity=Boolean(userId);
      if(!userId){if(!passwordHash)throw new Error("new identity password is missing");userId=crypto.randomUUID();await client.query("INSERT INTO admin_identities(user_id,email,normalized_email,password_hash) VALUES($1,$2,$3,$4)",[userId,row.email,normalizedEmail,passwordHash]);}
      await client.query("INSERT INTO admin_users(property_id,username,password_hash) VALUES($1,$2,'disabled$identity-only') ON CONFLICT(property_id,username) DO NOTHING",[row.property_id,row.username]);
      await client.query("INSERT INTO admin_user_properties(user_id,property_id,username) VALUES($1,$2,$3)",[userId,row.property_id,row.username]);
      await client.query("UPDATE property_admin_invitations SET used_at=now() WHERE token_hash=$1",[tokenHash]);
      await client.query("COMMIT");
      return{propertyId:row.property_id,email:row.email,existingIdentity};
    }catch(error){await client.query("ROLLBACK");throw error;}
  }
  if (name === "getAdminUser") {
    const r=await client.query("SELECT property_id,username,password_hash FROM admin_users WHERE property_id=$1 AND username=$2",args);
    return r.rows[0]?{propertyId:r.rows[0].property_id,username:r.rows[0].username,passwordHash:r.rows[0].password_hash}:null;
  }
  if (name === "getAdminIdentityByEmail") return loadAdminIdentity(args[0]);
  if (name === "createAdminSession") {
    await client.query("DELETE FROM admin_sessions WHERE expires_at <= now()");
    if(args.length===5)await client.query("INSERT INTO admin_sessions(token_hash,user_id,property_id,username,expires_at) VALUES($1,$2,$3,$4,$5)",args);
    else await client.query("INSERT INTO admin_sessions(token_hash,property_id,username,expires_at) VALUES($1,$2,$3,$4)",args);
    return true;
  }
  if (name === "getAdminSession") return loadAdminSession(args[0]);
  if (name === "selectAdminProperty") {const [tokenHash,propertyId]=args,r=await client.query("SELECT user_id FROM admin_sessions WHERE token_hash=$1 AND expires_at>now()",[tokenHash]);if(!r.rows[0]||!r.rows[0].user_id)return null;const membership=await client.query("SELECT username FROM admin_user_properties WHERE user_id=$1 AND property_id=$2",[r.rows[0].user_id,propertyId]);if(!membership.rows[0])return null;await client.query("UPDATE admin_sessions SET property_id=$2,username=$3 WHERE token_hash=$1",[tokenHash,propertyId,membership.rows[0].username]);return loadAdminSession(tokenHash);}
  if (name === "deleteAdminSession") { await client.query("DELETE FROM admin_sessions WHERE token_hash=$1",args); return true; }
  if(name==="getLineBindingByPropertyId"||name==="getLineBindingByWebhookKey"){
    const column=name==="getLineBindingByPropertyId"?"property_id":"webhook_key";
    const r=await client.query(`SELECT property_id,webhook_key,channel_secret_encrypted,channel_access_token_encrypted,enabled,created_at,updated_at,last_webhook_observed_at,last_valid_webhook_at FROM property_line_bindings WHERE ${column}=$1`,args);
    return lineBindingRow(r.rows[0]);
  }
  if(name==="upsertLineBinding"){
    const row=args[0],r=await client.query("INSERT INTO property_line_bindings(property_id,webhook_key,channel_secret_encrypted,channel_access_token_encrypted,enabled) VALUES($1,$2,$3::jsonb,$4::jsonb,$5) ON CONFLICT(property_id) DO UPDATE SET webhook_key=excluded.webhook_key,channel_secret_encrypted=excluded.channel_secret_encrypted,channel_access_token_encrypted=excluded.channel_access_token_encrypted,enabled=excluded.enabled,updated_at=now() RETURNING property_id,webhook_key,channel_secret_encrypted,channel_access_token_encrypted,enabled,created_at,updated_at,last_webhook_observed_at,last_valid_webhook_at",[row.propertyId,row.webhookKey,JSON.stringify(row.channelSecretEncrypted),JSON.stringify(row.channelAccessTokenEncrypted),Boolean(row.enabled)]);
    return lineBindingRow(r.rows[0]);
  }
  if(name==="setLineBindingEnabled"){
    const r=await client.query("UPDATE property_line_bindings SET enabled=$2,updated_at=now() WHERE property_id=$1 RETURNING property_id,webhook_key,channel_secret_encrypted,channel_access_token_encrypted,enabled,created_at,updated_at,last_webhook_observed_at,last_valid_webhook_at",args);
    return lineBindingRow(r.rows[0]);
  }
  if(name==="markLineBindingWebhookObserved"){
    const r=await client.query("UPDATE property_line_bindings SET last_webhook_observed_at=$2,updated_at=now() WHERE webhook_key=$1 RETURNING property_id,webhook_key,channel_secret_encrypted,channel_access_token_encrypted,enabled,created_at,updated_at,last_webhook_observed_at,last_valid_webhook_at",args);
    return lineBindingRow(r.rows[0]);
  }
  if(name==="createLineSetupToken"){
    const row=args[0],r=await client.query("INSERT INTO property_line_setup_tokens(setup_id,token_hash,property_id,expires_at,created_by_property_id,created_by_username) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",[row.setupId,row.tokenHash,row.propertyId,row.expiresAt,row.createdByPropertyId,row.createdByUsername]);
    return lineSetupRow(r.rows[0]);
  }
  if(name==="listLineSetupTokens"){
    const propertyId=String(args[0]||"").trim(),r=await client.query(`SELECT * FROM property_line_setup_tokens ${propertyId?"WHERE property_id=$1":""} ORDER BY created_at DESC`,propertyId?[propertyId]:[]);
    return r.rows.map(lineSetupRow);
  }
  if(name==="getLineSetupTokenByHash"){
    const r=await client.query("SELECT * FROM property_line_setup_tokens WHERE token_hash=$1",args);
    return lineSetupRow(r.rows[0]);
  }
  if(name==="revokeLineSetupToken"){
    const r=await client.query("UPDATE property_line_setup_tokens SET revoked_at=$2,updated_at=now() WHERE setup_id=$1 AND revoked_at IS NULL AND used_at IS NULL RETURNING *",args);
    return lineSetupRow(r.rows[0]);
  }
  if(name==="redeemLineSetupToken"){
    const [tokenHash,binding,usedAt]=args;
    await client.query("BEGIN");
    try{
      const tokenResult=await client.query("SELECT * FROM property_line_setup_tokens WHERE token_hash=$1 FOR UPDATE",[tokenHash]),token=tokenResult.rows[0];
      if(!token){await client.query("ROLLBACK");return{ok:false,state:"invalid"};}
      if(token.used_at){await client.query("ROLLBACK");return{ok:false,state:"used"};}
      if(token.revoked_at){await client.query("ROLLBACK");return{ok:false,state:"revoked"};}
      if(new Date(token.expires_at).getTime()<=new Date(usedAt).getTime()){await client.query("ROLLBACK");return{ok:false,state:"expired"};}
      if(token.property_id!==binding.propertyId){await client.query("ROLLBACK");return{ok:false,state:"invalid"};}
      const saved=await client.query("INSERT INTO property_line_bindings(property_id,webhook_key,channel_secret_encrypted,channel_access_token_encrypted,enabled) VALUES($1,$2,$3::jsonb,$4::jsonb,$5) ON CONFLICT(property_id) DO UPDATE SET webhook_key=property_line_bindings.webhook_key,channel_secret_encrypted=excluded.channel_secret_encrypted,channel_access_token_encrypted=excluded.channel_access_token_encrypted,enabled=excluded.enabled,updated_at=now() RETURNING property_id,webhook_key,channel_secret_encrypted,channel_access_token_encrypted,enabled,created_at,updated_at,last_webhook_observed_at,last_valid_webhook_at",[binding.propertyId,binding.webhookKey,JSON.stringify(binding.channelSecretEncrypted),JSON.stringify(binding.channelAccessTokenEncrypted),Boolean(binding.enabled)]);
      await client.query("UPDATE property_line_setup_tokens SET used_at=$2,updated_at=now() WHERE token_hash=$1",[tokenHash,usedAt]);
      await client.query("COMMIT");
      return{ok:true,binding:lineBindingRow(saved.rows[0])};
    }catch(error){await client.query("ROLLBACK");throw error;}
  }
  if(name==="recordValidLineWebhook"){
    const r=await client.query("UPDATE property_line_bindings SET last_valid_webhook_at=$2,updated_at=now() WHERE webhook_key=$1 AND enabled=true RETURNING property_id,webhook_key,channel_secret_encrypted,channel_access_token_encrypted,enabled,created_at,updated_at,last_webhook_observed_at,last_valid_webhook_at",args);
    return lineBindingRow(r.rows[0]);
  }
  if (name === "getConversationState") {
    const r=await client.query("SELECT state FROM conversation_states WHERE property_id=$1 AND channel_id=$2 AND line_user_id=$3",args); return r.rows[0] ? (typeof r.rows[0].state === "string" ? JSON.parse(r.rows[0].state) : r.rows[0].state) : null;
  }
  if (name === "setConversationState") {
    await client.query("INSERT INTO conversation_states(property_id,channel_id,line_user_id,state) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(property_id,channel_id,line_user_id) DO UPDATE SET state=excluded.state,updated_at=now()",[args[0],args[1],args[2],JSON.stringify(args[3])]); return args[3];
  }
  if (name === "deleteConversationState") { const r=await client.query("DELETE FROM conversation_states WHERE property_id=$1 AND channel_id=$2 AND line_user_id=$3 RETURNING property_id",args); return Boolean(r.rows&&r.rows.length); }
  if (name === "listMessageLogs") { const r=await client.query("SELECT payload FROM message_logs WHERE property_id=$1 ORDER BY created_at",[args[0]]); return r.rows.map(payload).map((x)=>({...x,customerId:args[0]})); }
  if (name === "findMessageByEventId") { const r=await client.query("SELECT payload FROM message_logs WHERE property_id=$1 AND event_id=$2 AND ($3::text IS NULL OR channel_id=$3) ORDER BY created_at LIMIT 1",[args[0],args[1],args[2]||null]); const x=payload(r.rows[0]); return x?{...x,customerId:args[0]}:null; }
  if (name === "appendMessageLog") {
    const [propertyId,input]=args; const createdAt=input.createdAt||new Date().toISOString(); const item={...input,reviewId:input.reviewId||`message_${crypto.randomUUID()}`,createdAt};
    await client.query("INSERT INTO message_logs(property_id,channel_id,event_id,review_id,line_user_id,processing_status,status,needs_review,payload,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$10)",[propertyId,item.channelId||"",item.eventId||"",item.reviewId,item.lineUserId||"",item.processingStatus||"",item.status||"",Boolean(item.needsReview),JSON.stringify(item),createdAt]);
    if(item.needsReview) await client.query("INSERT INTO review_queue_items(property_id,review_id,status,review_note) VALUES($1,$2,$3,$4) ON CONFLICT(property_id,review_id) DO UPDATE SET status=excluded.status,review_note=excluded.review_note,updated_at=now()",[propertyId,item.reviewId,item.status||"pending",item.reviewNote||""]);
    return {...item,customerId:propertyId};
  }
  if (name === "claimMessageEvent") {
    const [propertyId,channelId,eventId,initial={}]=args; const now=new Date().toISOString(); const reviewId=initial.reviewId||`message_${crypto.randomUUID()}`;
    await client.query("BEGIN"); const claim=await client.query("INSERT INTO event_claims(property_id,external_event_id,channel_id,review_id,claimed_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING review_id",[propertyId,eventId,channelId,reviewId,now]);
    if(!claim.rows||!claim.rows.length){await client.query("ROLLBACK");const existing=await operation("findMessageByEventId",[propertyId,eventId,null]);return {claimed:false,duplicate:true,processingStatus:existing&&existing.processingStatus||"processing",item:existing};}
    const safe={...initial}; for(const key of ["replyToken","accessToken","lineChannelAccessToken","channelSecret","secret","token","externalErrorPayload","externalResponsePayload"]) delete safe[key];
    const item={...safe,propertyId,channelId,eventId,reviewId,processingStatus:"processing",claimedAt:now,createdAt:initial.createdAt||now,updatedAt:now,shouldReply:false,noReply:false,needsReview:false,status:"processing"};
    try{await operation("appendMessageLog",[propertyId,item]);await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;} return {claimed:true,duplicate:false,processingStatus:"processing",item:{...item,customerId:propertyId}};
  }
  if (name === "updateMessageEvent") {
    const [propertyId,channelId,eventId,patch]=args; const current=await operation("findMessageByEventId",[propertyId,eventId,channelId]); if(!current)return null;
    const safe={...patch}; for(const key of ["replyToken","accessToken","lineChannelAccessToken","channelSecret","secret","token","externalErrorPayload","externalResponsePayload"]) delete safe[key];
    const item={...current,...safe,updatedAt:new Date().toISOString()}; const timestampFields={decided:"decidedAt",no_reply:"noReplyAt",reply_succeeded:"replySucceededAt",reply_failed:"replyFailedAt",processing_failed:"processingFailedAt"};const timestampField=timestampFields[item.processingStatus];if(timestampField&&!item[timestampField])item[timestampField]=new Date().toISOString();delete item.customerId;
    await client.query("UPDATE message_logs SET processing_status=$4,status=$5,needs_review=$6,payload=$7::jsonb,updated_at=now() WHERE property_id=$1 AND channel_id=$2 AND event_id=$3",[propertyId,channelId,eventId,item.processingStatus||"",item.status||"",Boolean(item.needsReview),JSON.stringify(item)]);
    if(item.needsReview) await client.query("INSERT INTO review_queue_items(property_id,review_id,status,review_note) VALUES($1,$2,$3,$4) ON CONFLICT(property_id,review_id) DO UPDATE SET status=excluded.status,review_note=excluded.review_note,updated_at=now()",[propertyId,item.reviewId,item.status||"pending",item.reviewNote||""]);
    return {...item,customerId:propertyId};
  }
  if(name==="listRecentMessages"){const all=await operation("listMessageLogs",[args[0]]);const limit=Math.max(1,Math.min(50,Number(args[3]&&args[3].limit||10)));const since=Date.parse(args[3]&&args[3].since||"");return all.filter(x=>x.channelId===args[1]&&x.lineUserId===args[2]&&x.processingStatus!=="processing").filter(x=>!Number.isFinite(since)||Date.parse(x.createdAt||"")>=since).slice(-limit);}
  if(name==="resolveReview"){const [propertyId,reviewId,ownerAction,reviewNote]=args;const r=await client.query("SELECT payload FROM message_logs WHERE property_id=$1 AND review_id=$2",[propertyId,reviewId]);const item=payload(r.rows[0]);if(!item)return null;Object.assign(item,{ownerAction,reviewNote,status:"resolved",resolvedAt:new Date().toISOString()});await client.query("UPDATE message_logs SET status='resolved',needs_review=false,payload=$3::jsonb,updated_at=now() WHERE property_id=$1 AND review_id=$2",[propertyId,reviewId,JSON.stringify(item)]);await client.query("UPDATE review_queue_items SET status='resolved',owner_action=$3,review_note=$4,resolved_at=now(),updated_at=now() WHERE property_id=$1 AND review_id=$2",[propertyId,reviewId,ownerAction,reviewNote]);return {...item,customerId:propertyId};}
  if(["listGuests","listNotes","listGuestMessages"].includes(name)) return [];
  if(["getGuest","findGuestByLineUserId","updateGuest","createGuest","addNote","updateNote"].includes(name)) return null;
  if(name==="linkMessagesToGuest") return 0;
  throw new Error(`unsupported postgres operation: ${name}`);
}

(async()=>{client=await openPostgres(workerData.connection);parentPort.on("message",async({name,args,signal,buffer})=>{const status=new Int32Array(signal);const bytes=new Uint8Array(buffer);try{const result=await operation(name,args);const encoded=Buffer.from(JSON.stringify({ok:true,result}));if(encoded.length>bytes.length)throw new Error("postgres provider response too large");bytes.set(encoded);Atomics.store(status,1,encoded.length);Atomics.store(status,0,1);}catch(error){const encoded=Buffer.from(JSON.stringify({ok:false,error:String(error&&error.message||error),stack:String(error&&error.stack||"")}));bytes.set(encoded.subarray(0,bytes.length));Atomics.store(status,1,Math.min(encoded.length,bytes.length));Atomics.store(status,0,2);}Atomics.notify(status,0);});})().catch((error)=>{throw error;});
