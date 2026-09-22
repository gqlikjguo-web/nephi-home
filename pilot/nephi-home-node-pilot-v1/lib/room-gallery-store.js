'use strict';
const crypto = require('node:crypto');
const {sanitizeImage} = require('./property-image-store');
const {AppError} = require('./mvp-service');
function fail(status,message) {throw new AppError(status,'ROOM_GALLERY_ERROR',message);}
function createRoomGalleryStore({db,storage,report=code=>console.error(JSON.stringify({scope:'room-gallery',code}))}) {
  async function lockRoom(tx,propertyId,roomId) {
    if(typeof roomId!=='string'||!roomId||roomId.length>200)fail(404,'找不到此房型');
    const r=await tx.query('SELECT room_id FROM room_types WHERE property_id=$1 AND room_id=$2 FOR UPDATE',[propertyId,roomId]);
    if(!r.rows.length)fail(404,'找不到此房型');
  }
  function metadata(r) {
    return {id:r.photo_id,position:r.position,ready:r.ready,originalUrl:r.ready?storage.url(r.original_key):null,previewUrl:r.ready?storage.url(r.preview_key):null};
  }
  async function list(propertyId,roomId,{publicOnly=false}={}) {
    const r=await db.query(`SELECT g.* FROM room_gallery_photos g JOIN room_types r ON r.property_id=g.property_id AND r.room_id=g.room_id WHERE g.property_id=$1 AND g.room_id=$2 ${publicOnly?'AND r.enabled=true AND g.ready=true':''} ORDER BY g.position,g.photo_id LIMIT 10`,[propertyId,roomId]);
    return r.rows.map(metadata);
  }
  async function remove(propertyId,roomId,photoId) {
    // Hide first: if object deletion fails the owner can retry, but guests never
    // receive a partly deleted pair. Metadata retains keys until both are gone.
    const hidden=await db.query('UPDATE room_gallery_photos SET ready=false WHERE property_id=$1 AND room_id=$2 AND photo_id=$3 RETURNING photo_id',[propertyId,roomId,photoId]);
    if(!hidden.rows.length)fail(404,'找不到此照片');
    try {
      await db.transaction(async tx=>{
        const r=await tx.query('SELECT * FROM room_gallery_photos WHERE property_id=$1 AND room_id=$2 AND photo_id=$3 FOR UPDATE',[propertyId,roomId,photoId]);
        if(!r.rows.length)return;
        await storage.remove(r.rows[0].original_key);await storage.remove(r.rows[0].preview_key);
        await tx.query('DELETE FROM room_gallery_photos WHERE property_id=$1 AND room_id=$2 AND photo_id=$3',[propertyId,roomId,photoId]);
      });
    } catch {report('OBJECT_DELETE_FAILED');fail(503,'照片尚未刪除完成，請再按一次刪除');}
    return list(propertyId,roomId);
  }
  async function add(propertyId,roomId,content) {
    // Verify formal ownership before decoding bytes. Lock again for admission.
    await db.transaction(tx=>lockRoom(tx,propertyId,roomId));
    const {original,preview}=await sanitizeImage(content),id=crypto.randomBytes(24).toString('base64url');
    const originalKey=`room-photos/${id}/original.jpg`,previewKey=`room-photos/${id}/preview.jpg`;
    await db.transaction(async tx=>{
      await lockRoom(tx,propertyId,roomId);
      const r=await tx.query('SELECT count(*)::integer count,COALESCE(max(position),-1)+1 position FROM room_gallery_photos WHERE property_id=$1 AND room_id=$2',[propertyId,roomId]);
      if(r.rows[0].count>=10)fail(409,'每個房型最多可放 10 張照片');
      await tx.query('INSERT INTO room_gallery_photos(property_id,room_id,photo_id,original_key,preview_key,position) VALUES($1,$2,$3,$4,$5,$6)',[propertyId,roomId,id,originalKey,previewKey,r.rows[0].position]);
    });
    try {
      await db.transaction(async tx=>{
        await lockRoom(tx,propertyId,roomId);
        const r=await tx.query('SELECT photo_id FROM room_gallery_photos WHERE property_id=$1 AND room_id=$2 AND photo_id=$3 FOR UPDATE',[propertyId,roomId,id]);
        if(!r.rows.length)fail(409,'照片已被刪除，請重新上傳');
        await storage.put(originalKey,original);await storage.put(previewKey,preview);
        await tx.query('UPDATE room_gallery_photos SET ready=true WHERE property_id=$1 AND room_id=$2 AND photo_id=$3',[propertyId,roomId,id]);
      });
    } catch {
      report('OBJECT_UPLOAD_FAILED');
      try {await remove(propertyId,roomId,id);}catch {report('OBJECT_CLEANUP_PENDING');}
      fail(503,'照片上傳未完成，請重新整理後再試；未完成的照片可刪除');
    }
    return list(propertyId,roomId);
  }
  async function reorder(propertyId,roomId,photoIds) {
    if(!Array.isArray(photoIds)||photoIds.length>10||new Set(photoIds).size!==photoIds.length||photoIds.some(x=>typeof x!=='string'||! /^[A-Za-z0-9_-]{32}$/.test(x)))fail(400,'照片排序格式不正確');
    await db.transaction(async tx=>{
      await lockRoom(tx,propertyId,roomId);
      const r=await tx.query('SELECT photo_id FROM room_gallery_photos WHERE property_id=$1 AND room_id=$2',[propertyId,roomId]);
      if(r.rows.length!==photoIds.length||r.rows.some(x=>!photoIds.includes(x.photo_id)))fail(409,'照片已變更，請重新整理後再排序');
      for(let i=0;i<photoIds.length;i++)await tx.query('UPDATE room_gallery_photos SET position=$4 WHERE property_id=$1 AND room_id=$2 AND photo_id=$3',[propertyId,roomId,photoIds[i],i]);
    });
    return list(propertyId,roomId);
  }
  return {list,add,remove,reorder};
}
module.exports={createRoomGalleryStore,fail};
