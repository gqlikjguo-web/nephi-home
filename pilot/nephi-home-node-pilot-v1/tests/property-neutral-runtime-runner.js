"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createOnboardingService } = require("../lib/onboarding-service");
const { migratePostgres } = require("../lib/providers/postgres-migrate");
const { openPostgres } = require("../lib/providers/postgres-client");
const { createPostgresProviders } = require("../lib/providers/postgres-providers");
const { seedPostgres } = require("../lib/providers/postgres-seed");
const { initialize } = require("../scripts/initialize-render-data");

const ROOT = path.resolve(__dirname, "..");

function submittedApplication(id) {
  return {
    applicationId: id,
    status: "submitted",
    propertyName: "Submitted property",
    rooms: [{ key: "source_room", name: "Submitted room" }],
    bundles: [],
    knowledge: []
  };
}

function onboardingProvider() {
  const properties = [
    {
      propertyId: "property_alpha",
      propertyName: "Property Alpha",
      rooms: [{ id: "alpha_room", name: "Alpha room" }],
      bundles: []
    },
    {
      propertyId: "property_beta",
      propertyName: "Property Beta",
      rooms: [{ id: "beta_room", name: "Beta room" }],
      bundles: []
    },
    {
      propertyId: "property_gamma",
      propertyName: "Property Gamma",
      rooms: [{ id: "gamma_room", name: "Gamma room" }],
      bundles: []
    }
  ];
  const applications = new Map([
    ["approve-alpha", submittedApplication("approve-alpha")],
    ["approve-beta", submittedApplication("approve-beta")],
    ["reject-gamma", submittedApplication("reject-gamma")]
  ]);
  const approved = [];
  return {
    approved,
    isPlatformAdmin() {
      return false;
    },
    listOnboardingProperties(scope) {
      assert.ok(scope && typeof scope === "object", "authorized property scope must be explicit");
      const allowed = new Set(scope.propertyIds || []);
      return scope.all ? properties.slice() : properties.filter((property) => allowed.has(property.propertyId));
    },
    onboardingPropertyExists(propertyId) {
      return properties.some((property) => property.propertyId === propertyId);
    },
    getOnboardingForReview(id) {
      return applications.get(id) || null;
    },
    approveOnboardingExisting(id, propertyId) {
      approved.push({ id, propertyId });
      applications.set(id, { ...applications.get(id), status: "approved" });
      return { applicationId: id, approvalMode: "existing", propertyId };
    }
  };
}

function approvalPayload(propertyId, sourceKey, targetRoomId) {
  return {
    mode: "existing",
    propertyId,
    confirmPropertyId: propertyId,
    roomMappings: [{ sourceKey, targetRoomId }],
    bundleMappings: []
  };
}

function reviewerSession(propertyIds) {
  return {
    userId: "reviewer-user",
    propertyId: propertyIds[0] || "",
    username: "reviewer",
    properties: propertyIds.map((propertyId) => ({ propertyId, username: "reviewer" }))
  };
}

function explicitSeed(propertyId, roomIds, bundleId = "") {
  return {
    property: {
      propertyId,
      displayName: `Property ${propertyId}`,
      currency: "TWD",
      rooms: roomIds.map((id, index) => ({
        id,
        name: `Room ${index + 1}`,
        capacity: 2,
        type: "custom",
        description: "",
        enabled: true
      })),
      settings: {
        currency: "TWD",
        commonAnswers: {},
        pricing: {},
        humanHandoffSituations: [],
        onboarding: { isReady: true }
      },
      faqs: []
    },
    bundles: bundleId ? [{
      id: bundleId,
      name: "Whole property",
      capacity: roomIds.length * 2,
      enabled: true,
      memberRoomIds: roomIds
    }] : [],
    availability: {
      propertyId,
      days: [{
        date: "2026-08-01",
        inventory: Object.fromEntries(roomIds.map((id) => [id, "available"]))
      }]
    }
  };
}

async function insertPropertyGraph(connection, propertyId, roomIds, bundleId = "") {
  const client = await openPostgres(connection);
  try {
    await client.query("INSERT INTO properties(property_id,display_name) VALUES($1,$2)", [propertyId, propertyId]);
    await client.query("INSERT INTO property_settings(property_id,settings) VALUES($1,'{}'::jsonb)", [propertyId]);
    for (let index = 0; index < roomIds.length; index += 1) {
      await client.query(
        "INSERT INTO room_types(property_id,room_id,name,capacity,type,description,position) VALUES($1,$2,$3,2,'custom','',$4)",
        [propertyId, roomIds[index], roomIds[index], index]
      );
    }
    if (bundleId) {
      await client.query(
        "INSERT INTO bundle_offers(property_id,bundle_id,name,capacity,base_price,enabled) VALUES($1,$2,'Whole property',$3,0,true)",
        [propertyId, bundleId, roomIds.length * 2]
      );
      for (let index = 0; index < roomIds.length; index += 1) {
        await client.query(
          "INSERT INTO bundle_offer_members(property_id,bundle_id,room_id,position) VALUES($1,$2,$3,$4)",
          [propertyId, bundleId, roomIds[index], index]
        );
      }
    }
  } finally {
    await client.close();
  }
}

