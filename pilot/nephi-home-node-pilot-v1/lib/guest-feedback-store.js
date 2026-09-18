'use strict';
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const CATEGORIES=['cleanliness','comfort','equipment','arrival','noise'];
const POSITIVES=['clean','bed','bathroom','equipment','arrival','service','other'];
const IMPROVEMENTS=['noise','clean','bed','equipment','bathroom','instructions','other','none'];
const STATUSES=['unviewed','viewed','needs_improvement','improved'];
function fail(status,message){throw Object.assign(new Error(message),{status,code:'FEEDBACK_ERROR'});}
function date(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='1900-01-01'&&value<='2199-12-31'&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
function object(value){return value&&typeof value==='object'&&!Array.isArray(value);}
function text(value,max){if(value===undefined||value===null)return '';if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail(400,'文字內容過長或格式不正確');return value.trim();}
function selections(value,allowed){if(value===undefined)return [];if(!Array.isArray(value)||value.length>allowed.length||value.some(x=>!allowed.includes(x))||new Set(value).size!==value.length)fail(400,'請重新選擇回饋項目');return value;}
function validate(body){
 if(!object(body)||Object.keys(body).some(k=>!['overall','ratings','positives','improvements','revisit','stayDate','roomId','comment'].includes(k)))fail(400,'表單欄位不正確');
 if(!Number.isInteger(body.overall)||body.overall<1||body.overall>5)fail(400,'請選擇整體住宿滿意度');
 const ratings=body.ratings===undefined?{}:body.ratings;
 if(!object(ratings)||Object.entries(ratings).some(([k,v])=>!CATEGORIES.includes(k)||!Number.isInteger(v)||v<1||v>5))fail(400,'請選擇 1～5 分');
 const positives=selections(body.positives,POSITIVES),improvements=selections(body.improvements,IMPROVEMENTS);
 if(improvements.includes('none')&&improvements.length>1)fail(400,'沒有特別需要改善不能與其他改善項目同時選擇');
 if(body.revisit&&!['yes','maybe','no'].includes(body.revisit))fail(400,'請重新選擇再次入住意願');
 if(body.stayDate&&!date(body.stayDate))fail(400,'請輸入有效入住日期');
 return {overall:body.overall,ratings,positives,improvements,revisit:body.revisit||null,stayDate:body.stayDate||null,roomId:text(body.roomId,120)||null,comment:text(body.comment,2000)};
}
function createFeedbackStore({db,now=()=>new Date()}){
 async function resolve(token,client=db,lock=false){
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))fail(404,'此回饋連結無效，請向旅宿取得新連結');
  const row=(await client.query('SELECT property_id FROM property_feedback_links WHERE public_token=$1'+(lock?' FOR SHARE':''),[token])).rows[0];
  if(!row)fail(404,'此回饋連結無效，請向旅宿取得新連結');return row.property_id;
 }
 async function link(propertyId){
  await db.query('INSERT INTO property_feedback_links(property_id,public_token) VALUES($1,$2) ON CONFLICT(property_id) DO NOTHING',[propertyId,randomBytes(32).toString('base64url')]);
  return (await db.query('SELECT public_token FROM property_feedback_links WHERE property_id=$1',[propertyId])).rows[0].public_token;
 }
 async function rotate(propertyId){const token=randomBytes(32).toString('base64url');const result=await db.query('UPDATE property_feedback_links SET public_token=$2,rotated_at=$3 WHERE property_id=$1 RETURNING public_token',[propertyId,token,now()]);if(!result.rows.length)fail(404,'找不到回饋表');return token;}
 async function submit(token,body,visitor){
  const value=validate(body);
  return db.transaction(async t=>{
   const propertyId=await resolve(token,t,true);
   let roomName=null;
   if(value.roomId){const room=(await t.query('SELECT COALESCE(NULLIF(display_name,\'\'),name) name FROM room_types WHERE property_id=$1 AND room_id=$2 AND enabled=true',[propertyId,value.roomId])).rows[0];if(!room)fail(400,'請重新選擇入住房型');roomName=room.name;}
   const at=now(),hash=createHash('sha256').update(token+'\0'+visitor).digest('hex');
   // Transactional, bounded per-property and per-visitor counters; no identity lookup.
   for(const [key,limit] of [[hash,10],['property',300]]){
    const row=(await t.query(`INSERT INTO feedback_rate_limits(property_id,visitor_hash,window_start,attempts) VALUES($1,$2,$3,1)
     ON CONFLICT(property_id,visitor_hash) DO UPDATE SET
     attempts=CASE WHEN feedback_rate_limits.window_start<=$3::timestamptz-interval '10 minutes' THEN 1 ELSE feedback_rate_limits.attempts+1 END,
     window_start=CASE WHEN feedback_rate_limits.window_start<=$3::timestamptz-interval '10 minutes' THEN $3 ELSE feedback_rate_limits.window_start END RETURNING attempts`,[propertyId,key,at])).rows[0];
    if(row.attempts>limit)fail(429,'送出次數較多，請稍候再試');
   }
   await t.query("DELETE FROM feedback_rate_limits WHERE property_id=$1 AND window_start<$2::timestamptz-interval '1 day'",[propertyId,at]);
   await t.query(`INSERT INTO guest_feedback(id,property_id,overall,ratings,positives,improvements,revisit,stay_date,room_id,room_name,comment,created_at,updated_at)
    VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,[randomUUID(),propertyId,value.overall,JSON.stringify(value.ratings),value.positives,value.improvements,value.revisit,value.stayDate,value.roomId,roomName,value.comment,at]);
   return {submitted:true};
  });
 }
 function month(){const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now());return day.slice(0,7)+'-01';}
 async function summary(propertyId){
  const row=(await db.query(`SELECT avg(overall)::float average,count(*) FILTER(WHERE created_at>=($2::date::timestamp AT TIME ZONE 'Asia/Taipei'))::int "monthCount",
   count(*) FILTER(WHERE status='unviewed')::int unviewed,count(*) FILTER(WHERE status='needs_improvement')::int "needsImprovement",
   ${CATEGORIES.map(k=>`avg((ratings->>'${k}')::int)::float "${k}"`).join(',')}
   FROM guest_feedback WHERE property_id=$1`,[propertyId,month()])).rows[0];
  const rank=async field=>(await db.query(`SELECT key,count(*)::int count FROM guest_feedback CROSS JOIN LATERAL unnest(${field}) key WHERE property_id=$1 AND key<>'none' GROUP BY key ORDER BY count DESC,key`,[propertyId])).rows;
  const categories=Object.fromEntries(CATEGORIES.map(k=>[k,row[k]]));for(const k of CATEGORIES)delete row[k];
  return {...row,categories,positives:await rank('positives'),improvements:await rank('improvements')};
 }
 async function list(propertyId,filters={}){
  const args=[propertyId],where=['property_id=$1'];const add=(sql,value)=>{args.push(value);where.push(sql.replace('?',`$${args.length}`));};
  if(filters.status&&filters.status!=='all'){if(!STATUSES.includes(filters.status))fail(400,'狀態不正確');add('status=?',filters.status);}
  if(filters.rating&&filters.rating!=='all'){if(!['5','4','low'].includes(filters.rating))fail(400,'評分不正確');add(filters.rating==='low'?'overall<=?':'overall=?',filters.rating==='low'?3:Number(filters.rating));}
  if(filters.period){let from,to;
   if(filters.period==='custom'){from=filters.from;to=filters.to;if(!date(from)||!date(to)||from>to)fail(400,'請選擇有效起訖日期');}
   else if(['month','previous'].includes(filters.period)){const d=new Date(month()+'T00:00:00Z');if(filters.period==='previous')d.setUTCMonth(d.getUTCMonth()-1);from=d.toISOString().slice(0,10);d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);to=d.toISOString().slice(0,10);}
   else fail(400,'日期範圍不正確');
   add("created_at >= (?::date::timestamp AT TIME ZONE 'Asia/Taipei')",from);add("created_at < ((?::date+1)::timestamp AT TIME ZONE 'Asia/Taipei')",to);
  }
  if(filters.cursor){let cursor;try{if(filters.cursor.length>300)throw Error();cursor=JSON.parse(Buffer.from(filters.cursor,'base64url').toString());if(!Array.isArray(cursor)||cursor.length!==2||!/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(cursor[0])||!/^[a-f0-9-]{36}$/.test(cursor[1]))throw Error();}catch{fail(400,'載入位置不正確，請重新整理');}
   args.push(...cursor);where.push(`(created_at,id)<($${args.length-1}::timestamptz,$${args.length}::uuid)`);
  }
  const rows=(await db.query(`SELECT id,overall,ratings,positives,improvements,revisit,stay_date::text,room_name,comment,status,internal_note,created_at FROM guest_feedback WHERE ${where.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT 21`,args)).rows;
  const items=rows.slice(0,20),last=items.at(-1);return {items,nextCursor:rows.length>20?Buffer.from(JSON.stringify([new Date(last.created_at).toISOString(),last.id])).toString('base64url'):null};
 }
 async function update(propertyId,id,body){
  if(!object(body)||Object.keys(body).some(k=>!['status','internalNote'].includes(k))||!STATUSES.includes(body.status)||!/^[a-f0-9-]{36}$/.test(id))fail(400,'更新內容不正確');
  const row=(await db.query('UPDATE guest_feedback SET status=$3,internal_note=$4,updated_at=$5 WHERE property_id=$1 AND id=$2 RETURNING status,internal_note',[propertyId,id,body.status,text(body.internalNote,1000),now()])).rows[0];
  if(!row)fail(404,'找不到這則回饋');return row;
 }
 return {link,resolve,rotate,submit,summary,list,update};
}
module.exports={createFeedbackStore,fail};
