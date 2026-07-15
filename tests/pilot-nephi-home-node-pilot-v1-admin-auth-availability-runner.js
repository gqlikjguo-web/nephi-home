"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const root=path.resolve(__dirname,"../pilot/nephi-home-node-pilot-v1");
const {migratePostgres}=require(path.join(root,"lib/providers/postgres-migrate"));
const {seedPostgres}=require(path.join(root,"lib/providers/postgres-seed"));
const {createPostgresProviders}=require(path.join(root,"lib/providers/postgres-providers"));
const {upsertAdminUser}=require(path.join(root,"lib/admin-auth"));
const {createApp}=require(path.join(root,"server"));
const checks=[];function check(name,value){assert.ok(value,name);checks.push(name)}
async function json(url,options={}){const response=await fetch(url,options);return{response,body:await response.json()};}
(async()=>{const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),"nephi-admin-")),connection={kind:"pglite",dataDir};await migratePostgres(connection);await migratePostgres(connection);check("migration 可重複執行",true);await seedPostgres(connection);await upsertAdminUser(connection,{propertyId:"nephi_home",username:"owner",password:"correct horse battery"});
let app=createApp({providers:createPostgresProviders(connection),structuredClassifier:null});let started=await app.start(0,"127.0.0.1"),base=started.url;
let result=await json(`${base}/api/availability/month?customerId=nephi_home&year=2026&month=7`);check("未登入不能讀房況",result.response.status===401);
result=await json(`${base}/api/availability/day`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({customerId:"nephi_home",date:"2026-07-20",roomId:"room301",status:"available"})});check("未登入不能修改房況",result.response.status===401);
result=await json(`${base}/api/admin/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({propertyId:"nephi_home",username:"owner",password:"wrong password"})});check("錯誤密碼拒絕",result.response.status===401);
result=await json(`${base}/api/admin/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({propertyId:"nephi_home",username:"owner",password:"correct horse battery"})});const cookie=result.response.headers.get("set-cookie");check("正確登入成功",result.response.status===200);check("cookie 安全屬性",/HttpOnly/i.test(cookie)&&/Secure/i.test(cookie)&&/SameSite=Strict/i.test(cookie));const headers={cookie};
result=await json(`${base}/api/availability/month?customerId=nephi_home&year=2026&month=7`,{headers});check("登入後讀取 PostgreSQL 房況",result.response.status===200&&result.body.data.rows.length>0);
result=await json(`${base}/api/availability/day`,{method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify({customerId:"nephi_home",date:"2026-07-20",roomId:"room301",status:"available"})});check("修改單日房況",result.response.status===200&&result.body.data.row.room301==="available");
result=await json(`${base}/api/availability/month?customerId=nephi_home&year=2026&month=7`,{headers});check("重新讀取仍保存",result.body.data.rows.find(x=>x.date==="2026-07-20").room301==="available");
result=await json(`${base}/api/availability/search?customerId=nephi_home&checkIn=2026-07-20&checkOut=2026-07-21&guests=2&roomType=301`);check("LINE 查詢讀取相同新房況",result.response.status===200&&result.body.data.rooms.some(x=>x.id==="room301"));
result=await json(`${base}/api/availability/month?customerId=other_home&year=2026&month=7`,{headers});check("propertyId 隔離",result.response.status===403);await app.stop();
app=createApp({providers:createPostgresProviders(connection),structuredClassifier:null});started=await app.start(0,"127.0.0.1");result=await json(`${started.url}/api/availability/month?customerId=nephi_home&year=2026&month=7`,{headers});check("服務重啟後 session 與房況持久",result.response.status===200&&result.body.data.rows.find(x=>x.date==="2026-07-20").room301==="available");await app.stop();console.log(`${checks.length}/${checks.length} PASS`);})().catch(e=>{console.error(e.stack||e);process.exit(1)});
