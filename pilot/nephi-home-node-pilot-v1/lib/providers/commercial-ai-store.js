"use strict";

function identity(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("COMMERCIAL_IDENTITY_REQUIRED");
  return value;
}

function eventIds(input) {
  if (!Array.isArray(input) || !input.length || input.some(value => typeof value !== "string" || !value.trim())) return null;
  return [...new Set(input)].sort();
}

function boolean(value) {
  if (typeof value !== "boolean") throw new Error("INVALID_BOOLEAN");
  return value;
}

function numericUsage(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

async function clock(tx, now) {
  // Production callers omit now: the database determines the Taipei billing month.
  const result = await tx.query("SELECT moment, to_char(moment AT TIME ZONE 'Asia/Taipei', 'YYYY-MM') AS period FROM (SELECT COALESCE($1::timestamptz, clock_timestamp()) AS moment) clock", [now ?? null]);
  return result.rows[0];
}

async function lockControls(tx, propertyId) {
  await tx.query("INSERT INTO commercial_ai_controls(property_id) VALUES($1) ON CONFLICT DO NOTHING", [propertyId]);
  return (await tx.query("SELECT monthly_limit, ai_enabled FROM commercial_ai_controls WHERE property_id=$1 FOR UPDATE", [propertyId])).rows[0];
}

async function status(tx, propertyId, control, period) {
  const row = (await tx.query("SELECT used FROM commercial_ai_monthly_usage WHERE property_id=$1 AND period=$2", [propertyId, period])).rows[0];
  const used = Number(row?.used || 0);
  const monthlyLimit = control.monthly_limit === null ? null : Number(control.monthly_limit);
  return { propertyId, monthlyLimit, used, remaining:monthlyLimit === null ? null : Math.max(0, monthlyLimit - used), period,
    aiEnabled:control.ai_enabled, status:!control.ai_enabled ? "AI_DISABLED" : monthlyLimit === null ? "UNCONFIGURED" : used >= monthlyLimit ? "QUOTA_EXHAUSTED" : "ACTIVE" };
}

async function handoff(tx, propertyId, channelId, userId) {
  const row = (await tx.query("SELECT human_controlled FROM commercial_ai_handoffs WHERE property_id=$1 AND channel_id=$2 AND line_user_id=$3", [propertyId, channelId, userId])).rows[0];
  return { humanControlled:row?.human_controlled === true };
}

async function gate(tx, control, input) {
  if (!control.ai_enabled) return "AI_DISABLED";
  if ((await handoff(tx, input.propertyId, input.channelId, input.userId)).humanControlled) return "HUMAN_CONTROLLED";
  if (control.monthly_limit === null) return "UNCONFIGURED";
  return null;
}

async function reservations(tx, input, ids) {
  return (await tx.query("SELECT event_id,channel_id,line_user_id,period,turn_id FROM commercial_ai_message_ledger WHERE property_id=$1 AND event_id=ANY($2::text[])", [input.propertyId, ids])).rows;
}

function mismatched(rows, input) {
  return rows.some(row => row.channel_id !== input.channelId || row.line_user_id !== input.userId);
}

async function reserve(tx, control, input, time) {
  const deny = reason => ({ allowed:false, reason, period:time.period });
  const blocked = await gate(tx, control, input);
  if (blocked) return deny(blocked);
  const ids = eventIds(input.eventIds);
  if (!ids) return deny("UNTRUSTED_EVENT");
  const existing = await reservations(tx, input, ids);
  if (mismatched(existing, input)) return deny("EVENT_SCOPE_MISMATCH");
  const messages = (await tx.query("SELECT event_id,channel_id,line_user_id FROM message_logs WHERE property_id=$1 AND event_id=ANY($2::text[])", [input.propertyId, ids])).rows;
  if (mismatched(messages, input)) return deny("EVENT_SCOPE_MISMATCH");
  if (ids.some(id => !messages.some(row => row.event_id === id))) return deny("UNTRUSTED_EVENT");
  const fresh = ids.filter(id => !existing.some(row => row.event_id === id));
  const current = await status(tx, input.propertyId, control, time.period);
  if (fresh.length > current.remaining) return deny("QUOTA_EXHAUSTED");
  if (fresh.length) {
    await tx.query("INSERT INTO commercial_ai_monthly_usage(property_id,period,used) VALUES($1,$2,$3) ON CONFLICT(property_id,period) DO UPDATE SET used=commercial_ai_monthly_usage.used+EXCLUDED.used", [input.propertyId,time.period,fresh.length]);
    await tx.query("INSERT INTO commercial_ai_message_ledger(property_id,event_id,channel_id,line_user_id,period,reserved_at) SELECT $1,unnest($2::text[]),$3,$4,$5,$6", [input.propertyId,fresh,input.channelId,input.userId,time.period,time.moment]);
  }
  const periods = new Set(existing.map(row => row.period));
  return { allowed:true, reason:"OK", period:!fresh.length && periods.size === 1 ? existing[0].period : time.period };
}

async function manualSessionMatches(tx, input) {
  const row = (await tx.query("SELECT state_v3 FROM new_core_test_sessions WHERE test_session_id=$1 AND owner_id=$2 AND property_id=$3 FOR SHARE",[input.testSessionId,input.ownerId,input.propertyId])).rows[0];
  const scope = row?.state_v3?.scope;
  return scope?.propertyId === input.propertyId && scope?.channel === input.channelId && scope?.userId === input.userId;
}

async function manualAdmission(tx, input) {
  return (await tx.query("SELECT owner_id,test_session_id,admin_session_hash,event_ids FROM commercial_ai_manual_authorizations WHERE property_id=$1 AND channel_id=$2 AND line_user_id=$3 AND turn_id=$4",[input.propertyId,input.channelId,input.userId,input.turnId])).rows[0];
}

async function authorizeManual(tx, input, time) {
  identity(input.turnId); identity(input.ownerId); identity(input.testSessionId);
  const ids = eventIds(input.eventIds);
  if (!ids || !await manualSessionMatches(tx,input)) return {allowed:false,reason:"MANUAL_AUTHORIZATION_REQUIRED"};
  const prior = await manualAdmission(tx,input);
  if (prior && (prior.owner_id !== input.ownerId || prior.test_session_id !== input.testSessionId || JSON.stringify(prior.event_ids) !== JSON.stringify(ids))) {
    return {allowed:false,reason:"EVENT_SCOPE_MISMATCH"};
  }
  if (!prior) await tx.query("INSERT INTO commercial_ai_manual_authorizations(property_id,channel_id,line_user_id,turn_id,owner_id,test_session_id,event_ids,authorized_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[input.propertyId,input.channelId,input.userId,input.turnId,input.ownerId,input.testSessionId,ids,time.moment]);
  return {allowed:true,reason:"OK"};
}

async function operatorSessionOwner(tx, propertyId, sessionHash) {
  const row = (await tx.query(`SELECT s.user_id,s.property_id,s.username FROM admin_sessions s
    WHERE s.token_hash=$1 AND s.property_id=$2 AND s.expires_at>clock_timestamp()
      AND ((s.user_id IS NULL AND EXISTS(SELECT 1 FROM admin_users u WHERE u.property_id=s.property_id AND u.username=s.username))
        OR (s.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM admin_user_properties m WHERE m.user_id=s.user_id AND m.property_id=s.property_id AND m.username=s.username)))
    FOR SHARE OF s`,[sessionHash,propertyId])).rows[0];
  return row ? row.user_id || `${row.property_id}:${row.username}` : null;
}

async function authorizeOperatorTest(tx, input, time) {
  identity(input.turnId); identity(input.adminSessionHash);
  const ids = eventIds(input.eventIds);
  const ownerId = await operatorSessionOwner(tx,input.propertyId,input.adminSessionHash);
  if (!ids || !ownerId) return {allowed:false,reason:"MANUAL_AUTHORIZATION_REQUIRED"};
  const prior = await manualAdmission(tx,input);
  if (prior && (prior.owner_id !== ownerId || prior.admin_session_hash !== input.adminSessionHash || JSON.stringify(prior.event_ids) !== JSON.stringify(ids))) {
    return {allowed:false,reason:"EVENT_SCOPE_MISMATCH"};
  }
  if (!prior) await tx.query("INSERT INTO commercial_ai_manual_authorizations(property_id,channel_id,line_user_id,turn_id,owner_id,admin_session_hash,event_ids,authorized_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[input.propertyId,input.channelId,input.userId,input.turnId,ownerId,input.adminSessionHash,ids,time.moment]);
  return {allowed:true,reason:"OK"};
}

async function beginAttempt(tx, control, input, time) {
  const deny = reason => ({ allowed:false, reason });
  identity(input.turnId);
  const ids = eventIds(input.eventIds);
  const manual = await manualAdmission(tx,input);
  if (manual) {
    if (JSON.stringify(manual.event_ids) !== JSON.stringify(ids)) return deny("EVENT_SCOPE_MISMATCH");
    const authorized = manual.admin_session_hash
      ? await operatorSessionOwner(tx,input.propertyId,manual.admin_session_hash) === manual.owner_id
      : await manualSessionMatches(tx,{...input,ownerId:manual.owner_id,testSessionId:manual.test_session_id});
    if (!authorized) return deny("MANUAL_AUTHORIZATION_REQUIRED");
  } else {
    const blocked = await gate(tx, control, input);
    if (blocked) return deny(blocked);
  }
  if (input.attemptNumber !== 1 && input.attemptNumber !== 2) return deny("ATTEMPT_LIMIT");
  if (!ids) return deny("RESERVATION_REQUIRED");
  const source = manual ? "manual_test" : "guest_message";
  const key = [input.propertyId,input.channelId,input.userId,input.turnId];
  const prior = (await tx.query("SELECT attempt_number,event_ids,source FROM commercial_ai_attempt_ledger WHERE property_id=$1 AND channel_id=$2 AND line_user_id=$3 AND turn_id=$4",key)).rows;
  if (prior.some(row => row.attempt_number === input.attemptNumber)) return deny("ATTEMPT_ALREADY_STARTED");
  if (input.attemptNumber === 2 && !prior.some(row => row.attempt_number === 1)) return deny("INITIAL_ATTEMPT_REQUIRED");
  if (prior.some(row => row.source !== source || JSON.stringify(row.event_ids) !== JSON.stringify(ids))) return deny("EVENT_SCOPE_MISMATCH");
  if (!manual) {
    const rows = await reservations(tx, input, ids);
    if (mismatched(rows, input)) return deny("EVENT_SCOPE_MISMATCH");
    if (rows.length !== ids.length) return deny("RESERVATION_REQUIRED");
    if (rows.some(row => row.turn_id !== null && row.turn_id !== input.turnId)) return deny("EVENT_ALREADY_ASSIGNED");
    await tx.query("UPDATE commercial_ai_message_ledger SET turn_id=$3 WHERE property_id=$1 AND event_id=ANY($2::text[])", [input.propertyId,ids,input.turnId]);
  }
  await tx.query("INSERT INTO commercial_ai_attempt_ledger(property_id,channel_id,line_user_id,turn_id,attempt_number,event_ids,started_at,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[...key,input.attemptNumber,ids,time.moment,source]);
  return { allowed:true, reason:"OK" };
}

async function finishAttempt(tx, input, time) {
  identity(input.turnId);
  // Store only bounded categorical outcomes and numeric usage; never response bodies or errors.
  if (typeof input.outcome !== "string" || !/^[a-z][a-z0-9_]{0,63}$/i.test(input.outcome)) throw new Error("INVALID_ATTEMPT_OUTCOME");
  const key = [input.propertyId,input.channelId,input.userId,input.turnId,input.attemptNumber];
  const row = (await tx.query("SELECT finished_at FROM commercial_ai_attempt_ledger WHERE property_id=$1 AND channel_id=$2 AND line_user_id=$3 AND turn_id=$4 AND attempt_number=$5", key)).rows[0];
  if (!row) throw new Error("ATTEMPT_NOT_FOUND");
  if (row.finished_at === null) {
    const usage = input.usage;
    await tx.query("UPDATE commercial_ai_attempt_ledger SET finished_at=$6,outcome=$7,input_tokens=$8,cached_input_tokens=$9,output_tokens=$10,total_tokens=$11 WHERE property_id=$1 AND channel_id=$2 AND line_user_id=$3 AND turn_id=$4 AND attempt_number=$5", [...key,time.moment,input.outcome,numericUsage(usage?.input_tokens),numericUsage(usage?.input_tokens_details?.cached_tokens),numericUsage(usage?.output_tokens),numericUsage(usage?.total_tokens)]);
  }
  return { success:true };
}

// Internal provider entry: the caller must authorize administrative setters.
// Every operation shares the property row lock on a dedicated transaction connection.
async function commercialOperation(client, name, args = []) {
  if (typeof client?.transaction !== "function") throw new Error("COMMERCIAL_TRANSACTION_REQUIRED");
  const objectOperation = ["reserve","beginAttempt","finishAttempt","authorizeManual","authorizeOperatorTest"].includes(name);
  const input = objectOperation ? args[0] : null;
  const propertyId = identity(objectOperation ? input?.propertyId : args[0]);
  if (objectOperation) { identity(input.channelId); identity(input.userId); }
  return client.transaction(async tx => {
    let control = await lockControls(tx, propertyId);
    const time = await clock(tx, objectOperation ? input.now : name === "getStatus" ? args[1] : undefined);
    if (name === "getStatus") return status(tx, propertyId, control, time.period);
    if (name === "setLimit") {
      const limit = args[1];
      if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) throw new Error("INVALID_MONTHLY_LIMIT");
      control = (await tx.query("UPDATE commercial_ai_controls SET monthly_limit=$2,updated_at=$3 WHERE property_id=$1 RETURNING monthly_limit,ai_enabled",[propertyId,limit,time.moment])).rows[0];
      return status(tx, propertyId, control, time.period);
    }
    if (name === "setAiEnabled") {
      control = (await tx.query("UPDATE commercial_ai_controls SET ai_enabled=$2,updated_at=$3 WHERE property_id=$1 RETURNING monthly_limit,ai_enabled",[propertyId,boolean(args[1]),time.moment])).rows[0];
      return status(tx, propertyId, control, time.period);
    }
    if (name === "getHandoff" || name === "setHandoff") {
      const channelId = identity(args[1]), userId = identity(args[2]);
      if (name === "setHandoff") await tx.query("INSERT INTO commercial_ai_handoffs(property_id,channel_id,line_user_id,human_controlled,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(property_id,channel_id,line_user_id) DO UPDATE SET human_controlled=EXCLUDED.human_controlled,updated_at=EXCLUDED.updated_at",[propertyId,channelId,userId,boolean(args[3]),time.moment]);
      return handoff(tx, propertyId, channelId, userId);
    }
    if (name === "reserve") return reserve(tx, control, input, time);
    if (name === "authorizeManual") return authorizeManual(tx, input, time);
    if (name === "authorizeOperatorTest") return authorizeOperatorTest(tx, input, time);
    if (name === "beginAttempt") return beginAttempt(tx, control, input, time);
    if (name === "finishAttempt") return finishAttempt(tx, input, time);
    throw new Error("UNKNOWN_COMMERCIAL_OPERATION");
  });
}

module.exports = { commercialOperation };
