'use strict';
const crypto=require('node:crypto');
const {buildPropertyCatalog}=require('./conversation-engine-v2/property-catalog');
const {issueImageReceipt}=require('./property-image-attachments');
function fail(status,message){const error=Error(message);error.status=status;error.code='PROPERTY_IMAGE_ERROR';throw error;}
async function sanitizeImage(content){
 if(!Buffer.isBuffer(content)||!content.length||content.length>8*1024*1024)fail(413,'圖片需小於 8 MB');
 const png=content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const jpeg=content[0]===255&&content[1]===216&&content[2]===255;
 if(!png&&!jpeg)fail(415,'請選擇 JPG 或 PNG 圖片');
 try{
  const sharp=require('sharp'),options={limitInputPixels:20000000,failOn:'warning'};
  const base=sharp(content,options);const metadata=await base.metadata();
  if(!['png','jpeg'].includes(metadata.format)||metadata.pages>1)fail(415,'請選擇一般 JPG 或 PNG 圖片');
  const original=await base.clone().rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:82}).toBuffer();
  const preview=await base.clone().rotate().resize({width:480,height:480,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:75}).toBuffer();
  if(original.length>2097152||preview.length>262144)fail(413,'圖片過大，請縮小後再上傳');
  return {original,preview};
 }catch(error){if(error.status)throw error;fail(400,'圖片無法讀取，請重新選擇 JPG 或 PNG 圖片');}
}
function createPropertyImageStore({db,publicBaseUrl}){
 const origin=new URL(publicBaseUrl).origin;
 function metadata(row){return {sourceId:row.canonical_id,originalContentUrl:`${origin}/media/${row.public_id}/original`,previewImageUrl:`${origin}/media/${row.public_id}/preview`};}
 async function sourceExists(propertyId,sourceId){
  if(typeof sourceId!=='string'||!sourceId||sourceId.length>120)return false;
  const r=await db.query('SELECT p.display_name,s.settings FROM properties p JOIN property_settings s USING(property_id) WHERE p.property_id=$1',[propertyId]);
  if(!r.rows[0])return false;
  const settings=r.rows[0].settings;
  const catalog=buildPropertyCatalog({...settings,propertyId,displayName:r.rows[0].display_name,rooms:[],bundles:[]});
  const sources=[...catalog.amenities,...catalog.policies].filter(x=>x.canonicalId===sourceId);
  return sources.length===1&&sources[0].status!=='unknown'&&Boolean(sources[0].answer);
 }
 return {
  async save(propertyId,sourceId,content){
   if(!await sourceExists(propertyId,sourceId))fail(400,'請先儲存這張卡片的正式說明，再上傳圖片');
   const {original,preview}=await sanitizeImage(content),publicId=crypto.randomBytes(24).toString('base64url');
   const r=await db.query('INSERT INTO property_explanation_images(property_id,canonical_id,public_id,original_content,preview_content) VALUES($1,$2,$3,$4,$5) ON CONFLICT(property_id,canonical_id) DO UPDATE SET public_id=EXCLUDED.public_id,original_content=EXCLUDED.original_content,preview_content=EXCLUDED.preview_content,updated_at=now() RETURNING canonical_id,public_id',[propertyId,sourceId,publicId,original,preview]);
   return metadata(r.rows[0]);
  },
  async list(propertyId){return (await db.query('SELECT canonical_id,public_id FROM property_explanation_images WHERE property_id=$1 ORDER BY canonical_id LIMIT 500',[propertyId])).rows.map(metadata);},
  async remove(propertyId,sourceId){await db.query('DELETE FROM property_explanation_images WHERE property_id=$1 AND canonical_id=$2',[propertyId,sourceId]);return {deleted:true};},
  async publicImage(publicId,variant){
   if(!/^[A-Za-z0-9_-]{32}$/.test(publicId)||!['original','preview'].includes(variant))return null;
   const r=await db.query(`SELECT ${variant==='original'?'original_content':'preview_content'} AS content FROM property_explanation_images WHERE public_id=$1`,[publicId]);
   return r.rows[0]?{content:Buffer.from(r.rows[0].content),contentType:'image/jpeg'}:null;
  },
  async attachments(propertyId,sources){
   const result=[];
   for(const sourceId of [...new Set(sources)].slice(0,4)){
    if(!await sourceExists(propertyId,sourceId))continue;
    const r=await db.query('SELECT canonical_id,public_id FROM property_explanation_images WHERE property_id=$1 AND canonical_id=$2',[propertyId,sourceId]);
    if(r.rows[0])result.push(issueImageReceipt({propertyId,...metadata(r.rows[0])}));
   }
   return result;
  }
 };
}
module.exports={createPropertyImageStore,sanitizeImage,fail};
