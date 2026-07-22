"use strict";

const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {migratePostgres}=require("../lib/providers/postgres-migrate");
const {seedPostgres}=require("../lib/providers/postgres-seed");
const {createProviders}=require("../lib/providers/provider-factory");
const {openPostgres}=require("../lib/providers/postgres-client");
const {cleanInput}=require("../lib/onboarding-service");

(async()=>{
  const runtime=path.join(__dirname,"../.runtime");fs.mkdirSync(runtime,{recursive:true});
  const temp=fs.mkdtempSync(path.join(runtime,"room-data-pg-")),connection={kind:"pglite",dataDir:path.join(temp,"db")};
  try{
    await migratePostgres(connection);await migratePostgres(connection);await seedPostgres(connection);
    const client=await openPostgres(connection);
    await client.query("INSERT INTO properties(property_id,display_name) VALUES('room_data_other','Other')");
    await client.query("INSERT INTO property_settings(property_id,settings) VALUES('room_data_other','{}'::jsonb)");
    await client.query("INSERT INTO room_types(property_id,room_id,name,capacity,type,description,position) VALUES('room_data_other','legacy','Legacy Room',2,'custom','',0)");
    await client.close();

    const providers=createProviders({databaseUrl:"pglite:test",postgresConnection:connection});
    const legacy=providers.customerSettings.listRoomRecords("room_data_other")[0];
    assert.equal(legacy.displayName,"Legacy Room");assert.equal(legacy.roomCode,"");assert.deepEqual(legacy.highlights,[]);

    const original=providers.customerSettings.listRoomRecords("nephi_home")[0];
    providers.customerSettings.updateRoomPricingBatch("nephi_home",[{roomTypeId:original.id,roomCode:"T-1",displayName:"通用房型",capacity:3,highlights:["安靜","採光"],enabled:false,mondayThursdayPrice:2100,fridayPrice:2200,saturdayHolidayPrice:2800,sundayPrice:2150}]);
    const saved=providers.customerSettings.listRoomRecords("nephi_home").find(room=>room.id===original.id);
    assert.deepEqual({roomCode:saved.roomCode,displayName:saved.displayName,capacity:saved.capacity,highlights:saved.highlights,enabled:saved.enabled},{roomCode:"T-1",displayName:"通用房型",capacity:3,highlights:["安靜","採光"],enabled:false});
    assert.equal(providers.customerSettings.listRoomRecords("room_data_other")[0].displayName,"Legacy Room");
    assert.equal(providers.customerSettings.getProperty("nephi_home").rooms.some(room=>room.id===original.id),false);

    const applicationId="room-data-application";
    const submitted=cleanInput({propertyName:"新旅宿",contactName:"陳小姐",phone:"0900000000",email:"new@example.test",address:"測試地址",googleMapsUrl:"",checkInTime:"15:00",checkOutTime:"11:00",line:{hasOfficialAccount:false,channelId:"",contactLink:""},rooms:[{key:"main",roomCode:"B7",displayName:"庭院客房",capacity:4,highlights:["庭院","浴缸"],type:"family",mondayThursdayPrice:3000,fridayPrice:3200,saturdayHolidayPrice:3800,sundayPrice:3100,enabled:true}],bundles:[],knowledge:[]});
    providers.onboarding.createOnboarding(applicationId,"draft-hash");
    providers.onboarding.saveOnboarding(applicationId,submitted);
    providers.onboarding.submitOnboarding(applicationId);
    const review=providers.onboarding.getOnboardingForReview(applicationId);
    assert.deepEqual({roomCode:review.rooms[0].roomCode,displayName:review.rooms[0].displayName,highlights:review.rooms[0].highlights},{roomCode:"B7",displayName:"庭院客房",highlights:["庭院","浴缸"]},"submitted snapshot must preserve all room presentation fields");
    providers.onboarding.approveOnboarding(applicationId,"room_data_new","owner","invite-hash",new Date(Date.now()+86400000).toISOString(),"platform","reviewer");
    const materialized=providers.customerSettings.listRoomRecords("room_data_new")[0];
    assert.deepEqual({roomCode:materialized.roomCode,displayName:materialized.displayName,capacity:materialized.capacity,highlights:materialized.highlights},{roomCode:"B7",displayName:"庭院客房",capacity:4,highlights:["庭院","浴缸"]},"approval must materialize the shared property-scoped room record");

    await providers.close();console.log("room data PostgreSQL: PASS");
  }finally{fs.rmSync(temp,{recursive:true,force:true})}
})().catch(error=>{console.error(error.stack||error);process.exit(1)});
