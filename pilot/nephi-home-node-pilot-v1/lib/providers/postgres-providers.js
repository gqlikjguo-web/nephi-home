"use strict";
const path=require("node:path");
const {Worker}=require("node:worker_threads");
const {CustomerSettingsProvider,AvailabilityProvider,PersistenceProvider}=require("./contracts");
const AVAILABILITY_READS = new WeakMap();
function availabilityReadEvidenceFor(rows, scope) {
  const record = AVAILABILITY_READS.get(rows);
  if (!record || !scope || record.evidence.propertyId !== scope.propertyId
    || record.evidence.from !== scope.from || record.evidence.to !== scope.to
    || !require("node:util").isDeepStrictEqual(rows, record.snapshot)) return null;
  return record.evidence;
}
function recordAvailabilityRead(rows, args, records) {
    // Issued only after the existing PostgreSQL operation completes. This is
    // read-integrity evidence, not semantic matching or a caller-supplied fact.
    if (Array.isArray(rows)) AVAILABILITY_READS.set(rows, {
      snapshot: structuredClone(rows),
      evidence: Object.freeze({ source: "postgresql.inventory_availability_days", completed: true,
        propertyId: args[0], from: args[1] || null, to: args[2] || null, rowsReturned: rows.length,
        records: Object.freeze(records.map(record => Object.freeze({ ...record }))) })
    });
}
function assertConnection(connection){if(!connection||typeof connection!=="object")throw new Error("postgres connection is required");if(connection.kind==="pglite"){if(!String(connection.dataDir||"").trim())throw new Error("postgres connection is required");return;}if(connection.kind==="pg"&&String(connection.databaseUrl||"").trim())return;throw new Error("postgres connection is required");}
class SyncPostgresRpc{constructor(connection){assertConnection(connection);this.worker=new Worker(path.join(__dirname,"postgres-worker.js"),{workerData:{connection}});this.call("ready",[]);}call(name,args){const signal=new SharedArrayBuffer(8),buffer=new SharedArrayBuffer(4*1024*1024);this.worker.postMessage({name,args,signal,buffer});const status=new Int32Array(signal);const waited=Atomics.wait(status,0,0,30000);if(waited==="timed-out")throw new Error(`postgres provider timeout: ${name}`);const value=JSON.parse(Buffer.from(new Uint8Array(buffer,0,Atomics.load(status,1))).toString("utf8"));if(!value.ok){const error=new Error(value.error);error.stack=value.stack||error.stack;if(value.code)error.code=value.code;if(Number.isInteger(value.status)&&value.status>0)error.status=value.status;throw error;}if(name==="getRows"){if(!Array.isArray(value.result?.rows)||!Array.isArray(value.result?.records))throw new Error("invalid inventory read evidence");recordAvailabilityRead(value.result.rows,args,value.result.records);return value.result.rows;}return value.result;}close(){return this.worker.terminate();}}
class PostgresCustomerSettingsProvider extends CustomerSettingsProvider{constructor(rpc){super();this.rpc=rpc;}listProperties(){return this.rpc.call("listProperties",[]);}getProperty(id){return this.rpc.call("getProperty",[id]);}listRoomRecords(...args){return this.rpc.call("listRoomRecords",args);}updateProperty(...args){return this.rpc.call("updateProperty",args);}updatePropertyProfile(...args){return this.rpc.call("updatePropertyProfile",args);}updateRoomComposition(...args){return this.rpc.call("updateRoomComposition",args);}getRoomComposition(...args){return this.rpc.call("getRoomComposition",args);}updatePropertyFacts(...args){return this.rpc.call("updatePropertyFacts",args);}listBundles(...args){return this.rpc.call("listBundles",args);}createBundle(...args){return this.rpc.call("createBundle",args);}updateBundle(...args){return this.rpc.call("updateBundle",args);}deleteBundle(...args){return this.rpc.call("deleteBundle",args);}updateRoomPricing(...args){return this.rpc.call("updateRoomPricing",args);}updateRoomPricingBatch(...args){return this.rpc.call("updateRoomPricingBatch",args);}setRoomPriceOverride(...args){return this.rpc.call("setRoomPriceOverride",args);}listRoomPriceOverrides(...args){return this.rpc.call("listRoomPriceOverrides",args);}setInventoryPriceOverride(...args){return this.rpc.call("setInventoryPriceOverride",args);}deleteInventoryPriceOverride(...args){return this.rpc.call("deleteInventoryPriceOverride",args);}listInventoryPriceOverrides(...args){return this.rpc.call("listInventoryPriceOverrides",args);}setDatePriceClassification(...args){return this.rpc.call("setDatePriceClassification",args);}deleteDatePriceClassification(...args){return this.rpc.call("deleteDatePriceClassification",args);}listDatePriceClassifications(...args){return this.rpc.call("listDatePriceClassifications",args);}}
class PostgresAvailabilityProvider extends AvailabilityProvider{
  constructor(rpc){super();this.rpc=rpc;}
  getRows(...args){
    const rows = this.rpc.call("getRows",args);
    return rows;
  }
  setDay(...args){return this.rpc.call("setDay",args);}
  getDayNotes(...args){return this.rpc.call("getDayNotes",args);}
  setDayNote(...args){return this.rpc.call("setDayNote",args);}
}
class PostgresPersistenceProvider extends PersistenceProvider{constructor(rpc){super();this.rpc=rpc;}}
class PostgresOnboardingProvider{constructor(rpc){this.rpc=rpc;}}
class PostgresLineBindingProvider{constructor(rpc){this.rpc=rpc;}}
class PostgresCustomRepliesProvider{constructor(rpc){this.rpc=rpc;}}
class PostgresCommercialProvider{constructor(rpc){this.rpc=rpc;}}
class PostgresLineProfileProvider{constructor(rpc){this.rpc=rpc;}}
// Optional display metadata must not Atomics.wait on the request/LINE event thread.
async function profileRpc(rpc,name,input){
  const signal=new SharedArrayBuffer(8),buffer=new SharedArrayBuffer(name==="lineProfile_readNames"?4*1024*1024:64*1024),status=new Int32Array(signal);
  rpc.worker.postMessage({name,args:[input],signal,buffer});
  const waited=await Atomics.waitAsync(status,0,0,1500).value;
  if(waited==="timed-out")throw Error("PROFILE_STORAGE_TIMEOUT");
  const value=JSON.parse(Buffer.from(new Uint8Array(buffer,0,Atomics.load(status,1))).toString("utf8"));
  if(!value.ok)throw Error("PROFILE_STORAGE_UNAVAILABLE");
  return value.result;
}
for(const method of ["observe","claim","finish","readNames"]){PostgresLineProfileProvider.prototype[method]=function(input){return profileRpc(this.rpc,`lineProfile_${method}`,input);};}
for(const method of ["getSubscription","setSubscription","getStatus","setLimit","setAiEnabled","getHandoff","setHandoff","reserve","beginAttempt","finishAttempt","listConversations","getUsage","getHistory","authorizeManual","authorizeOperatorTest"]){PostgresCommercialProvider.prototype[method]=function(...args){return this.rpc.call(`commercial_${method}`,args);};}
for(const method of ["listGuests","createGuest","updateGuest","getGuest","findGuestByLineUserId","listNotes","addNote","updateNote","listMessageLogs","listRecentMessages","findMessageByEventId","claimMessageEvent","updateMessageEvent","appendMessageLog","listGuestMessages","linkMessagesToGuest","getConversationState","setConversationState","deleteConversationState","upsertTestOnlyLineTrace","listTestOnlyLineTraces","createNewCoreTestSession","getNewCoreTestSession","saveNewCoreTestTurn","resetNewCoreTestConversation","listNewCoreTestTurns","reviewNewCoreTestTurn","listNewCoreTestRecords","getNewCoreTestRecordByTraceId","resolveReview","getAdminUser","getAdminIdentityByEmail","listAdminPropertyAccounts","updateAdminIdentityPassword","createAdminSession","getAdminSession","selectAdminProperty","deleteAdminSession"]){PostgresPersistenceProvider.prototype[method]=function(...args){return this.rpc.call(method,args);};}
for(const method of ["createOnboarding","createOnboardingInvitation","resolveOnboardingInvitation","revokeOnboardingInvitation","verifyOnboardingToken","resolveOnboardingResumeToken","rotateOnboardingResumeToken","getOnboarding","getOnboardingForReview","saveOnboarding","addOnboardingAttachment","submitOnboarding","isPlatformAdmin","listOnboarding","listOnboardingProperties","onboardingPropertyExists","getOnboardingMembershipSafety","reviewOnboarding","reopenOnboarding","claimOnboardingEmailDelivery","completeOnboardingEmailDelivery","approveOnboardingExisting","issueAdminSetupInvitationsByEmail","getAdminInvitation","redeemAdminInvitation"]){PostgresOnboardingProvider.prototype[method]=function(...args){return this.rpc.call(method,args);};}
for(const method of ["getLineBindingByPropertyId","getLineBindingByWebhookKey","upsertLineBinding","setLineBindingEnabled","markLineBindingWebhookObserved","recordValidLineWebhook","createLineSetupToken","listLineSetupTokens","getLineSetupTokenByHash","revokeLineSetupToken","redeemLineSetupToken"]){PostgresLineBindingProvider.prototype[method]=function(...args){return this.rpc.call(method,args);};}
for(const method of ["list","create","update","remove"]){PostgresCustomRepliesProvider.prototype[method]=function(...args){return this.rpc.call(`customReplies_${method}`,args);};}
PostgresOnboardingProvider.prototype.approveOnboarding=function(...args){return this.rpc.call("approveOnboardingV2",args);};
function createPostgresProviders(connection){const rpc=new SyncPostgresRpc(connection);return{kind:"postgres",customerSettings:new PostgresCustomerSettingsProvider(rpc),availability:new PostgresAvailabilityProvider(rpc),persistence:new PostgresPersistenceProvider(rpc),onboarding:new PostgresOnboardingProvider(rpc),lineBindings:new PostgresLineBindingProvider(rpc),customReplies:new PostgresCustomRepliesProvider(rpc),commercial:new PostgresCommercialProvider(rpc),lineProfiles:new PostgresLineProfileProvider(rpc),close:()=>rpc.close()};}
module.exports={createPostgresProviders,PostgresCustomerSettingsProvider,PostgresAvailabilityProvider,PostgresPersistenceProvider,PostgresLineBindingProvider,PostgresCustomRepliesProvider,availabilityReadEvidenceFor};
