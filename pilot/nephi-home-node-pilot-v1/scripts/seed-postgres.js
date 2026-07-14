"use strict";
const {seedPostgres}=require("../lib/providers/postgres-seed");
const databaseUrl=String(process.env.DATABASE_URL||"").trim();
if(!databaseUrl){console.error("DATABASE_URL is required");process.exit(1);}
seedPostgres({kind:"pg",databaseUrl}).then((r)=>console.log(r.seeded ? `POSTGRES_SEED_COMPLETE property=${r.propertyId} rooms=${r.roomTypeCount} knowledge=${r.knowledgeItemCount} days=${r.availabilityDayCount}` : `POSTGRES_SEED_SKIPPED property=${r.propertyId}`)).catch((error)=>{console.error(`POSTGRES_SEED_FAILED ${error.message}`);process.exit(1);});
