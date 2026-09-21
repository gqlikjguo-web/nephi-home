'use strict';
(() => {
 const lists=new Map();
 async function request(url,options={}){
  const response=await fetch(url,options),body=await response.json();
  if(!response.ok)throw Error(body.error?.message||'圖片未能儲存，請重新選擇圖片');
  return body.data;
 }
 function create(sourceId,propertyId){
  const root=document.createElement('section');root.className='property-image-control';root.setAttribute('aria-label','正式說明圖片');
  const title=document.createElement('strong');title.textContent='說明圖片';
  const preview=document.createElement('img');preview.alt='這則正式說明的圖片';preview.hidden=true;preview.loading='lazy';
  const controls=document.createElement('div');controls.className='property-image-actions';
  const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png';input.hidden=true;
  const upload=document.createElement('button');upload.type='button';upload.textContent='上傳圖片';
  const remove=document.createElement('button');remove.type='button';remove.textContent='刪除圖片';remove.hidden=true;remove.className='secondary';
  const status=document.createElement('small');status.setAttribute('role','status');status.textContent='JPG／PNG，最大 8 MB；請先儲存正式說明。';
  let busy=false,version=0;
  const endpoint='/api/property-images/'+encodeURIComponent(sourceId)+'?propertyId='+encodeURIComponent(propertyId);
  function display(image){preview.hidden=!image;remove.hidden=!image;upload.textContent=image?'更換圖片':'上傳圖片';if(image)preview.src=image.previewImageUrl;else preview.removeAttribute('src');}
  async function change(work,message){
   if(busy)return;busy=true;version++;upload.disabled=true;remove.disabled=true;input.disabled=true;status.textContent='儲存中…';
   try{const image=await work();display(image);lists.delete(propertyId);status.textContent=message;}
   catch(error){status.textContent=error.message||'圖片未能儲存，請再試一次';}
   finally{busy=false;upload.disabled=false;remove.disabled=false;input.disabled=false;input.value='';}
  }
  upload.onclick=()=>input.click();
  input.onchange=()=>{const file=input.files[0];if(!file)return;if(file.size>8*1024*1024){status.textContent='圖片需小於 8 MB';input.value='';return;}
   void change(()=>request(endpoint,{method:'PUT',headers:{'content-type':file.type},body:file}),'圖片已儲存');};
  remove.onclick=()=>void change(async()=>{await request(endpoint,{method:'DELETE'});return null;},'圖片已刪除');
  if(!lists.has(propertyId))lists.set(propertyId,request('/api/property-images?propertyId='+encodeURIComponent(propertyId)).catch(error=>{lists.delete(propertyId);throw error;}));
  lists.get(propertyId).then(data=>{if(version===0)display(data.items.find(x=>x.sourceId===sourceId));}).catch(()=>{if(version===0)status.textContent='圖片暫時無法載入';});
  controls.append(upload,remove,input);root.append(title,preview,controls,status);return root;
 }
 window.PropertyImages=Object.freeze({create});
})();
