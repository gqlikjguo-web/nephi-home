'use strict';
const {fail,createRoomGalleryStore}=require('./room-gallery-store');
const {readRoomGalleryConfig,createRoomGalleryR2}=require('./room-gallery-r2');
function createRoomGalleryRuntime({databaseUrl,env=process.env}) {
  let pending=null,db=null,storage=null;
  return {
    async getStore(){
      const config=readRoomGalleryConfig(env);
      if(!databaseUrl||!config)fail(503,'房間照片尚未啟用');
      if(!pending)pending=(async()=>{
        storage=createRoomGalleryR2(config);
        db=await require('./providers/postgres-client').openPostgres({kind:'pg',databaseUrl});
        return createRoomGalleryStore({db,storage});
      })().catch(error=>{pending=null;storage?.close();storage=null;throw error;});
      return pending;
    },
    async close(){if(pending)await pending.catch(()=>{});if(db)await db.close();storage?.close();}
  };
}
module.exports={createRoomGalleryRuntime};
