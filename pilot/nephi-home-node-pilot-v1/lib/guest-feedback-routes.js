'use strict';
const {fail}=require('./guest-feedback-store');
const {sessionTokenHash}=require('./admin-auth');
async function readBody(request){
 if(!String(request.headers['content-type']||'').toLowerCase().startsWith('application/json'))fail(415,'請使用回饋表送出');
 let bytes=0,parts=[];
 for await(const part of request){bytes+=part.length;if(bytes>16384)fail(413,'填寫內容過長');parts.push(part);}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail(400,'表單格式不正確');}
}
function createFeedbackRoutes({getStore,persistence,customerSettings,publicBaseUrl,sendData,sendStatic}){
 // A bounded pre-validation burst guard also protects unknown tokens and malformed POSTs.
 const bursts=new Map();
 function visitor(request){const forwarded=String(request.headers['x-forwarded-for']||'').split(',').at(-1).trim();return (process.env.RENDER==='true'&&require('node:net').isIP(forwarded)?forwarded:request.socket.remoteAddress)||'unknown';}
 function guard(request){const key=visitor(request),now=Date.now();for(const [k,v] of bursts)if(now-v.start>60000)bursts.delete(k);let value=bursts.get(key);if(!value){if(bursts.size>=10000)fail(429,'請稍候再試');value={start:now,count:0};bursts.set(key,value);}if(++value.count>600)fail(429,'送出次數較多，請稍候再試');}
 return async(request,response,url)=>{
  const publicMatch=/^\/api\/public\/feedback\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
  const pageMatch=/^\/(?:feedback|f)\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
  const operatorMatch=/^\/api\/feedback(?:\/(share|summary|[a-f0-9-]{36}))?$/.exec(url.pathname);
  if(!publicMatch&&!pageMatch&&!operatorMatch)return false;
  response.setHeader('referrer-policy','no-referrer');response.setHeader('x-content-type-options','nosniff');
  guard(request);
  if(pageMatch||publicMatch){
   const token=(pageMatch||publicMatch)[1],store=await getStore();
   if(pageMatch){if(request.method!=='GET')fail(405,'不支援此操作');await store.resolve(token);response.setHeader('content-security-policy',"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");sendStatic(response,'feedback.html');return true;}
   if(request.method==='GET'){
    const propertyId=await store.resolve(token),property=customerSettings.getProperty(propertyId);if(!property)fail(404,'找不到此旅宿');
    const rooms=(property.rooms||[]).filter(x=>x.enabled!==false&&x.inventoryType!=='bundle').map(x=>({id:x.id,name:x.displayName||x.name}));
    sendData(response,{propertyName:property.displayName,rooms});return true;
   }
   if(request.method==='POST'){
    const origin=request.headers.origin;if(origin&&origin!==new URL(publicBaseUrl).origin)fail(403,'請從旅宿回饋表送出');
    // Rightmost forwarded hop is supplied by the edge proxy; never use the client-chosen first hop.
    sendData(response,await store.submit(token,await readBody(request),visitor(request)),201);return true;
   }
   fail(405,'不支援此操作');
  }
  const raw=String(request.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('nephi_admin_session='));
  const session=raw?await persistence.getAdminSession(sessionTokenHash(raw.slice('nephi_admin_session='.length))):null;
  if(!session)fail(401,'請先登入');
  const propertyId=session.propertyId;if(!propertyId)fail(409,'請先選擇旅宿');
  if(!Array.isArray(session.properties)||!session.properties.some(x=>x.propertyId===propertyId))fail(403,'無權管理此旅宿');
  for(const key of ['propertyId','customerId'])if(url.searchParams.has(key)&&url.searchParams.get(key)!==propertyId)fail(403,'無權管理其他旅宿');
  const store=await getStore(),part=operatorMatch[1];
  if(request.method==='GET'&&part==='share'){
   const link=new URL('/f/'+await store.shortLink(propertyId),publicBaseUrl).href;
   sendData(response,{url:link,qr:await require('qrcode').toDataURL(link,{errorCorrectionLevel:'M',margin:4,width:280})});return true;
  }
  if(request.method==='GET'&&part==='summary'){sendData(response,await store.summary(propertyId));return true;}
  if(request.method==='GET'&&!part){sendData(response,await store.list(propertyId,Object.fromEntries(url.searchParams)));return true;}
  if(request.method==='PATCH'&&part&&!['share','summary'].includes(part)){
   const origin=request.headers.origin;if(origin&&origin!==new URL(publicBaseUrl).origin)fail(403,'請從業者後台操作');
   const body=await readBody(request);for(const key of ['propertyId','customerId'])if(body?.[key]&&body[key]!==propertyId)fail(403,'無權管理其他旅宿');
   sendData(response,await store.update(propertyId,part,body));return true;
  }
  fail(405,'不支援此操作');
 };
}
module.exports={createFeedbackRoutes};
