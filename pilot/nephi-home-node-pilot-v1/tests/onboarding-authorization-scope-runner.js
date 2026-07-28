"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createPostgresProviders } = require("../lib/providers/postgres-providers");
const { upsertAdminUser } = require("../lib/admin-auth");

async function run() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "onboarding-authorization-scope-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "database") };
  let providers;
  try {
    await migratePostgres(connection);
    let client = await openPostgres(connection);
    try {
      await client.query(
        "INSERT INTO properties(property_id,display_name) VALUES($1,$2),($3,$4),($5,$6)",
        ["nephi_home", "Nephi", "property_alpha", "Alpha", "property_beta", "Beta"]
      );
      await client.query(
        "INSERT INTO property_settings(property_id,settings) VALUES($1,'{}'::jsonb),($2,'{}'::jsonb),($3,'{}'::jsonb)",
        ["nephi_home", "property_alpha", "property_beta"]
      );
    } finally {
      await client.close();
    }

    await upsertAdminUser(connection, {
      propertyId: "nephi_home",
      username: "owner",
      password: "nephi-owner-password"
    });
    const alphaIdentity = await upsertAdminUser(connection, {
      propertyId: "property_alpha",
      username: "alpha_owner",
      password: "shared-identity-password",
      email: "shared-owner@example.test"
    });
    await upsertAdminUser(connection, {
      propertyId: "property_beta",
      username: "beta_owner",
      password: "shared-identity-password",
      email: "shared-owner@example.test"
    });

    providers = createPostgresProviders(connection);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    providers.persistence.createAdminSession("legacy-session", "nephi_home", "owner", expiresAt);
    const legacySession = providers.persistence.getAdminSession("legacy-session");
    assert.deepEqual(
      legacySession.properties.map((property) => property.propertyId),
      ["nephi_home"],
      "a legacy login must derive its authorization from the server-side admin membership"
    );
    assert.equal(legacySession.propertyId, "nephi_home", "selected property remains a selection only");

    providers.persistence.createAdminSession(
      "identity-session",
      alphaIdentity.userId,
      "property_alpha",
      "alpha_owner",
      expiresAt
    );
    const identitySession = providers.persistence.getAdminSession("identity-session");
    assert.deepEqual(
      identitySession.properties.map((property) => property.propertyId),
      ["property_alpha", "property_beta"],
      "multi-property identity scope must come from persisted memberships"
    );
    assert.equal(identitySession.platformAdmin, false, "membership alone must not create platform-admin authority");

    await providers.close();
    providers = null;
    client = await openPostgres(connection);
    try {
      await client.query(
        "INSERT INTO platform_admin_grants(property_id,username) VALUES($1,$2)",
        ["property_alpha", "alpha_owner"]
      );
    } finally {
      await client.close();
    }
    providers = createPostgresProviders(connection);
    assert.equal(
      providers.onboarding.isPlatformAdmin("property_alpha", "alpha_owner", alphaIdentity.userId),
      true,
      "platform-admin authority must require an explicit persisted grant"
    );

    console.log(JSON.stringify({ caseCount: 6, passCount: 6, failCount: 0 }));
    console.log("onboarding authorization scope: PASS");
  } finally {
    if (providers) await providers.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
