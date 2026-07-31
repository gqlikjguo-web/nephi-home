"use strict";
const {seedPostgres,loadSeedManifest}=require("../lib/providers/postgres-seed");
const manifestPath=String(process.argv[2]||"").trim();
const databaseUrl=String(process.env.DATABASE_URL||"").trim();
if(!manifestPath){console.error("SEED_MANIFEST_PATH is required");process.exit(1);}
if(!databaseUrl){console.error("DATABASE_URL is required");process.exit(1);}
let seedInput;
try{seedInput=loadSeedManifest(manifestPath);}catch(error){console.error(`POSTGRES_SEED_FAILED ${error.message}`);process.exit(1);}
seedPostgres({kind:"pg",databaseUrl},seedInput).then((r)=>console.log(r.seeded ? `POSTGRES_SEED_COMPLETE property=${r.propertyId} rooms=${r.roomTypeCount} knowledge=${r.knowledgeItemCount} days=${r.availabilityDayCount}` : `POSTGRES_SEED_SKIPPED property=${r.propertyId}`)).catch((error)=>{console.error(`POSTGRES_SEED_FAILED ${error.message}`);process.exit(1);});