function assertPropertyNeutralRuntimeSource() {
  const runtimeFiles = [
    "lib/onboarding-service.js",
    "lib/friendly-property-import.js",
    "lib/availability-days-import.js",
    "lib/mvp-service.js",
    "lib/json-repository.js",
    "lib/providers/postgres-worker.js",
    "lib/providers/postgres-seed.js",
    "scripts/initialize-render-data.js"
  ];
  const forbidden = /\bnephi_home\b|尼腓|\broom(?:301|302|401|402)\b|["'](?:301|302|401|402)["']/;
  for (const relativePath of runtimeFiles) {
    const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
    assert.doesNotMatch(source, forbidden, `${relativePath} must not contain a property-specific runtime identifier`);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "postgres-seed.json"), "utf8"));
  assert.doesNotMatch(manifest.propertyFile, /nephi/i, "the active seed manifest must use a neutral property fixture");
  assert.doesNotMatch(manifest.availabilityFile, /nephi/i, "the active seed manifest must use neutral availability data");
  const manifestProperty = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", manifest.propertyFile), "utf8"));
  assert.notEqual(manifestProperty.propertyId, "nephi_home", "fixture synchronization must not target the operational property");
  const activeSeed = fs.readFileSync(path.join(ROOT, "fixtures", "seed.json"), "utf8");
  assert.doesNotMatch(activeSeed, /\broom(?:301|302|401|402)\b|(?:301|302|401|402)\s*(?:雙人房|四人房)/, "the JSON fallback seed must not retain legacy room identities");
}

