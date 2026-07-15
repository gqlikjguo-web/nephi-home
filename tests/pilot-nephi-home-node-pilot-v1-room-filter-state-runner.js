"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const root=path.resolve(__dirname,"../pilot/nephi-home-node-pilot-v1");
const {migratePostgres}=require(path.join(root,"lib/providers/postgres-migrate"));
const {seedPostgres}=require(path.join(root,"lib/providers/postgres-seed"));
const {createPostgresProviders}=require(path.join(root,"lib/providers/postgres-providers"));
const {createApp}=require(path.join(root,"server"));
const checks=[];function check(name,value){assert.ok(value,name);checks.push(name)}
function availability(fields,missing=[]){return{intent:"availability",route:missing.length?"clarification_needed":"auto_reply_allowed",confidence:.99,reason:"room_filter_state_test",stayDurationMode:"needs_nights",extractedFields:fields,missingFields:missing,shouldIgnore:false,needsHuman:false};}
class Classifier{async classify(input){const text=input.currentMessage;
  if(input.currentMessages.length>1&&input.currentMessages.some(item=>item.includes("301")))return availability({checkInDate:"2026-07-15",guestCount:2,nights:1,roomType:"301"});
  const room=(text.match(/(301|302|401|402)/)||[])[1];
  if(room)return availability({checkInDate:"2026-07-15",roomType:room},["guestCount","nights"]);
  if(text==="雙人房")return availability({checkInDate:"2026-07-15",roomType:"雙人房"},["guestCount","nights"]);
  if(text==="2 位")return availability({guestCount:2,roomType:"all"},["nights"]);
  if(text==="住一晚")return availability({nights:1,roomType:"all"});
  if(text==="7/15 兩位住一晚有空房嗎")return availability({checkInDate:"2026-07-15",guestCount:2,nights:1});
  return availability({},["checkInDate","guestCount","nights"]);
}}
async function send(base,user,eventId,messageText){const r=await fetch(`${base}/api/test-line/resolve`,{method:"POST",headers:{"content-type":"application/json","x-test-line-secret":"room-state-test"},body:JSON.stringify({customerId:"nephi_home",channelId:"room-state",lineUserId:user,eventId,messageText})});assert.equal(r.status,200);return(await r.json()).data;}
(async()=>{const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),"nephi-room-state-")),connection={kind:"pglite",dataDir};await migratePostgres(connection);await seedPostgres(connection);const providers=createPostgresProviders(connection);for(const id of ["room301","room302","room401","room402"])providers.availability.setDay("nephi_home","2026-07-15",id,"available");const app=createApp({providers,now:()=>new Date("2026-07-14T04:00:00Z"),structuredClassifier:new Classifier(),conversationDebounceMs:10,testLineSecret:"room-state-test"});const {url}=await app.start(0,"127.0.0.1");
try{const user="specified-301";await send(url,user,"301-1","7/15 的 301 能預訂嗎");await send(url,user,"301-2","2 位");let state=providers.persistence.getConversationState("nephi_home","room-state",user);check("補問人數後保留 301",state.roomType==="room301"&&state.checkInDate==="2026-07-15"&&state.guestCount===2);const final=await send(url,user,"301-3","住一晚");state=providers.persistence.getConversationState("nephi_home","room-state",user);check("完整 state 保留指定房型",state.roomType==="room301"&&state.checkOutDate==="2026-07-16"&&state.nights===1);check("只回 301",/301/.test(final.replyText)&&!/302|401|402/.test(final.replyText));
for(const room of ["302","401","402"]){const u=`specified-${room}`;await send(url,u,`${room}-1`,`7/15 的 ${room} 能預訂嗎`);await send(url,u,`${room}-2`,"2 位");const reply=await send(url,u,`${room}-3`,"住一晚");const saved=providers.persistence.getConversationState("nephi_home","room-state",u);check(`保留 ${room}`,saved.roomType===`room${room}`&&reply.replyText.includes(room));}
const typeUser="double-type";await send(url,typeUser,"type-1","雙人房");await send(url,typeUser,"type-2","2 位");const typeReply=await send(url,typeUser,"type-3","住一晚");check("類型篩選不被補問覆蓋",/301/.test(typeReply.replyText)&&/401/.test(typeReply.replyText)&&!/302|402/.test(typeReply.replyText));
const all=await send(url,"unspecified","all-1","7/15 兩位住一晚有空房嗎");check("未指定仍回全部符合房型",["301","302","401","402"].every(x=>all.replyText.includes(x)));
const burst=await Promise.all(["7/15 的 301 能預訂嗎","2 位","住一晚"].map((messageText,i)=>send(url,"burst",`burst-${i}`,messageText)));check("trailing debounce 只回覆一次",burst.filter(x=>x.shouldReply).length===1);check("burst 仍只查 301",/301/.test(burst.find(x=>x.shouldReply).replyText)&&!/302|401|402/.test(burst.find(x=>x.shouldReply).replyText));
}finally{await app.stop();fs.rmSync(dataDir,{recursive:true,force:true});}console.log(`${checks.length}/${checks.length} PASS`);})().catch(e=>{console.error(e.stack||e);process.exit(1)});
