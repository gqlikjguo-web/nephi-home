"use strict";
const crypto=require('node:crypto');
const {credentialVersion,channelForBinding}=require('../line-profile-source');
// All writes use the existing tuple and lock the binding before the profile row.
// Holding that lock through commit fences credential rotation and stale responses.
async function profileOperation(db,operation,input){
  const x=input||{},key=[x.propertyId,x.channelId,x.userId];
  const namesOnly=operation==='readNames';
  if((namesOnly?[x.propertyId]:key).some(v=>typeof v!=='string'||!v||v.length>256))return null;
  return db.transaction(async tx=>{
    await tx.query("SET LOCAL lock_timeout='200ms'");
    await tx.query("SET LOCAL statement_timeout='1000ms'");
    const binding=(await tx.query('SELECT * FROM property_line_bindings WHERE property_id=$1 FOR SHARE',[x.propertyId])).rows[0];
    if(!binding?.enabled||(!namesOnly&&channelForBinding(binding)!==x.channelId))return null;
    const version=credentialVersion(binding);
    if(!version||(x.credentialVersion&&x.credentialVersion!==version))return null;
    if(namesOnly){
      const rows=(await tx.query(`SELECT channel_id,line_user_id,display_name FROM line_guest_profiles
        WHERE property_id=$1 AND channel_id=$2 AND credential_version=$3
        AND last_result='success' AND display_name IS NOT NULL AND next_refresh_at>now()`,
        [x.propertyId,channelForBinding(binding),version])).rows;
      return rows.map(r=>({channelId:r.channel_id,userId:r.line_user_id,displayName:r.display_name}));
    }
    const exists=await tx.query('SELECT 1 FROM message_logs WHERE property_id=$1 AND channel_id=$2 AND line_user_id=$3 LIMIT 1',key);
    if(!exists.rows.length)return null;
    if(operation==='observe'){
      if(x.credentialVersion!==version||typeof x.destination!=='string'||!x.destination||x.destination.length>256||typeof x.eventId!=='string'||!x.eventId)return null;
      const event=await tx.query('SELECT 1 FROM message_logs WHERE property_id=$1 AND channel_id=$2 AND line_user_id=$3 AND event_id=$4', [...key,x.eventId]);
      if(!event.rows.length)return null;
      await tx.query(`INSERT INTO line_guest_profiles(property_id,channel_id,line_user_id,credential_version,source_destination,source_event_id)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(property_id,channel_id,line_user_id) DO UPDATE SET
        credential_version=EXCLUDED.credential_version,source_destination=EXCLUDED.source_destination,
        source_event_id=EXCLUDED.source_event_id,source_observed_at=now(),
        display_name=NULL,fetched_at=NULL,last_attempt_at=NULL,next_refresh_at=now(),last_result='unfetched',attempt_id=NULL,lease_until=NULL
        WHERE line_guest_profiles.credential_version<>EXCLUDED.credential_version OR line_guest_profiles.source_destination<>EXCLUDED.source_destination`,[...key,version,x.destination,x.eventId]);
      return true;
    }
    const row=(await tx.query('SELECT *,now() AS db_now FROM line_guest_profiles WHERE property_id=$1 AND channel_id=$2 AND line_user_id=$3 FOR UPDATE',key)).rows[0];
    if(!row||row.credential_version!==version)return null;
    const now=new Date(row.db_now).getTime();
    if(operation==='claim'){
      if(new Date(row.next_refresh_at).getTime()>now)return row.last_result==='success'?{kind:'cached',displayName:row.display_name}:null;
      if(row.lease_until&&new Date(row.lease_until).getTime()>now)return null;
      const attemptId=crypto.randomUUID();
      await tx.query("UPDATE line_guest_profiles SET attempt_id=$4,lease_until=now()+interval '30 seconds',last_attempt_at=now() WHERE property_id=$1 AND channel_id=$2 AND line_user_id=$3",[...key,attemptId]);
      return {kind:'lookup',attemptId,credentialVersion:version,destination:row.source_destination};
    }
    if(operation==='finish'){
      if(row.attempt_id!==x.attemptId||new Date(row.lease_until).getTime()<=now||row.source_destination!==x.destination)return null;
      const allowed=['success','unavailable','forbidden','rate_limited','provider_error','invalid_response','source_mismatch'];
      if(!allowed.includes(x.result))return null;
      const name=x.result==='success'&&typeof x.displayName==='string'&&x.displayName.trim()&&[...x.displayName].length<=256?x.displayName:null;
      if(x.result==='success'&&!name)return null;
      await tx.query(`UPDATE line_guest_profiles SET display_name=$4,fetched_at=CASE WHEN $4::text IS NOT NULL THEN now() ELSE NULL END,
        next_refresh_at=now()+CASE WHEN $5='success' THEN interval '24 hours' ELSE interval '15 minutes' END,
        last_result=$5,attempt_id=NULL,lease_until=NULL WHERE property_id=$1 AND channel_id=$2 AND line_user_id=$3`,[...key,name,x.result]);
      return {displayName:name};
    }
    throw Error('PROFILE_OPERATION_INVALID');
  });
}
module.exports={profileOperation};
