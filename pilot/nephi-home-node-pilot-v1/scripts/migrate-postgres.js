"use strict";
const {migratePostgres}=require("../lib/providers/postgres-migrate");
const databaseUrl=String(process.env.DATABASE_URL||"").trim();
if(!databaseUrl){console.error("DATABASE_URL is required");process.exit(1);}
migratePostgres({kind:"pg",databaseUrl}).then(()=>console.log("POSTGRES_MIGRATION_COMPLETE")).catch((error)=>{console.error(`POSTGRES_MIGRATION_FAILED ${error.message}`);process.exit(1);});
