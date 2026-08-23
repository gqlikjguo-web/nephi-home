"use strict";
const { bootstrapPlatformAdmin } = require("../lib/admin-auth");

function argument(name) { const index=process.argv.indexOf(`--${name}`); return index>=0?String(process.argv[index+1]||"").trim():""; }
function hiddenPrompt(label) {
  return new Promise((resolve,reject)=>{
    if(!process.stdin.isTTY)return reject(new Error("interactive terminal required"));
    let value=""; process.stdout.write(label); process.stdin.setRawMode(true); process.stdin.resume();
    const onData=(chunk)=>{for(const byte of chunk){if(byte===3){cleanup();reject(new Error("cancelled"));return;}if(byte===13||byte===10){cleanup();process.stdout.write("\n");resolve(value);return;}if(byte===8||byte===127){if(value){value=value.slice(0,-1);process.stdout.write("\b \b");}}else{value+=String.fromCharCode(byte);process.stdout.write("*");}}};
    const cleanup=()=>{process.stdin.off("data",onData);process.stdin.setRawMode(false);process.stdin.pause();}; process.stdin.on("data",onData);
  });
}

(async()=>{
  const propertyId=argument("propertyId"),username=argument("username"),email=argument("email");
  if(!process.env.DATABASE_URL||!propertyId||!username||!email)throw new Error("DATABASE_URL, --propertyId, --username and --email are required");
  const password=await hiddenPrompt("密碼："),confirmation=await hiddenPrompt("再次輸入：");
  if(password!==confirmation)throw new Error("passwords do not match");
  await bootstrapPlatformAdmin({databaseUrl:process.env.DATABASE_URL},{propertyId,username,email,password});
  console.log("首位平台管理者已安全建立。");
})().catch((error)=>{console.error(error.message);process.exit(1);});
