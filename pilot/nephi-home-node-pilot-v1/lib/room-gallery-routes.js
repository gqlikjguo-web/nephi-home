'use strict';
const {sessionTokenHash}=require('./admin-auth');
const {resolvePublicProperty}=require('./public-property-routing');
const {fail}=require('./room-gallery-store');
async function readBody(request,limit) {
  const parts=[];let size=0;
  for await(const part of request){size+=part.length;if(size>limit)fail(413,'上傳內容太大');parts.push(part);}
  return Buffer.concat(parts);
}
function createRoomGalleryRoutes({getStore,persistence,customerSettings,publicBaseUrl,sendData}) {
  const origin=new URL(publicBaseUrl).origin,uploads=new Map();let inFlight=0;
  return async(request,response,url)=>{
    const publicPath=url.pathname==='/api/public/room-gallery';
    const match=/^\/api\/room-gallery\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
    if(!publicPath&&!match)return false;
    response.setHeader('cache-control','no-store');response.setHeader('x-content-type-options','nosniff');
    if(publicPath){
      if(request.method!=='GET')fail(405,'不支援此操作');
      const property=resolvePublicProperty(await customerSettings.listProperties(),url.searchParams.get('slug'));
      if(!property)fail(404,'此查房連結無效');
      const roomId=url.searchParams.get('roomId');if(!roomId||roomId.length>200)fail(400,'請選擇房型');
      sendData(response,{items:await(await getStore()).list(property.propertyId,roomId,{publicOnly:true})});return true;
    }
    const cookie=String(request.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('nephi_admin_session='));
    const session=cookie?await persistence.getAdminSession(sessionTokenHash(cookie.slice('nephi_admin_session='.length))):null;
    if(!session)fail(401,'請先登入');
    const propertyId=session.propertyId;
    if(!propertyId)fail(409,'請先選擇旅宿');
    if(!Array.isArray(session.properties)||!session.properties.some(x=>x.propertyId===propertyId))fail(403,'無權管理此旅宿');
    for(const field of ['propertyId','customerId'])if(url.searchParams.has(field)&&url.searchParams.get(field)!==propertyId)fail(403,'旅宿已切換，請重新整理');
    if(request.method!=='GET'&&request.headers.origin!==origin)fail(403,'請從業者後台操作');
    let roomId,action;try{roomId=decodeURIComponent(match[1]);action=match[2]?decodeURIComponent(match[2]):'';}catch{fail(400,'網址格式不正確');}
    if(!roomId||roomId.length>200)fail(400,'請選擇房型');
    const store=await getStore();
    if(request.method==='GET'&&!action){sendData(response,{items:await store.list(propertyId,roomId)});return true;}
    if(request.method==='DELETE'&&action&&action!=='order'){
      if(!/^[A-Za-z0-9_-]{32}$/.test(action))fail(400,'照片格式不正確');
      sendData(response,{items:await store.remove(propertyId,roomId,action)});return true;
    }
    if(request.method==='PUT'&&action==='order'){
      if(String(request.headers['content-type']||'').split(';')[0].trim()!=='application/json')fail(415,'排序格式不正確');
      const body=await readBody(request,8192);let data;try{data=JSON.parse(body.toString('utf8'));}catch{fail(400,'排序格式不正確');}
      if(!data||typeof data!=='object'||Object.keys(data).some(x=>x!=='photoIds'))fail(400,'排序格式不正確');
      sendData(response,{items:await store.reorder(propertyId,roomId,data.photoIds)});return true;
    }
    if(request.method==='POST'&&!action){
      if(!['image/jpeg','image/png'].includes(String(request.headers['content-type']||'').split(';')[0].trim().toLowerCase()))fail(415,'請選擇 JPG 或 PNG 圖片');
      const now=Date.now();for(const [id,entry] of uploads)if(now-entry.start>=600000)uploads.delete(id);
      if(!uploads.has(propertyId)){if(uploads.size>=1000)fail(429,'請稍候再上傳');uploads.set(propertyId,{start:now,count:0});}
      const entry=uploads.get(propertyId);if(entry.count>=60||inFlight>=2)fail(429,'上傳較頻繁，請稍候再試');entry.count++;inFlight++;
      try{sendData(response,{items:await store.add(propertyId,roomId,await readBody(request,8*1024*1024))},201);}finally{inFlight--;}
      return true;
    }
    fail(405,'不支援此操作');
  };
}
module.exports={createRoomGalleryRoutes};
