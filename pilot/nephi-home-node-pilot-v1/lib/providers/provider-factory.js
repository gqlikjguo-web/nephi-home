"use strict";
const {createJsonProviders}=require("./json-providers");
const {createPostgresProviders}=require("./postgres-providers");
function createProviders(options={}){const databaseUrl=String(options.databaseUrl||"").trim();if(!databaseUrl){return{kind:"json",...createJsonProviders(options)};}const connection=options.postgresConnection||{kind:"pg",databaseUrl};return createPostgresProviders(connection);}
module.exports={createProviders};
