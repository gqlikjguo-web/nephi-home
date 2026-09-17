"use strict";
function failure(status,code){return Object.assign(new Error(code),{status,code});}
function date(value){
  if(typeof value!=='string'||value.length!==10)return false;
  const parsed=new Date(value+'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}
async function readSubscription(tx,propertyId,time){
  const row=(await tx.query(`SELECT status AS configured_status,
    to_char(contract_start,'YYYY-MM-DD') AS contract_start,
    to_char(contract_end,'YYYY-MM-DD') AS contract_end,
    CASE WHEN status='legacy' THEN 'LEGACY' WHEN status='disabled' THEN 'DISABLED'
      WHEN ($2::timestamptz AT TIME ZONE 'Asia/Taipei')::date<contract_start THEN 'NOT_STARTED'
      WHEN ($2::timestamptz AT TIME ZONE 'Asia/Taipei')::date>contract_end THEN 'EXPIRED'
      ELSE 'ACTIVE' END AS effective_status
    FROM commercial_ai_subscriptions WHERE property_id=$1`,[propertyId,time.moment])).rows[0];
  return {propertyId,status:row?.effective_status||'UNCONFIGURED',configuredStatus:row?.configured_status||null,
    contractStart:row?.contract_start||null,contractEnd:row?.contract_end||null,timeZone:'Asia/Taipei'};
}
async function subscriptionDenial(tx,propertyId,time){
  const value=await readSubscription(tx,propertyId,time);
  return ['ACTIVE','LEGACY'].includes(value.status)?null:`SUBSCRIPTION_${value.status}`;
}
async function verifiedActor(tx,actor){
  const userId=typeof actor?.userId==='string'?actor.userId:null;
  const propertyId=typeof actor?.propertyId==='string'?actor.propertyId:null;
  const username=typeof actor?.username==='string'?actor.username:null;
  const grant=userId
    ?await tx.query('SELECT 1 FROM platform_admin_grants g JOIN admin_user_properties m ON m.property_id=g.property_id AND m.username=g.username WHERE m.user_id=$1 LIMIT 1',[userId])
    :await tx.query('SELECT 1 FROM platform_admin_grants WHERE property_id=$1 AND username=$2',[propertyId,username]);
  if(!grant.rows.length)throw failure(403,'PLATFORM_ADMIN_REQUIRED');
  return {userId,propertyId,username};
}
async function setSubscription(tx,propertyId,input,actor,time,control){
  const author=await verifiedActor(tx,actor);
  if(!input||!['active','disabled'].includes(input.status)||!date(input.contractStart)||!date(input.contractEnd)
    ||input.contractEnd<input.contractStart||!Number.isSafeInteger(input.monthlyLimit)||input.monthlyLimit<0)throw failure(400,'SUBSCRIPTION_INVALID');
  const previous={...await readSubscription(tx,propertyId,time),monthlyLimit:control.monthly_limit===null?null:Number(control.monthly_limit)};
  await tx.query(`INSERT INTO commercial_ai_subscriptions(property_id,status,contract_start,contract_end,updated_at,updated_by)
    VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(property_id) DO UPDATE SET status=EXCLUDED.status,
    contract_start=EXCLUDED.contract_start,contract_end=EXCLUDED.contract_end,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by`,
    [propertyId,input.status,input.contractStart,input.contractEnd,time.moment,JSON.stringify(author)]);
  await tx.query('UPDATE commercial_ai_controls SET monthly_limit=$2,updated_at=$3 WHERE property_id=$1',[propertyId,input.monthlyLimit,time.moment]);
  const next={...await readSubscription(tx,propertyId,time),monthlyLimit:input.monthlyLimit};
  await tx.query('INSERT INTO commercial_ai_subscription_audit(property_id,changed_at,actor,previous_value,next_value) VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb)',
    [propertyId,time.moment,JSON.stringify(author),JSON.stringify(previous),JSON.stringify(next)]);
  return next;
}
module.exports={readSubscription,subscriptionDenial,setSubscription};
