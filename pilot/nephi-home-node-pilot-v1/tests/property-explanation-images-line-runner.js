'use strict';
// FAKE_INTEGRATION: signed local webhook, actual core and transport, captured LINE client.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {answer}=require('./custom-arrival-departure-text-runner');
const {attachPropertyScopedLineBinding,waitFor}=require('./helpers/property-scoped-line-webhook');
(async()=>{
 for(const mode of ['bound','absent','foreign','unbound','storage-failure']){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'image-line-')),seedFile=path.join(temp,'seed.json');
  fs.writeFileSync(seedFile,JSON.stringify({testOnly:true,seedDays:1,messageLogs:{image_a:[]},homestays:[{customerId:'image_a',name:'Image Lodge',rooms:[{id:'room',name:'Room',type:'double',capacity:2}]}]}));
  const providers={kind:'json',...require('../lib/providers/json-providers').createJsonProviders({seedFile,dataFile:path.join(temp,'data.json')})};
  const binding=attachPropertyScopedLineBinding({providers,propertyId:'image_a'}),sent=[];
  const image=require('../lib/property-image-attachments').issueImageReceipt({propertyId:mode==='foreign'?'image_b':'image_a',sourceId:mode==='unbound'?'bathroom':'parking',originalContentUrl:'https://media.example.test/original.jpg',previewImageUrl:'https://media.example.test/preview.jpg'});
  const app=require('../server').createApp({providers,enableProductionLineEngine:true,testOnlyEnvironment:false,runtimeEnv:{OPENAI_API_KEY:crypto.randomBytes(24).toString('hex')},lineBindingEnv:binding.lineBindingEnv,conversationDebounceMs:1,
   getPropertyImageStore:async()=>({attachments:async(propertyId,sources)=>{assert.equal(propertyId,'image_a');assert.deepEqual(sources,['parking']);if(mode==='storage-failure')throw Error('synthetic media read failure');return mode==='absent'?[]:[image];}}),
   newCoreProductionExecuteTurn:async args=>answer({...args.property,propertyFacts:[{canonicalId:'parking',category:'policy',publicName:'停車',status:'allowed',publicText:'請將車輛停在指定停車區。'}]},'parking'),
   lineReplyClientFactory:()=>({replyMessageWithHttpInfo:async body=>{sent.push(body);return {httpResponse:{status:200}};}})});
  try{
   const running=await app.start(0,'127.0.0.1');
   const response=await binding.post(running.url,JSON.stringify({events:[{type:'message',webhookEventId:'event',replyToken:'image-reply',timestamp:Date.parse('2026-09-14T04:30:00Z'),source:{type:'user',userId:'guest'},message:{type:'text',id:'message',text:'請問停車說明？'}}]}));
   assert.equal(response.status,200);await waitFor(()=>sent.length===1,5000);
   const expected=[{type:'text',text:'請將車輛停在指定停車區。'}];
   if(mode==='bound')expected.push({type:'image',originalContentUrl:'https://media.example.test/original.jpg',previewImageUrl:'https://media.example.test/preview.jpg'});
   assert.deepEqual(sent[0],{replyToken:'image-reply',messages:expected},mode+' must preserve text and use only validated images in same reply');
  }finally{await app.stop();}
 }
 console.log('PASS same LINE reply text+image, absent/foreign/unbound/failure text-only safety; FAKE_INTEGRATION; OPENAI_CALLS=0; REAL_LINE=NOT_RUN');
})().catch(e=>{console.error(e);process.exitCode=1;});
