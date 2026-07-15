"use strict";
const { upsertAdminUser } = require("../lib/admin-auth");

function argument(name) { const index=process.argv.indexOf(`--${name}`); return index>=0?String(process.argv[index+1]||"").trim():""; }
function hiddenPrompt(label) {
  return new Promise((resolve,reject)=>{
    if(!process.stdin.isTTY)return reject(new Error("interactive terminal required"));
    let value=""; process.stdout.write(label); process.stdin.setRawMode(true); process.stdin.resume();
    const onData=(chunk)=>{for(const byte of chunk){if(byte===3){cleanup();reject(new Error("cancelled"));return;}if(byte===13||byte===10){cleanup();process.stdout.write("\n");resolve(value);return;}if(byte===8||byte===127){if(value){value=value.slice(0,-1);process.stdout.write("\b \b");}}else{value+=String.fromCharCode(byte);process.stdout.write("*");}}};
    const cleanup=()=>{process.stdin.off("data",onData);process.stdin.setRawMode(false);process.stdin.pause();}; process.stdin.on("data",onData);
  });
}
(async()=>{const propertyId=argument("propertyId"),username=argument("username");if(!process.env.DATABASE_URL||!propertyId||!username)throw new Error("DATABASE_URL, --propertyId and --username are required");const password=await hiddenPrompt("新密碼：");const confirmation=await hiddenPrompt("再次輸入：");if(password!==confirmation)throw new Error("passwords do not match");await upsertAdminUser({databaseUrl:process.env.DATABASE_URL},{propertyId,username,password});console.log("後台帳號已安全建立或重設。")})().catch((error)=>{console.error(error.message);process.exit(1);});
