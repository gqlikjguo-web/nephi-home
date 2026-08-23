"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createPostgresProviders } = require("../lib/providers/postgres-providers");
const { bootstrapPlatformAdmin, upsertAdminUser } = require("../lib/admin-auth");

async function database(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `platform-admin-${label}-`));
  const connection = { kind: "pglite", dataDir: path.join(root, "database") };
  await migratePostgres(connection);
  return { root, connection };
}

async function databaseBeforeAuditMigration(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `platform-admin-${label}-`));
  const connection = { kind: "pglite", dataDir: path.join(root, "database") };
  const client = await openPostgres(connection);
  try {
    await client.query("CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const migrationRoot = path.resolve(__dirname, "../migrations");
    for (const filename of fs.readdirSync(migrationRoot).filter((file) => file.endsWith(".sql") && file < "024_platform_admin_bootstrap_audit.sql").sort()) {
      await client.exec(fs.readFileSync(path.join(migrationRoot, filename), "utf8"));
      await client.query("INSERT INTO schema_migrations(filename) VALUES($1)", [filename]);
    }
  } finally {
    await client.close();
  }
  return { root, connection };
}

async function insertProperty(connection, propertyId) {
  const client = await openPostgres(connection);
  try {
    await client.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)", [propertyId, propertyId]);
  } finally {
    await client.close();
  }
}

async function rows(connection, sql, parameters = []) {
  const client = await openPostgres(connection);
  try { return (await client.query(sql, parameters)).rows; }
  finally { await client.close(); }
}

