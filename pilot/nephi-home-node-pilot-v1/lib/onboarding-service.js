"use strict";
const crypto=require("node:crypto");
const {AppError}=require("./mvp-service"),{hashPassword,sessionTokenHash}=require("./admin-auth");
const { normalizeGoogleMapsUrl } = require("./google-maps-url");
const { normalizeEntertainmentAmenities } = require("./bundle-entertainment");
const { normalizeRoomHighlights, characterCount } = require("./room-data");
const { normalizePropertyFacts } = require("./property-facts");
const PROPERTY_ID=/^[a-z][a-z0-9_]{2,47}$/;
function text(value,max=500){const v=String(value||"").trim();if(v.length>max)throw new AppError(400,"TEXT_TOO_LONG","輸入內容過長");return v;}
function email(value){const v=text(value,160);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))throw new AppError(400,"INVALID_EMAIL","請輸入有效的 Email");return v;}
function integer(value,min=0){const n=Number(value);if(!Number.isInteger(n)||n<min)throw new AppError(400,"INVALID_NUMBER","請輸入有效數字");return n;}
function validTime(value){const v=text(value,5);if(!/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(v))throw new AppError(400,"INVALID_TIME","時間必須以 30 分鐘為單位");return v;}
function lineContactLink(value,required){const raw=text(value,500);if(!raw){if(required)throw new AppError(400,"MISSING_LINE_CONTACT_LINK","已有 LINE 官方帳號時，LINE 加好友網址為必填");return "";}try{const url=new URL(raw);if(url.protocol!=="https:"||!["lin.ee","line.me"].includes(url.hostname.toLowerCase()))throw new Error("invalid");return url.toString();}catch{throw new AppError(400,"INVALID_LINE_CONTACT_LINK","LINE 加好友網址只接受 https://lin.ee/ 或 https://line.me/");}}
function cleanPropertyFacts(value){try{return normalizePropertyFacts(Array.isArray(value)?value:[]);}catch{throw new AppError(400,"INVALID_PROPERTY_FACT","正式設備資料格式錯誤");}}
function cleanOnboardingInput(input={},draft=false){
 const rooms=(input.rooms||[]).map((x,i)=>{const displayName=text(x.displayName||x.name,80);if(!draft&&!displayName)throw new AppError(400,"MISSING_ROOM_DISPLAY_NAME","房型顯示名稱不得空白");const highlights=normalizeRoomHighlights(x.highlights);if(highlights.length>3||highlights.some(item=>characterCount(item)>15))throw new AppError(400,"INVALID_ROOM_HIGHLIGHTS","房型亮點最多 3 項，每項最多 15 字");const capacity=x.capacity===""||x.capacity===null||x.capacity===undefined?(draft?0:integer(x.capacity,1)):integer(x.capacity,draft?0:1);return{key:text(x.key||`room_${i+1}`,40),roomCode:text(x.roomCode,40),displayName,name:displayName,type:text(x.type,40),capacity,highlights,mondayThursdayPrice:integer(x.mondayThursdayPrice),fridayPrice:integer(x.fridayPrice),saturdayHolidayPrice:integer(x.saturdayHolidayPrice),sundayPrice:integer(x.sundayPrice),enabled:x.enabled!==false};});
 const keys=new Set(rooms.map(x=>x.key));if(keys.size!==rooms.length)throw new AppError(400,"DUPLICATE_ROOM_KEY","房型識別重複");
 const bundles=(input.bundles||[]).map((x,i)=>{const members=[...new Set((x.memberRoomKeys||[]).map(v=>text(v,40)))];if((!draft&&!members.length)||members.some(k=>!keys.has(k)))throw new AppError(400,"INVALID_BUNDLE_MEMBER","包棟成員房型錯誤");const legacy=Object.hasOwn(x,"basePrice")?integer(x.basePrice):0,readPrice=key=>Object.hasOwn(x,key)?integer(x[key]):legacy,capacity=x.capacity===""||x.capacity===null||x.capacity===undefined?(draft?0:integer(x.capacity,1)):integer(x.capacity,draft?0:1);return{key:text(x.key||`bundle_${i+1}`,40),name:text(x.name,80),memberRoomKeys:members,capacity,mondayThursdayPrice:readPrice("mondayThursdayPrice"),fridayPrice:readPrice("fridayPrice"),saturdayHolidayPrice:readPrice("saturdayHolidayPrice"),sundayPrice:readPrice("sundayPrice"),enabled:x.enabled!==false,entertainmentAmenities:normalizeEntertainmentAmenities(x.entertainmentAmenities)};});
 const knowledge=(input.knowledge||[]).filter(x=>x.key!=="other").map((x,i)=>{const status=["fixed","unavailable","human_handoff","undecided"].includes(x.status)?x.status:"undecided",answer=text(x.answer,1000);if(status==="fixed"&&!answer)throw new AppError(400,"MISSING_KNOWLEDGE_ANSWER",`${text(x.label||x.key,120)}需要填寫內容`);return{key:text(x.key||`faq_${i+1}`,80),label:text(x.label,120),status,answer};});
 const propertyFacts=cleanPropertyFacts(input.propertyFacts);
 const hasOfficialAccount=Boolean(input.line&&input.line.hasOfficialAccount);
 const emailValue=text(input.email,160),checkInValue=text(input.checkInTime,5),latestArrivalValue=text(input.latestArrivalTime,5),checkOutValue=text(input.checkOutTime,5);
 return{propertyName:text(input.propertyName,100),contactName:text(input.contactName,80),phone:text(input.phone,40),email:emailValue?email(emailValue):(draft?"":email(emailValue)),address:text(input.address,300),googleMapsUrl:normalizeGoogleMapsUrl(input.googleMapsUrl),checkInTime:checkInValue?validTime(checkInValue):(draft?"":validTime(checkInValue)),latestArrivalTime:latestArrivalValue?validTime(latestArrivalValue):"",checkOutTime:checkOutValue?validTime(checkOutValue):(draft?"":validTime(checkOutValue)),line:{hasOfficialAccount,contactLink:lineContactLink(input.line&&input.line.contactLink,hasOfficialAccount)},propertyIdSuggestion:text(input.propertyIdSuggestion,48),rooms,bundles,propertyFacts,knowledge};
}
function cleanInput(input={}){return cleanOnboardingInput(input,false);}
function cleanDraftInput(input={}){return cleanOnboardingInput(input,true);}
const LABELS={propertyName:"民宿正式名稱",contactName:"聯絡人姓名",phone:"聯絡電話",email:"Email",address:"地址",checkInTime:"入住時間",checkOutTime:"退房時間",rooms:"至少一個房型"};
function completeness(app){const required=["propertyName","contactName","phone","email","address","checkInTime","checkOutTime"],missing=required.filter(k=>!app[k]);if(!app.rooms||!app.rooms.length)missing.push("rooms");return{percent:Math.round((required.length+1-missing.length)/(required.length+1)*100),missing,missingLabels:missing.map(x=>LABELS[x]||x),contradictions:[]};}
function authorizedPropertyIds(session){
 const ids=[];
 for(const property of Array.isArray(session&&session.properties)?session.properties:[]){
  const propertyId=text(property&&property.propertyId,48);if(propertyId&&!ids.includes(propertyId))ids.push(propertyId);
 }
 return ids.filter(propertyId=>PROPERTY_ID.test(propertyId));
}
function createOnboardingService(provider,{emailNotifier}={}){
 if(!provider)return null;
 async function authorized(id,token){if(!token||!provider.verifyOnboardingToken(id,sessionTokenHash(token)))throw new AppError(401,"INVALID_DRAFT_TOKEN","草稿驗證失敗");}
 async function finishChangeRequest(id,result,resumeToken,expiresAt){
  if(result.notification.shouldNotify){
   let claim;try{claim=provider.claimOnboardingEmailDelivery(result.notification.noteId);}catch{claim=null;}
   if(claim&&claim.claimed){try{const sent=await emailNotifier.sendChangeRequest({recipient:claim.recipient,propertyName:result.application.propertyName,reason:result.application.latestChangeRequest.reason,resumeToken});try{provider.completeOnboardingEmailDelivery(result.notification.noteId,"sent",sent.providerMessageId,"");}catch{}}catch(error){try{provider.completeOnboardingEmailDelivery(result.notification.noteId,"failed","",String(error&&error.message||"email_send_failed").slice(0,120));}catch{}}}
  }
  let application=result.application;try{application=provider.getOnboardingForReview(id)||application;}catch{}
  return{application,resumeToken,expiresAt,emailStatus:application.emailDelivery&&application.emailDelivery.status||"not_configured"};
 }
 return{
 createInvitation(input,s){const days=Number(input&&input.expiresInDays||7);if(!Number.isInteger(days)||days<1||days>30)throw new AppError(400,"INVALID_INVITE_EXPIRY","邀請有效期必須為 1 到 30 天");const applicationId=crypto.randomUUID(),inviteToken=crypto.randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+days*86400000).toISOString();provider.createOnboardingInvitation(applicationId,sessionTokenHash(inviteToken),expiresAt,s.propertyId||"",s.username||"");return{applicationId,inviteToken,expiresAt,status:"draft"};},
 resolveInvitation(token){const raw=text(token,500),resolved=raw&&provider.resolveOnboardingInvitation(sessionTokenHash(raw));if(!resolved)throw new AppError(401,"INVALID_ONBOARDING_INVITE","邀請連結無效、已過期或已撤銷");return{applicationId:resolved.applicationId,draftToken:raw,status:resolved.status,expiresAt:resolved.expiresAt};},
 revokeInvitation(id){if(!provider.revokeOnboardingInvitation(id))throw new AppError(409,"ONBOARDING_INVITE_NOT_REVOCABLE","只有尚未送出的有效邀請可以撤銷");return{applicationId:id,revoked:true};},
 async getDraft(id,token){await authorized(id,token);const item=provider.getOnboarding(id);if(!item)throw new AppError(404,"APPLICATION_NOT_FOUND","找不到申請案件");return item;},async saveDraft(id,token,input){await authorized(id,token);try{return provider.saveOnboarding(id,cleanDraftInput(input));}catch(error){if(/not editable/i.test(String(error&&error.message)))throw new AppError(409,"APPLICATION_NOT_EDITABLE","案件已送出，不能再修改草稿");throw error;}},async preview(id,token){const item=await this.getDraft(id,token);return{...item,completeness:completeness(item)};},
 async submit(id,token){const item=await this.preview(id,token);if(["submitted","resubmitted","approved"].includes(item.status))return item;if(item.status==="rejected")throw new AppError(409,"APPLICATION_REJECTED","已拒絕案件必須先由平台管理者重新開放補件");cleanInput(item);if(item.completeness.missing.length)throw new AppError(400,"APPLICATION_INCOMPLETE",`尚缺少：${item.completeness.missingLabels.join("、")}`);return provider.submitOnboarding(id);},
 resolveResume(token){const raw=text(token,500),resolved=raw&&provider.resolveOnboardingResumeToken(sessionTokenHash(raw));if(!resolved)throw new AppError(400,"INVALID_RESUME_TOKEN","續填連結無效或已過期");return{applicationId:resolved.applicationId,draftToken:raw};},
 issueResumeLink(id){const item=provider.getOnboardingForReview(id);if(!item)throw new AppError(404,"APPLICATION_NOT_FOUND","找不到申請案件");if(item.status!=="changes_requested")throw new AppError(409,"APPLICATION_NOT_AWAITING_CHANGES","案件目前不是待補件狀態");const resumeToken=crypto.randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+30*86400000).toISOString();try{provider.rotateOnboardingResumeToken(id,sessionTokenHash(resumeToken),expiresAt);}catch(error){if(/not awaiting changes/.test(String(error&&error.message)))throw new AppError(409,"APPLICATION_NOT_AWAITING_CHANGES","案件目前不是待補件狀態");throw error;}return{resumeToken,expiresAt};},
 listProperties(session){return provider.listOnboardingProperties({all:Boolean(session&&provider.isPlatformAdmin(session.propertyId,session.username,session.userId)),propertyIds:authorizedPropertyIds(session)});},
 isPlatformAdmin(s){return Boolean(s&&provider.isPlatformAdmin(s.propertyId,s.username,s.userId));},
 list(){return provider.listOnboarding();},
 get(id){const x=provider.getOnboardingForReview(id);if(!x)throw new AppError(404,"APPLICATION_NOT_FOUND","找不到申請案件");return{...x,completeness:completeness(x)};},
 async review(id,status,note,s){
  const reason=text(note,1000);
  if(status==="changes_requested"&&!reason)throw new AppError(400,"MISSING_CHANGE_REASON","請填寫退回補件原因");
  const resumeToken=status==="changes_requested"?crypto.randomBytes(32).toString("base64url"):"",expiresAt=new Date(Date.now()+30*86400000).toISOString();
  let result;
  try{result=provider.reviewOnboarding(id,status,reason,s.propertyId,s.username,resumeToken?sessionTokenHash(resumeToken):null,expiresAt,Boolean(emailNotifier&&emailNotifier.configured));}
  catch(error){if(/application not found/i.test(String(error&&error.message)))throw new AppError(404,"APPLICATION_NOT_FOUND","找不到申請案件");if(/already reviewed|cannot be reviewed/i.test(String(error&&error.message)))throw new AppError(409,"APPLICATION_ALREADY_REVIEWED","案件已完成退回或核准，不能重複操作");throw error;}
   if(status!=="changes_requested")return result.application;
   return finishChangeRequest(id,result,resumeToken,expiresAt);
  },
 async reopenRejected(id,note,s){
  const reason=text(note,1000);if(!reason)throw new AppError(400,"MISSING_REOPEN_REASON","請填寫重新開放補件原因");
  const resumeToken=crypto.randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+30*86400000).toISOString();let result;
  try{result=provider.reopenOnboarding(id,reason,s.propertyId,s.username,sessionTokenHash(resumeToken),expiresAt,Boolean(emailNotifier&&emailNotifier.configured));}
  catch(error){const message=String(error&&error.message||"");if(/application not found/i.test(message))throw new AppError(404,"APPLICATION_NOT_FOUND","找不到申請案件");if(/not rejected/i.test(message))throw new AppError(409,"APPLICATION_NOT_REJECTED","只有未通過案件可以重新開放補件");throw error;}
  return finishChangeRequest(id,result,resumeToken,expiresAt);
 },
 approve(id,input,s){
  const application=provider.getOnboardingForReview(id);if(!application)throw new AppError(404,"APPLICATION_NOT_FOUND","找不到申請案件");
  if(!["submitted","resubmitted"].includes(application.status))throw new AppError(409,"APPLICATION_ALREADY_REVIEWED","案件已完成退回或核准，不能重複操作");
  const mode=text(input.mode,20),propertyId=text(input.propertyId,48);if(!["new","existing"].includes(mode))throw new AppError(400,"INVALID_APPROVAL_MODE","請選擇核准模式");if(!PROPERTY_ID.test(propertyId))throw new AppError(400,"INVALID_PROPERTY_ID","propertyId 格式錯誤");
  if(mode==="existing"){
   const platformAdmin=Boolean(s&&provider.isPlatformAdmin(s.propertyId,s.username,s.userId));
   if(!platformAdmin&&!authorizedPropertyIds(s).includes(propertyId))throw new AppError(403,"PROPERTY_ACCESS_DENIED","無權核准至此旅宿");
   if(!provider.onboardingPropertyExists(propertyId))throw new AppError(404,"PROPERTY_NOT_FOUND","找不到指定旅宿");
   if(text(input.confirmPropertyId,48)!==propertyId)throw new AppError(400,"PROPERTY_CONFIRMATION_MISMATCH","請再次輸入完全相同的 propertyId");
   const readMappings=(value,sourceField,targetField)=>Array.isArray(value)?value.map(item=>({[sourceField]:text(item&&item[sourceField],80),[targetField]:text(item&&item[targetField],80)})):[];
   const roomMappings=readMappings(input.roomMappings,"sourceKey","targetRoomId"),bundleMappings=readMappings(input.bundleMappings,"sourceKey","targetBundleId");
   try{return{...provider.approveOnboardingExisting(id,propertyId,roomMappings,bundleMappings,s.propertyId,s.username),protectedScopes:["availability","daily_room_notes","guests","messages","conversation_state","review_queue","event_claims","admin_identity","admin_sessions","platform_admin","line","contactLink","tokens","secrets"]};}
   catch(error){const message=String(error&&error.message||"");if(/cannot be approved/.test(message))throw new AppError(409,"APPLICATION_ALREADY_REVIEWED","案件已完成退回或核准，不能重複操作");if(/property not found/.test(message))throw new AppError(404,"PROPERTY_NOT_FOUND","找不到指定旅宿");if(/room mapping invalid/.test(message))throw new AppError(409,"ROOM_MAPPING_INVALID","房型必須逐一對應到不重複的既有 room ID");if(/bundle mapping invalid/.test(message))throw new AppError(409,"BUNDLE_MAPPING_INVALID","方案與房型成員無法安全對應既有資料");if(/knowledge mapping ambiguous/.test(message))throw new AppError(409,"KNOWLEDGE_MAPPING_AMBIGUOUS","既有 FAQ key 重複，無法安全套用");throw error;}
  }
  const token=crypto.randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+7*86400000).toISOString(),membershipKey=`onboarding_${String(id).replace(/[^a-zA-Z0-9_-]/g,"").slice(0,64)}`;try{provider.approveOnboarding(id,propertyId,membershipKey,sessionTokenHash(token),expiresAt,s.propertyId,s.username);}catch(e){if(/already exists/.test(e.message))throw new AppError(409,"PROPERTY_ID_CONFLICT","propertyId 已存在");if(/cannot be approved/.test(e.message))throw new AppError(409,"APPLICATION_ALREADY_REVIEWED","案件已完成退回或核准，不能重複操作");throw e;}return{propertyId,adminSetupToken:token,guestUrl:`/guest?propertyId=${propertyId}`,adminUrl:"/admin"};
 },
 getInvitation(token){const invitation=provider.getAdminInvitation(sessionTokenHash(text(token,500)));if(!invitation)throw new AppError(400,"INVALID_ADMIN_INVITATION","邀請碼無效或已使用");return invitation;},
 async redeemInvitation(token,password){const tokenHash=sessionTokenHash(text(token,500)),invitation=provider.getAdminInvitation(tokenHash);if(!invitation)throw new AppError(400,"INVALID_ADMIN_INVITATION","邀請碼無效或已使用");let passwordHash="";if(!invitation.existingIdentity){try{passwordHash=await hashPassword(password);}catch{throw new AppError(400,"INVALID_ADMIN_PASSWORD","新密碼至少需要 12 個字元");}}try{return provider.redeemAdminInvitation(tokenHash,passwordHash);}catch{throw new AppError(400,"INVALID_ADMIN_INVITATION","邀請碼無效或已使用");}}
};}
module.exports={createOnboardingService,cleanInput,completeness,authorizedPropertyIds};
