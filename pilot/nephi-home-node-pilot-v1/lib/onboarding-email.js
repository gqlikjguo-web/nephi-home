"use strict";
function escapeHtml(value){return String(value||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");}
function createOnboardingEmailNotifier({env=process.env,fetchImpl=globalThis.fetch,publicBaseUrl}){
 const apiKey=String(env.RESEND_API_KEY||"").trim(),from=String(env.ONBOARDING_EMAIL_FROM||"JunZan AI <noreply@junzanai.com>").trim(),replyTo=String(env.ONBOARDING_EMAIL_REPLY_TO||"").trim();
 return{configured:Boolean(apiKey),async sendChangeRequest({recipient,propertyName,reason,resumeToken}){const resumeUrl=`${publicBaseUrl}/onboarding?resume=${encodeURIComponent(resumeToken)}`,body={from,to:[recipient],subject:"JunZan AI｜您的旅宿資料需要補件",html:`<!doctype html><html lang="zh-Hant"><body><h1>JunZan AI</h1><p>${escapeHtml(propertyName)}</p><h2>資料已退回補件</h2><p>${escapeHtml(reason)}</p><p><a href="${escapeHtml(resumeUrl)}">安全續填資料</a></p><p>完成修改後，請重新送出審核。</p></body></html>`};if(replyTo)body.reply_to=replyTo;const response=await fetchImpl("https://api.resend.com/emails",{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify(body)});if(!response.ok)throw new Error(`resend_http_${response.status}`);const result=await response.json();return{providerMessageId:String(result.id||"")};}};
}
module.exports={createOnboardingEmailNotifier};