async function firstBootstrapContract() {
  const state = await database("first");
  try {
    await insertProperty(state.connection, "property_alpha");
    const created = await bootstrapPlatformAdmin(state.connection, {
      propertyId: "property_alpha",
      username: "platform_owner",
      email: "platform-owner@example.test",
      password: "platform-owner-password"
    });
    assert.equal(created.propertyId, "property_alpha");
    assert.equal(created.username, "platform_owner");
    assert.ok(created.userId);

    const grants = await rows(state.connection, `
      SELECT g.property_id,g.username,g.created_at,g.granted_user_id,g.granted_email_snapshot,
             m.user_id,i.email
      FROM platform_admin_grants g
      JOIN admin_user_properties m USING(property_id,username)
      JOIN admin_identities i ON i.user_id=m.user_id
    `);
    assert.equal(grants.length, 1);
    assert.equal(grants[0].granted_user_id, created.userId, "grant must retain the identity authorized at bootstrap time");
    assert.equal(grants[0].granted_email_snapshot, "platform-owner@example.test");
    assert.equal(grants[0].user_id, created.userId);
    assert.equal(grants[0].email, "platform-owner@example.test");
    assert.ok(grants[0].created_at);

    await assert.rejects(
      bootstrapPlatformAdmin(state.connection, {
        propertyId: "property_alpha",
        username: "platform_owner",
        email: "platform-owner@example.test",
        password: "platform-owner-password"
      }),
      /platform admin already exists/
    );

    await insertProperty(state.connection, "property_beta");
    const ordinary = await upsertAdminUser(state.connection, {
      propertyId: "property_beta",
      username: "ordinary_owner",
      email: "ordinary-owner@example.test",
      password: "ordinary-owner-password"
    });
    const providers = createPostgresProviders(state.connection);
    try {
      assert.equal(providers.onboarding.isPlatformAdmin("property_beta", "ordinary_owner", ordinary.userId), false);
      assert.equal(providers.onboarding.isPlatformAdmin("property_alpha", "platform_owner", created.userId), true);
    } finally {
      await providers.close();
    }

    await assert.rejects(
      async () => {
        const client = await openPostgres(state.connection);
        try { await client.query("UPDATE platform_admin_grants SET granted_user_id=$1", [ordinary.userId]); }
        finally { await client.close(); }
      },
      /platform admin grant audit is immutable/
    );
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
}

async function concurrentBootstrapContract() {
  const state = await database("concurrent");
  try {
    await insertProperty(state.connection, "property_alpha");
    const input = {
      propertyId: "property_alpha",
      username: "platform_owner",
      email: "platform-owner@example.test",
      password: "platform-owner-password"
    };
    const outcomes = await Promise.allSettled([
      bootstrapPlatformAdmin(state.connection, input),
      bootstrapPlatformAdmin(state.connection, input)
    ]);
    assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1);
    assert.match(String(outcomes.find((item) => item.status === "rejected").reason.message), /platform admin already exists/);
    assert.equal((await rows(state.connection, "SELECT * FROM platform_admin_grants")).length, 1);
    assert.equal((await rows(state.connection, "SELECT * FROM admin_identities")).length, 1);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
}

async function conflictRollbackContract() {
  const state = await database("conflict");
  try {
    await insertProperty(state.connection, "property_alpha");
    await upsertAdminUser(state.connection, {
      propertyId: "property_alpha",
      username: "owner",
      email: "existing-owner@example.test",
      password: "existing-owner-password"
    });
    await assert.rejects(
      bootstrapPlatformAdmin(state.connection, {
        propertyId: "property_alpha",
        username: "owner",
        email: "different-owner@example.test",
        password: "different-owner-password"
      }),
      /membership identity conflict/
    );
    assert.equal((await rows(state.connection, "SELECT * FROM platform_admin_grants")).length, 0);
    assert.equal((await rows(state.connection, "SELECT * FROM admin_identities WHERE normalized_email=$1", ["different-owner@example.test"])).length, 0);

    await assert.rejects(
      bootstrapPlatformAdmin(state.connection, {
        propertyId: "property_alpha",
        username: "owner",
        email: "existing-owner@example.test",
        password: "wrong-existing-password"
      }),
      /invalid existing identity password/
    );
    assert.equal((await rows(state.connection, "SELECT * FROM platform_admin_grants")).length, 0);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
}

async function existingIdentityContract() {
  const state = await database("existing-identity");
  try {
    await insertProperty(state.connection, "property_alpha");
    const identity = await upsertAdminUser(state.connection, {
      propertyId: "property_alpha",
      username: "existing_owner",
      email: "existing-owner@example.test",
      password: "existing-owner-password"
    });
    const bootstrapped = await bootstrapPlatformAdmin(state.connection, {
      propertyId: "property_alpha",
      username: "existing_owner",
      email: "existing-owner@example.test",
      password: "existing-owner-password"
    });
    assert.equal(bootstrapped.userId, identity.userId, "an authenticated existing identity must remain unchanged");
    assert.equal((await rows(state.connection, "SELECT count(*)::int count FROM admin_identities"))[0].count, 1);
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
}

async function migrationCompatibilityContract() {
  const state = await databaseBeforeAuditMigration("migration");
  try {
    await insertProperty(state.connection, "legacy_property");
    const identity = await upsertAdminUser(state.connection, {
      propertyId: "legacy_property",
      username: "legacy_platform",
      email: "legacy-platform@example.test",
      password: "legacy-platform-password"
    });
    const client = await openPostgres(state.connection);
    try {
      await client.query("INSERT INTO platform_admin_grants(property_id,username) VALUES($1,$2)", ["legacy_property", "legacy_platform"]);
    } finally {
      await client.close();
    }
    const migrated = await migratePostgres(state.connection);
    assert.deepEqual(migrated.applied, ["024_platform_admin_bootstrap_audit.sql"]);
    const grant = (await rows(state.connection, "SELECT granted_user_id,granted_email_snapshot FROM platform_admin_grants"))[0];
    assert.equal(grant.granted_user_id, identity.userId);
    assert.equal(grant.granted_email_snapshot, "legacy-platform@example.test");
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true });
  }
}

(async () => {
  await firstBootstrapContract();
  await concurrentBootstrapContract();
  await conflictRollbackContract();
  await existingIdentityContract();
  await migrationCompatibilityContract();
  const cli = fs.readFileSync(path.resolve(__dirname, "../scripts/bootstrap-platform-admin.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
  assert.match(cli, /hiddenPrompt\("密碼："\)/);
  assert.doesNotMatch(cli, /argument\("password"\)/, "the password must never be accepted through argv");
  assert.equal(packageJson.scripts["admin:bootstrap-platform"], "node scripts/bootstrap-platform-admin.js");
  console.log(JSON.stringify({ caseCount: 12, passCount: 12, failCount: 0 }));
  console.log("platform admin bootstrap: PASS");
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
