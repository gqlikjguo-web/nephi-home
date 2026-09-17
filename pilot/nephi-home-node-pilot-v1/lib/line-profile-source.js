"use strict";
const crypto=require('node:crypto');
function stable(value){if(!value||typeof value!=='object')return value;if(Array.isArray(value))return value.map(stable);return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));}
function credentialVersion(row){
  if(!row)return null;
  const property=row.propertyId??row.property_id,key=row.webhookKey??row.webhook_key;
  const secret=row.channelSecretEncrypted??row.channel_secret_encrypted,token=row.channelAccessTokenEncrypted??row.channel_access_token_encrypted;
  if(!property||!key||!secret||!token)return null;
  return crypto.createHash('sha256').update(JSON.stringify(stable([property,key,secret,token]))).digest('hex');
}
function channelForBinding(row){return `line-binding:${crypto.createHash('sha256').update(row.webhookKey??row.webhook_key).digest('hex').slice(0,24)}`;}
module.exports={credentialVersion,channelForBinding};
