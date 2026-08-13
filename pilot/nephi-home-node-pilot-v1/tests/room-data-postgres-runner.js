"use strict";

const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {migratePostgres}=require("../lib/providers/postgres-migrate");
const {seedNephiPostgres}=require("./helpers/nephi-postgres-seed");
const {createProviders}=require("../lib/providers/provider-factory");
const {openPostgres}=require("../lib/providers/postgres-client");
const {cleanInput}=require("../lib/onboarding-service");

(async()=>{
  const runtime=path.join(__dirname,"../.runtime");fs.mkdirSync(runtime,{recursive:true});
  const temp=fs.mkdtempSync(path.join(runtime,"room-data-pg-")),connection={kind:"pglite",dataDir:path.join(temp,"db")};
  try{
    await migratePostgres(connection);await migratePostgres(connection);await seedNephiPostgres(connection);
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
    const submitted=cleanInput({propertyName:"新旅宿",contactName:"陳小姐",phone:"0900000000",email:"new@example.test",address:"測試地址",googleMapsUrl:"",checkInTime:"15:00",checkOutTime:"11:00",line:{hasOfficialAccount:false,channelId:"legacy-ignored",contactLink:""},rooms:[{key:"main",roomCode:"B7",displayName:"庭院客房",capacity:4,highlights:["庭院","浴缸"],type:"家庭房",mondayThursdayPrice:3000,fridayPrice:3200,saturdayHolidayPrice:3800,sundayPrice:3100,enabled:true}],bundles:[{key:"whole",name:"庭院包棟",memberRoomKeys:["main"],capacity:8,mondayThursdayPrice:7000,fridayPrice:7600,saturdayHolidayPrice:9000,sundayPrice:7200,enabled:true,entertainmentAmenities:[{key:"singing",displayName:"KTV／歡唱設備",provided:true,note:"使用至 22:00",source:"preset",position:0},{key:"bbq",displayName:"烤肉區／烤肉設備",provided:false,note:"不可保存",source:"preset",position:10}]}],knowledge:[]});
    providers.onboarding.createOnboarding(applicationId,"draft-hash");
    providers.onboarding.saveOnboarding(applicationId,submitted);
    providers.onboarding.submitOnboarding(applicationId);
    const review=providers.onboarding.getOnboardingForReview(applicationId);
    assert.deepEqual({roomCode:review.rooms[0].roomCode,displayName:review.rooms[0].displayName,highlights:review.rooms[0].highlights},{roomCode:"B7",displayName:"庭院客房",highlights:["庭院","浴缸"]},"submitted snapshot must preserve all room presentation fields");
    assert.equal(Object.hasOwn(review.line,"channelId"),false,"new snapshots must omit the orphan Channel ID while legacy applications remain readable");
    assert.equal(review.bundles[0].entertainmentAmenities.find(item=>item.key==="singing").note,"使用至 22:00");
    assert.equal(review.bundles[0].entertainmentAmenities.find(item=>item.key==="bbq").note,"");
    providers.onboarding.approveOnboarding(applicationId,"room_data_new","owner","invite-hash",new Date(Date.now()+86400000).toISOString(),"platform","reviewer");
    const materialized=providers.customerSettings.listRoomRecords("room_data_new")[0];
    assert.deepEqual({roomCode:materialized.roomCode,displayName:materialized.displayName,capacity:materialized.capacity,highlights:materialized.highlights},{roomCode:"B7",displayName:"庭院客房",capacity:4,highlights:["庭院","浴缸"]},"approval must materialize the shared property-scoped room record");
    const bundle=providers.customerSettings.listBundles("room_data_new")[0];
    assert.equal(bundle.entertainmentAmenities.find(item=>item.key==="singing").provided,true,"approval must materialize bundle entertainment facts");
    assert.equal(bundle.entertainmentAmenities.find(item=>item.key==="bbq").provided,null,"legacy unchecked remains unknown rather than no");
    assert.equal(providers.customerSettings.getProperty("room_data_new").rooms.find(item=>item.inventoryType==="bundle").entertainmentAmenities.find(item=>item.key==="singing").note,"使用至 22:00","runtime provider must expose the same formal bundle fact");

    await providers.close();console.log("room data PostgreSQL: PASS");
  }finally{fs.rmSync(temp,{recursive:true,force:true})}
})().catch(error=>{console.error(error.stack||error);process.exit(1)});
