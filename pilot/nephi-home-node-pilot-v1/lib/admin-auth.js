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
function normalizeAdminEmail(value) {
  const email = String(value || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("invalid email");
  return { email, normalizedEmail: email.toLowerCase() };
}
async function attachAdminIdentity(client, { propertyId, username, email, passwordHash, replacePassword }) {
  const normalized = normalizeAdminEmail(email);
  let identity = await client.query("SELECT user_id FROM admin_identities WHERE normalized_email=$1", [normalized.normalizedEmail]);
  let userId = identity.rows[0] && identity.rows[0].user_id;
  if (!userId) {
    userId = crypto.randomUUID();
    await client.query("INSERT INTO admin_identities(user_id,email,normalized_email,password_hash) VALUES($1,$2,$3,$4)", [userId, normalized.email, normalized.normalizedEmail, passwordHash]);
  } else if (replacePassword) {
    await client.query("UPDATE admin_identities SET email=$2,password_hash=$3,updated_at=now() WHERE user_id=$1", [userId, normalized.email, passwordHash]);
  }
  await client.query("INSERT INTO admin_user_properties(user_id,property_id,username) VALUES($1,$2,$3) ON CONFLICT(property_id,username) DO UPDATE SET user_id=excluded.user_id", [userId, propertyId, username]);
  return { userId, email: normalized.email };
}
async function upsertAdminUser(connection, { propertyId, username, password, email }) {
  const client = await openPostgres(connection);
  try {
    const passwordHash = await hashPassword(password);
    const normalizedPropertyId = String(propertyId).trim(), normalizedUsername = String(username).trim();
    await client.query("BEGIN");
    try {
      await client.query("INSERT INTO admin_users(property_id,username,password_hash) VALUES($1,$2,$3) ON CONFLICT(property_id,username) DO UPDATE SET password_hash=excluded.password_hash,updated_at=now()", [normalizedPropertyId, normalizedUsername, passwordHash]);
      let identity = email ? await attachAdminIdentity(client, { propertyId: normalizedPropertyId, username: normalizedUsername, email, passwordHash, replacePassword: true }) : null;
      if (!email) {
        const linked = await client.query("SELECT user_id FROM admin_user_properties WHERE property_id=$1 AND username=$2", [normalizedPropertyId, normalizedUsername]);
        if (linked.rows[0]) {
          await client.query("UPDATE admin_identities SET password_hash=$2,updated_at=now() WHERE user_id=$1", [linked.rows[0].user_id, passwordHash]);
          identity = { userId: linked.rows[0].user_id };
        }
      }
      await client.query("COMMIT");
      return { propertyId: normalizedPropertyId, username: normalizedUsername, ...(identity ? { userId: identity.userId, email: identity.email } : {}) };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  } finally { await client.close(); }
}
async function bindAdminEmail(connection, { propertyId, username, email }) {
  const client = await openPostgres(connection);
  try {
    const normalizedPropertyId = String(propertyId).trim(), normalizedUsername = String(username).trim();
    await client.query("BEGIN");
    try {
      const user = await client.query("SELECT password_hash FROM admin_users WHERE property_id=$1 AND username=$2 FOR UPDATE", [normalizedPropertyId, normalizedUsername]);
      if (!user.rows[0]) throw new Error("admin user not found");
      const identity = await attachAdminIdentity(client, { propertyId: normalizedPropertyId, username: normalizedUsername, email, passwordHash: user.rows[0].password_hash, replacePassword: false });
      await client.query("COMMIT");
      return { propertyId: normalizedPropertyId, username: normalizedUsername, userId: identity.userId };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  } finally { await client.close(); }
}
module.exports = { hashPassword, verifyPassword, sessionTokenHash, normalizeAdminEmail, upsertAdminUser, bindAdminEmail };
