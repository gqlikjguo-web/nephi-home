"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { createJsonProviders } = require("../lib/providers/json-providers");

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "health-deployment-identity-"));
  const sensitiveSentinel = ["must", "not", "be", "returned"].join("-");
  const databaseUrlKey = ["DATABASE", "URL"].join("_");
  const providers = createJsonProviders({
    dataFile: path.join(temp, "store.json"),
    seedFile: path.resolve(__dirname, "../fixtures/seed.json")
  });
  const commit = "08f94ed118dc0f880c06d4dab725b1071cc251db";
  const serviceId = "srv-formalhandoff123";
  const app = createApp({
    providers,
    adminAuthRequired: false,
    runtimeEnv: {
      TEST_ONLY_ENVIRONMENT: "false",
      RENDER_SERVICE_ID: serviceId,
      RENDER_SERVICE_NAME: "nephi-home-node-pilot-test-only",
      RENDER_GIT_BRANCH: "test-only/node-pilot-integration",
      RENDER_GIT_COMMIT: commit,
      RENDER_GIT_REPO_SLUG: "gqlikjguo-web/nephi-home",
      [databaseUrlKey]: sensitiveSentinel,
      OPENAI_TEST_API_KEY: sensitiveSentinel
    }
  });

  try {
    const { url } = await app.start(0, "127.0.0.1");
    const response = await fetch(`${url}/api/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, {
      ok: true,
      data: {
        status: "ready",
        testOnly: false,
        commit,
        deployment: {
          serviceId,
          serviceName: "nephi-home-node-pilot-test-only",
          branch: "test-only/node-pilot-integration",
          commit,
          repoSlug: "gqlikjguo-web/nephi-home"
        }
      }
    });
    assert.equal(JSON.stringify(body).includes(sensitiveSentinel), false);
    console.log(JSON.stringify({ caseCount: 2, passCount: 2, failCount: 0 }));
    console.log("health deployment identity: PASS");
  } finally {
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
