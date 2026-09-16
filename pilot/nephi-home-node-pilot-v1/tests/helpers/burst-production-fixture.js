'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const R=path.resolve(__dirname,'../..');
const {createApp}=require(R+'/server');
const {createJsonProviders}=require(R+'/lib/providers/json-providers');
const {attachPropertyScopedLineBinding,waitFor}=require(R+'/tests/helpers/property-scoped-line-webhook');
const {executeNewCoreTurn}=require(R+'/lib/new-core/application-service');
const {callOpenAIUnderstandingV1}=require(R+'/lib/providers/openai-understanding-v1');
const OUT=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'junzan-burst-contract-'));
const results=[];
function envelope(c01){
 const units=c01.sourceEvents.map((e,i)=>({unitId:c01.turnId+'-unit-'+i,evidenceRefs:[{eventId:e.eventId,messageRef:e.messageRef,startOffset:0,endOffset:e.messageText.length,quote:e.messageText}],purpose:'lodging_question',capability:'policy',subject:{kind:'policy',catalogIdentity:'check_in'},stayDependent:false,temporalCandidate:null,contextLinkCandidateId:'link-'+i,safetyCandidate:null,slotCandidates:[],confidenceBand:'high'}));
 return {understandingOutput:{schemaVersion:1,turnId:c01.turnId,units},contextLinkCandidates:units.map(u=>({contextLinkCandidateId:u.contextLinkCandidateId,unitId:u.unitId,relationKind:'NEW_REQUEST',currentSourceEvidenceRefs:u.evidenceRefs,referencedHistoryEventRefs:[]}))};
}
async function setup(name,{debounce=5,failSend=false,holdEvent=null,testOnly=false,pg=false,acceptance=false,providerResponse}={}){
 const dir=fs.mkdtempSync(OUT+'/'+name+'-');const seed=dir+'/seed.json';
 fs.writeFileSync(seed,JSON.stringify({testOnly:true,seedDays:1,messageLogs:{audit_a:[],audit_b:[]},homestays:['audit_a','audit_b'].map(customerId=>({customerId,name:customerId,safeFacts:{checkInTime:customerId==='audit_a'?'15:00':'16:00'},rooms:[]}))}));
 let providers;
 if(pg){
  const connection={kind:'pglite',dataDir:dir+'/pgdb'};
  await require(R+'/lib/providers/postgres-migrate').migratePostgres(connection);
  const db=await require(R+'/lib/providers/postgres-client').openPostgres(connection);
  for(const id of ['audit_a','audit_b']){await db.query('INSERT INTO properties(property_id,display_name) VALUES($1,$2)',[id,id]);await db.query('INSERT INTO property_settings(property_id,settings) VALUES($1,$2::jsonb)',[id,JSON.stringify({commonAnswers:{checkInTime:id==='audit_a'?'15:00':'16:00'}})]);}
  await db.close();providers=require(R+'/lib/providers/provider-factory').createProviders({databaseUrl:'pglite:audit',postgresConnection:connection});
 }else providers={kind:'json',...createJsonProviders({seedFile:seed,dataFile:dir+'/store.json'})};
 // Isolated core-test precondition: configured AI quota; commercial gate cases override it explicitly.
 if(providers.commercial)for(const property of providers.customerSettings.listProperties())providers.commercial.setLimit(property.propertyId,1000);
 const binding=attachPropertyScopedLineBinding({providers,propertyId:'audit_a'});
 const b=attachPropertyScopedLineBinding({providers,propertyId:'audit_b',encryptionKey:binding.lineBindingEnv.JUNZAN_LINE_CREDENTIAL_ENCRYPTION_KEY});
 const calls=[],sent=[],core=[];let release;const gate=new Promise(r=>release=r);
 const app=createApp({providers,testOnlyEnvironment:testOnly,
  ...(acceptance?{testOnlyAcceptanceEnabled:true,testOnlyAcceptancePropertyId:"audit_a",testOnlyAcceptanceOidcVerifier:async token=>token==="local-test-token",adminAuthRequired:false}:{}),enableProductionLineEngine:true,runtimeEnv:{OPENAI_API_KEY:crypto.randomBytes(24).toString('hex')},lineBindingEnv:binding.lineBindingEnv,openAiTestEnv:{},conversationDebounceMs:debounce,now:()=>new Date('2026-09-11T03:00:00Z'),
  newCoreProductionExecuteTurn:async args=>{
   const c={event:args.input.turnId,scope:args.scope,priorRevision:args.state.revision};calls.push(c);
   const r=await executeNewCoreTurn({...args,understandingProvider:(input,options)=>{c.c01=input;return callOpenAIUnderstandingV1(input,{...options,fetchImpl:async()=>{
    if(args.input.turnId===holdEvent)await gate;
    c.mockCalls=(c.mockCalls||0)+1;
    const payload={model:'gpt-5.6-luna',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(envelope(input))}]}]};
    return {ok:true,status:200,headers:{get:()=> 'audit-request'},text:async()=>JSON.stringify(providerResponse ? providerResponse(payload,c.mockCalls) : payload)};
   }});}});core.push({event:args.input.turnId,earliestFailure:r.earliestFailure,lifecycle:r.lifecycle,state:r.state,decision:r.finalDecision,response:r.finalResponse,claimValidation:r.artifacts.claimValidation});return r;
  },lineReplyClientFactory:()=>({replyMessageWithHttpInfo:async body=>{sent.push(body);if(failSend)throw Object.assign(Error('synthetic LINE outage'),{status:503});return{httpResponse:{status:200}};}})});
 const server=await app.start(0,'127.0.0.1');
 const event=(id,t='2026-09-11T03:00:00Z')=>({type:'message',webhookEventId:id,replyToken:'local-'+id,timestamp:Date.parse(t),source:{type:'user',userId:'audit-user'},message:{type:'text',id:'msg-'+id,text:'請問入住時間？'}});
 const post=async(events,which=binding)=>{const r=await which.post(server.url,JSON.stringify({events}));if(r.status!==200)throw Error('HTTP_'+r.status);};
 const record=(id,property='audit_a')=>providers.persistence.findMessageByEventId(property,id);
 const done=id=>waitFor(()=>['reply_succeeded','reply_failed','final_response_contract_failed','no_reply','processing_failed'].includes(record(id)?.processingStatus),8000);
 return {app,server,providers,binding,b,calls,sent,core,event,post,record,done,release,dir};
}
module.exports={setup};
