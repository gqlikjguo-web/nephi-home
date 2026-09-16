"use strict";
// Read projections only; commercial-ai-store remains the sole quota/handoff writer.
async function readCommercialUsage(db, propertyId) {
  const { rows } = await db.query(`WITH clock AS (SELECT now() AT TIME ZONE 'Asia/Taipei' AS local_now)
    SELECT count(*) FILTER (WHERE reserved_at >= date_trunc('day',local_now) AT TIME ZONE 'Asia/Taipei')::int AS today,
      count(event_id)::int AS week,to_char(local_now,'YYYY-MM-DD') AS day,
      to_char(date_trunc('week',local_now),'YYYY-MM-DD') AS week_start
    FROM clock LEFT JOIN commercial_ai_message_ledger ON property_id=$1
      AND reserved_at >= date_trunc('week',local_now) AT TIME ZONE 'Asia/Taipei'
      AND reserved_at <= now()
    GROUP BY local_now`, [propertyId]);
  // LEFT JOIN's placeholder is not a ledger entry.
  const row = rows[0];
  return { today:row.today, week:row.week, day:row.day, weekStart:row.week_start, timezone:'Asia/Taipei' };
}
async function readConversations(db, propertyId) {
  const { rows } = await db.query(`SELECT c.*,COALESCE(h.human_controlled,false) AS human_controlled FROM
    (SELECT DISTINCT ON(channel_id,line_user_id) channel_id,line_user_id,created_at,
      left(COALESCE(payload->>'guestMessage',''),80) AS preview FROM message_logs
      WHERE property_id=$1 AND channel_id<>'' AND line_user_id<>''
      ORDER BY channel_id,line_user_id,created_at DESC,review_id DESC) c
    LEFT JOIN commercial_ai_handoffs h ON h.property_id=$1 AND h.channel_id=c.channel_id AND h.line_user_id=c.line_user_id
    ORDER BY c.created_at DESC,c.channel_id,c.line_user_id`,[propertyId]);
  return rows.map(r=>({channelId:r.channel_id,userId:r.line_user_id,messagePreview:r.preview,lastMessageAt:new Date(r.created_at).toISOString(),humanControlled:r.human_controlled}));
}
function cursorValue(value) {
  if (!value) return null;
  try {
    if(typeof value!=='string'||value.length>1000)throw Error();
    const c=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
    if(!Array.isArray(c)||c.length!==2||typeof c[0]!=='string'||!Number.isFinite(Date.parse(c[0]))||typeof c[1]!=='string'||!c[1]||c[1].length>300)throw Error();
    return c;
  } catch {throw Object.assign(new Error('INVALID_HISTORY_CURSOR'),{status:400,code:'INVALID_HISTORY_CURSOR'});}
}
async function readHistory(db, propertyId, channelId, userId, before) {
  const c=cursorValue(before);
  const {rows}=await db.query(`SELECT review_id,created_at,created_at::text AS cursor_time,processing_status,
    payload->>'guestMessage' AS guest_message,payload->>'replyText' AS reply_text,
    payload->>'replyType' AS reply_type,payload->>'route' AS route,payload->>'replyDelivered' AS reply_delivered,payload->>'replySucceededAt' AS reply_at
    FROM message_logs WHERE property_id=$1 AND channel_id=$2 AND line_user_id=$3
      AND ($4::timestamptz IS NULL OR (created_at,review_id)<($4::timestamptz,$5::text))
    ORDER BY created_at DESC,review_id DESC LIMIT 101`,[propertyId,channelId,userId,c?.[0]||null,c?.[1]||null]);
  const page=rows.slice(0,100),last=page.at(-1);
  return {items:page.reverse().map(r=>({reviewId:r.review_id,recordKind:r.reply_type==='scoped_handoff_v2'&&r.route==='human_handoff_required'?'review':'message',createdAt:new Date(r.created_at).toISOString(),guestMessage:r.guest_message||'',replyText:r.reply_text||'',replyDelivered:r.reply_delivered==='true'||r.processing_status==='reply_succeeded',replyAt:r.reply_at||null,processingStatus:r.processing_status||''})),nextCursor:rows.length>100?Buffer.from(JSON.stringify([last.cursor_time,last.review_id])).toString('base64url'):null};
}
module.exports={readCommercialUsage,readConversations,readHistory};