async function run() {
  const provider = onboardingProvider();
  const onboarding = createOnboardingService(provider);
  const authorized = reviewerSession(["property_alpha", "property_beta"]);

  assert.deepEqual(
    onboarding.listProperties({ propertyId: "property_alpha", username: "reviewer" }),
    [],
    "a selected property without server-provided memberships must fail closed"
  );
  assert.deepEqual(
    onboarding.listProperties({ propertyId: "property_alpha", username: "reviewer", properties: [] }),
    [],
    "an empty membership scope must fail closed"
  );
  assert.throws(
    () => onboarding.approve(
      "approve-alpha",
      approvalPayload("property_alpha", "source_room", "alpha_room"),
      { propertyId: "property_alpha", username: "reviewer", properties: [] }
    ),
    (error) => error && error.status === 403 && error.code === "PROPERTY_ACCESS_DENIED",
    "session.propertyId alone must not authorize an existing-property approval"
  );
  assert.deepEqual(
    onboarding.listProperties(authorized).map((property) => property.propertyId),
    ["property_alpha", "property_beta"],
    "the authenticated account scope must drive the property list"
  );
  assert.equal(
    onboarding.approve("approve-alpha", approvalPayload("property_alpha", "source_room", "alpha_room"), authorized).propertyId,
    "property_alpha"
  );
  assert.equal(
    onboarding.approve("approve-beta", approvalPayload("property_beta", "source_room", "beta_room"), authorized).propertyId,
    "property_beta"
  );
  assert.throws(
    () => onboarding.approve("reject-gamma", approvalPayload("property_gamma", "source_room", "gamma_room"), authorized),
    (error) => error && error.status === 403 && error.code === "PROPERTY_ACCESS_DENIED",
    "an existing but unauthorized property must be rejected by authenticated scope"
  );

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "property-neutral-runtime-"));
  const connection = { kind: "pglite", dataDir: path.join(temp, "database") };
  let providers;
  try {
    await migratePostgres(connection);
    await insertPropertyGraph(connection, "property_alpha", ["alpha_one", "alpha_two"], "alpha_bundle");
    await insertPropertyGraph(connection, "property_beta", ["beta_north", "beta_south"], "beta_bundle");
    providers = createPostgresProviders(connection);
    assert.deepEqual(
      providers.onboarding.listOnboardingProperties({ all: false, propertyIds: ["property_alpha", "property_beta"] }).map((property) => property.propertyId),
      ["property_alpha", "property_beta"],
      "the PostgreSQL provider must resolve the explicit authorized property scope"
    );
    assert.deepEqual(
      providers.onboarding.listOnboardingProperties({ all: false, propertyIds: ["property_alpha"] }).map((property) => property.propertyId),
      ["property_alpha"],
      "the PostgreSQL provider must not leak an unlisted property"
    );

    for (const roomId of ["alpha_one", "alpha_two"]) {
      providers.availability.setDay("property_alpha", "2026-08-01", roomId, "available");
    }
    providers.availability.setDay("property_alpha", "2026-08-01", "alpha_bundle", "available");
    for (const roomId of ["beta_north", "beta_south"]) {
      providers.availability.setDay("property_beta", "2026-08-01", roomId, "available");
    }
    providers.availability.setDay("property_beta", "2026-08-01", "beta_bundle", "available");

    const alpha = providers.availability.getRows("property_alpha", "2026-08-01", "2026-08-02")[0];
    const beta = providers.availability.getRows("property_beta", "2026-08-01", "2026-08-02")[0];
    assert.equal(alpha.alpha_bundle, "available");
    assert.equal(beta.beta_bundle, "available");
    assert.equal(Object.hasOwn(alpha, "beta_north"), false);
    assert.equal(Object.hasOwn(beta, "alpha_one"), false);

    assert.throws(
      () => providers.availability.setDay("property_alpha", "2026-08-01", "wholeHouse", "available"),
      /invalid (?:roomId|inventory)/,
      "missing formal bundle mapping must not activate a fixed legacy room set"
    );
  } finally {
    if (providers) await providers.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }

  const seedTemp = fs.mkdtempSync(path.join(os.tmpdir(), "property-neutral-seed-"));
  const seedConnection = { kind: "pglite", dataDir: path.join(seedTemp, "database") };
  let seededProviders;
  try {
    await migratePostgres(seedConnection);
    const alphaSeed = explicitSeed("seed_alpha", ["alpha_seed_room"], "alpha_seed_bundle");
    const betaSeed = explicitSeed("seed_beta", ["beta_seed_room"], "beta_seed_bundle");
    await assert.rejects(
      seedPostgres(seedConnection),
      /explicit seed input is required/,
      "shared seed code must reject a missing property graph"
    );
    assert.equal((await seedPostgres(seedConnection, alphaSeed)).propertyId, "seed_alpha");
    assert.equal((await seedPostgres(seedConnection, betaSeed)).propertyId, "seed_beta");
    assert.equal((await seedPostgres(seedConnection, alphaSeed)).seeded, false, "explicit seed must be idempotent");
    seededProviders = createPostgresProviders(seedConnection);
    assert.deepEqual(
      seededProviders.customerSettings.listBundles("seed_alpha")[0].memberRoomIds,
      ["alpha_seed_room"]
    );
    assert.deepEqual(
      seededProviders.customerSettings.listBundles("seed_beta")[0].memberRoomIds,
      ["beta_seed_room"]
    );
  } finally {
    if (seededProviders) await seededProviders.close();
    fs.rmSync(seedTemp, { recursive: true, force: true });
  }

  const initializationTemp = fs.mkdtempSync(path.join(os.tmpdir(), "property-neutral-initialize-"));
  try {
    const dataFile = path.join(initializationTemp, "store.json");
    const initializerEnvironment = {
      ...process.env,
      NEPHI_PILOT_DATA_FILE: dataFile,
      NEPHI_PILOT_SEED_FILE: path.join(ROOT, "fixtures", "seed.json")
    };
    const missingManifest = spawnSync(process.execPath, ["scripts/initialize-render-data.js"], {
      cwd: ROOT,
      env: initializerEnvironment,
      encoding: "utf8"
    });
    assert.equal(missingManifest.status, 1, "initializer CLI must fail when the manifest argument is absent");
    assert.match(
      `${missingManifest.stdout}\n${missingManifest.stderr}`,
      /initialization manifest is required/,
      "initializer CLI must emit a safe explicit-manifest error"
    );
    assert.throws(
      () => initialize({
        dataFile,
        env: {
          NEPHI_PILOT_DATA_FILE: dataFile,
          NEPHI_PILOT_SEED_FILE: path.join(ROOT, "fixtures", "seed.json")
        }
      }),
      /initialization manifest is required/,
      "initializer must reject a missing explicit manifest"
    );
    const initialized = initialize({
      dataFile,
      manifestFile: "postgres-seed.json",
      env: {
        NEPHI_PILOT_DATA_FILE: dataFile,
        NEPHI_PILOT_SEED_FILE: path.join(ROOT, "fixtures", "seed.json")
      },
      now: () => new Date("2026-07-28T00:00:00.000Z")
    });
    assert.equal(initialized.initialized, true);
    const state = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    const importedPropertyId = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "demo-test-property.json"), "utf8")).propertyId;
    assert.ok(state.homestays.some((property) => property.customerId === importedPropertyId));
    assert.ok(Object.keys(state.availability[importedPropertyId] || {}).length > 0);
    assert.equal(initialize({ dataFile, manifestFile: "postgres-seed.json", env: { NEPHI_PILOT_DATA_FILE: dataFile } }).initialized, false, "initialization must remain idempotent");

    const cliDataFile = path.join(initializationTemp, "cli-store.json");
    const explicitManifest = spawnSync(
      process.execPath,
      ["scripts/initialize-render-data.js", "postgres-seed.json"],
      {
        cwd: ROOT,
        env: { ...initializerEnvironment, NEPHI_PILOT_DATA_FILE: cliDataFile },
        encoding: "utf8"
      }
    );
    assert.equal(explicitManifest.status, 0, explicitManifest.stderr);
    assert.match(explicitManifest.stdout, /RENDER_DATA_INITIALIZED/);
  } finally {
    fs.rmSync(initializationTemp, { recursive: true, force: true });
  }

  assertPropertyNeutralRuntimeSource();
  assert.deepEqual(provider.approved, [
    { id: "approve-alpha", propertyId: "property_alpha" },
    { id: "approve-beta", propertyId: "property_beta" }
  ]);
  console.log("property neutral runtime: PASS");
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
