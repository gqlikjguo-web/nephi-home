'use strict';
const {fail}=require('./room-gallery-store');
function readRoomGalleryConfig(env=process.env) {
  const config={accountId:env.ROOM_GALLERY_R2_ACCOUNT_ID,bucket:env.ROOM_GALLERY_R2_BUCKET,accessKeyId:env.ROOM_GALLERY_R2_ACCESS_KEY_ID,secretAccessKey:env.ROOM_GALLERY_R2_SECRET_ACCESS_KEY,publicBaseUrl:env.ROOM_GALLERY_PUBLIC_BASE_URL};
  return Object.values(config).every(x=>typeof x==='string'&&x.trim())?config:null;
}
function createRoomGalleryR2(config,injectedClient) {
  let base;
  try {base=new URL(config.publicBaseUrl);} catch {fail(503,'房間照片尚未啟用');}
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.pathname!=='/'||base.hostname.endsWith('.r2.cloudflarestorage.com'))fail(503,'房間照片需使用正式 HTTPS 圖片網域');
  if(!/^[a-f0-9]{32}$/.test(config.accountId)||! /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket)||!config.accessKeyId||!config.secretAccessKey)fail(503,'房間照片尚未啟用');
  const {S3Client,PutObjectCommand,DeleteObjectCommand}=require('@aws-sdk/client-s3');
  const client=injectedClient||new S3Client({region:'auto',endpoint:`https://${config.accountId}.r2.cloudflarestorage.com`,credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey},maxAttempts:1});
  function key(value){if(typeof value!=='string'||! /^room-photos\/[A-Za-z0-9_-]{32}\/(original|preview)\.jpg$/.test(value))fail(400,'圖片位置不正確');return value;}
  return {
    url:value=>`${base.origin}/${key(value)}`,
    async put(value,body){await client.send(new PutObjectCommand({Bucket:config.bucket,Key:key(value),Body:body,ContentType:'image/jpeg',CacheControl:'no-store'}),{abortSignal:AbortSignal.timeout(30000)});},
    async remove(value){await client.send(new DeleteObjectCommand({Bucket:config.bucket,Key:key(value)}),{abortSignal:AbortSignal.timeout(30000)});},
    close(){client.destroy?.();}
  };
}
module.exports={createRoomGalleryR2,readRoomGalleryConfig};
