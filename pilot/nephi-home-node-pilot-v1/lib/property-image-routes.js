'use strict';
const {sessionTokenHash}=require('./admin-auth');
const {fail}=require('./property-image-store');
async function readImage(request){
 if(!['image/jpeg','image/png'].includes(String(request.headers['content-type']||'').split(';')[0].trim().toLowerCase()))fail(415,'請選擇 JPG 或 PNG 圖片');
 const parts=[];let bytes=0;
 for await(const part of request){bytes+=part.length;if(bytes>8*1024*1024)fail(413,'圖片需小於 8 MB');parts.push(part);}
 return Buffer.concat(parts);
}
function createPropertyImageRoutes({getStore,persistence,publicBaseUrl,sendData}){
 const origin=new URL(publicBaseUrl).origin,uploads=new Map();let inFlight=0;
 return async(request,response,url)=>{
  const publicMatch=/^\/media\/([A-Za-z0-9_-]{32})\/(original|preview)$/.exec(url.pathname);
  const adminMatch=/^\/api\/property-images(?:\/([^/]+))?$/.exec(url.pathname);
  if(!publicMatch&&!adminMatch)return false;
  response.setHeader('x-content-type-options','nosniff');response.setHeader('referrer-policy','no-referrer');
  if(publicMatch){
   if(!['GET','HEAD'].includes(request.method))fail(405,'不支援此操作');
   const image=await (await getStore()).publicImage(publicMatch[1],publicMatch[2]);if(!image)fail(404,'找不到此圖片');
   response.writeHead(200,{'content-type':image.contentType,'content-length':image.content.length,'cache-control':'no-store'});
   response.end(request.method==='HEAD'?undefined:image.content);return true;
  }
  const raw=String(request.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('nephi_admin_session='));
  const session=raw?await persistence.getAdminSession(sessionTokenHash(raw.slice('nephi_admin_session='.length))):null;
  if(!session)fail(401,'請先登入');
  const propertyId=session.propertyId;if(!propertyId)fail(409,'請先選擇旅宿');
  if(!Array.isArray(session.properties)||!session.properties.some(x=>x.propertyId===propertyId))fail(403,'無權管理此旅宿');
  for(const key of ['propertyId','customerId'])if(url.searchParams.has(key)&&url.searchParams.get(key)!==propertyId)fail(403,'無權管理其他旅宿');
  if(request.method!=='GET'&&request.headers.origin!==origin)fail(403,'請從業者後台操作');
  const store=await getStore(),sourceId=adminMatch[1]?decodeURIComponent(adminMatch[1]):null;
  if(request.method==='GET'&&!sourceId){sendData(response,{items:await store.list(propertyId)});return true;}
  if(request.method==='DELETE'&&sourceId){sendData(response,await store.remove(propertyId,sourceId));return true;}
  if(request.method==='PUT'&&sourceId){
   const now=Date.now();for(const [key,value] of uploads)if(now-value.start>600000)uploads.delete(key);
   let count=uploads.get(propertyId);if(!count){if(uploads.size>=1000)fail(429,'請稍候再上傳');count={start:now,count:0};uploads.set(propertyId,count);}
   if(count.count>=30||inFlight>=2)fail(429,'上傳較頻繁，請稍候再試');count.count++;inFlight++;
   try{sendData(response,await store.save(propertyId,sourceId,await readImage(request)),201);}finally{inFlight--;}
   return true;
  }
  fail(405,'不支援此操作');
 };
}
module.exports={createPropertyImageRoutes};
