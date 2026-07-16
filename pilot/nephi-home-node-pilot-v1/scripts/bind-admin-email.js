"use strict";
const { bindAdminEmail } = require("../lib/admin-auth");

function argument(name) { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? String(process.argv[index + 1] || "").trim() : ""; }

(async () => {
  const propertyId = argument("propertyId"), username = argument("username"), email = argument("email");
  if (!process.env.DATABASE_URL || !propertyId || !username || !email) throw new Error("DATABASE_URL, --propertyId, --username and --email are required");
  await bindAdminEmail({ databaseUrl: process.env.DATABASE_URL }, { propertyId, username, email });
  console.log("後台帳號已完成 Email 綁定；既有密碼未變更。");
})().catch((error) => { console.error(error.message); process.exit(1); });
