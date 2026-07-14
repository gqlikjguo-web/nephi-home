"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const crypto = require("node:crypto");
const { openPostgres } = require("./postgres-client");
let client;

function payload(row) { return row ? (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) : null; }
function iso(value) { return value ? new Date(value).toISOString() : new Date().toISOString(); }

async function operation(name, args) {
  if (name === "ready") return true;
  if (name === "getProperty" || name === "listProperties") {
    const filter = name === "getProperty" ? "WHERE p.property_id=$1" : "";
    const result = await client.query(`SELECT p.property_id,p.display_name,s.settings,
      COALESCE((SELECT json_agg(json_build_object('id',r.room_id,'name',r.name,'capacity',r.capacity,'type',r.type,'description',r.description) ORDER BY r.position) FROM room_types r WHERE r.property_id=p.property_id),'[]') rooms,
      COALESCE((SELECT json_agg(json_build_object('question',k.question,'answer',k.answer,'knowledgeKey',k.knowledge_key) ORDER BY k.position) FROM knowledge_items k WHERE k.property_id=p.property_id),'[]') faqs
      FROM properties p LEFT JOIN property_settings s ON s.property_id=p.property_id ${filter} ORDER BY p.property_id`, name === "getProperty" ? [args[0]] : []);
    const mapped = result.rows.map((row) => {
      const settings = typeof row.settings === "string" ? JSON.parse(row.settings) : (row.settings || {});
      return { propertyId: row.property_id, displayName: row.display_name, rooms: row.rooms || [], commonAnswers: settings.commonAnswers || {}, pricing: settings.pricing || {}, faqs: row.faqs || [], humanHandoffSituations: settings.humanHandoffSituations || [], contactLink: settings.contactLink || "", onboarding: settings.onboarding || { isReady: true } };
    });
    return name === "getProperty" ? (mapped[0] || null) : mapped;
  }
  if (name === "getRows") {
    const [propertyId, from, to] = args;
    const result = await client.query("SELECT stay_date::text date,room301,room302,room401,room402,whole_house FROM availability_days WHERE property_id=$1 AND ($2::date IS NULL OR stay_date >= $2::date) AND ($3::date IS NULL OR stay_date < $3::date) ORDER BY stay_date", [propertyId, from || null, to || null]);
    return result.rows.map((r) => ({ date: r.date.slice(0,10), room301:r.room301, room302:r.room302, room401:r.room401, room402:r.room402, wholeHouse:r.whole_house }));
  }
  if (name === "updateProperty") {
    const [propertyId,input]=args; const current=await operation("getProperty",[propertyId]); if(!current)return null;
    await client.query("BEGIN");
    try{
      await client.query("UPDATE properties SET display_name=$2,updated_at=now() WHERE property_id=$1",[propertyId,input.displayName]);
      await client.query("DELETE FROM room_types WHERE property_id=$1",[propertyId]);
      for(let i=0;i<(input.rooms||[]).length;i+=1){const room=input.rooms[i];await client.query("INSERT INTO room_types(property_id,room_id,name,capacity,type,description,position) VALUES($1,$2,$3,$4,$5,$6,$7)",[propertyId,room.id,room.name,room.capacity,room.type||"custom",room.description||"",i]);}
      const settings={...(current.pricing?{pricing:current.pricing}:{}),commonAnswers:input.commonAnswers||{},humanHandoffSituations:current.humanHandoffSituations||[],contactLink:current.contactLink||"",onboarding:current.onboarding||{isReady:true}};
      await client.query("UPDATE property_settings SET settings=$2::jsonb WHERE property_id=$1",[propertyId,JSON.stringify(settings)]);await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}
    return operation("getProperty",[propertyId]);
  }
  if (name === "setDay") {
    const [propertyId,date,roomId,status] = args;
    const column = {room301:"room301",room302:"room302",room401:"room401",room402:"room402",wholeHouse:"whole_house"}[roomId];
    if (!column) throw new Error("invalid roomId");
    await client.query("INSERT INTO availability_days(property_id,stay_date,room301,room302,room401,room402,whole_house) VALUES($1,$2,'available','available','available','available','available') ON CONFLICT DO NOTHING", [propertyId,date]);
    if (roomId === "wholeHouse") await client.query("UPDATE availability_days SET room301=$3,room302=$3,room401=$3,room402=$3,whole_house=$3 WHERE property_id=$1 AND stay_date=$2", [propertyId,date,status]);
    else { await client.query(`UPDATE availability_days SET ${column}=$3 WHERE property_id=$1 AND stay_date=$2`, [propertyId,date,status]); await client.query("UPDATE availability_days SET whole_house=CASE WHEN room301='available' AND room302='available' AND room401='available' AND room402='available' THEN 'available' ELSE 'closed' END WHERE property_id=$1 AND stay_date=$2",[propertyId,date]); }
    return (await operation("getRows", [propertyId,date,new Date(Date.parse(date)+86400000).toISOString().slice(0,10)]))[0];
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
