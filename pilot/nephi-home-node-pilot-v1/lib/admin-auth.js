"use strict";
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { openPostgres } = require("./providers/postgres-client");
const scrypt = promisify(crypto.scrypt);

async function hashPassword(password) {
  if (String(password).length < 12) throw new Error("password must contain at least 12 characters");
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
async function verifyPassword(password, encoded) {
  const [, saltHex, hashHex] = String(encoded || "").split("$");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(String(password), Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
function sessionTokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}
async function upsertAdminUser(connection, { propertyId, username, password }) {
  const client = await openPostgres(connection);
  try {
    const passwordHash = await hashPassword(password);
    await client.query("INSERT INTO admin_users(property_id,username,password_hash) VALUES($1,$2,$3) ON CONFLICT(property_id,username) DO UPDATE SET password_hash=excluded.password_hash,updated_at=now()", [String(propertyId).trim(), String(username).trim(), passwordHash]);
    return { propertyId: String(propertyId).trim(), username: String(username).trim() };
  } finally { await client.close(); }
}
module.exports = { hashPassword, verifyPassword, sessionTokenHash, upsertAdminUser };
