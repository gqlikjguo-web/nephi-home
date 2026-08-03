"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createGithubActionsOidcVerifier, GITHUB_OIDC_ISSUER, TEST_ONLY_ACCEPTANCE_AUDIENCE } = require("../lib/test-only-acceptance-oidc");

const repository = "gqlikjguo-web/nephi-home";
const ref = "refs/heads/test-only/node-pilot-integration";
const workflowRef = `${repository}/.github/workflows/test-only-ci.yml@${ref}`;
const deploymentCommit = "c56c7df564fed841a65c851b94adc7fa820841f5";
const nowSeconds = 1785800000;
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "acceptance-test-key";
jwk.use = "sig";
jwk.alg = "RS256";

function encode(value) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function tokenFor(overrides = {}, signingKey = privateKey) {
  const header = encode({ alg: "RS256", kid: jwk.kid, typ: "JWT" });
  const payload = encode({
    iss: GITHUB_OIDC_ISSUER,
    aud: TEST_ONLY_ACCEPTANCE_AUDIENCE,
    repository,
    ref,
    workflow_ref: workflowRef,
    sha: deploymentCommit,
    iat: nowSeconds - 5,
    nbf: nowSeconds - 5,
    exp: nowSeconds + 300,
    ...overrides
  });
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), signingKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

(async () => {
  const requested = [];
  const verifier = createGithubActionsOidcVerifier({
    deploymentCommit,
    now: () => new Date(nowSeconds * 1000),
    fetchImpl: async (url) => {
      requested.push(String(url));
      return { ok: true, status: 200, json: async () => ({ keys: [jwk] }) };
    }
  });

  assert.equal(await verifier(tokenFor()), true);
  assert.equal(await verifier(tokenFor({ repository: "attacker/nephi-home" })), false);
  assert.equal(await verifier(tokenFor({ ref: "refs/heads/attacker" })), false);
  assert.equal(await verifier(tokenFor({ workflow_ref: `${repository}/.github/workflows/other.yml@${ref}` })), false);
  assert.equal(await verifier(tokenFor({ sha: "0000000000000000000000000000000000000000" })), false);
  assert.equal(await verifier(tokenFor({ aud: "wrong-audience" })), false);
  assert.equal(await verifier(tokenFor({ iss: "https://example.invalid" })), false);
  assert.equal(await verifier(tokenFor({ exp: nowSeconds - 1 })), false);
  const otherKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  assert.equal(await verifier(tokenFor({}, otherKey)), false);
  assert.ok(requested.length > 0);
  assert.ok(requested.every((url) => url === `${GITHUB_OIDC_ISSUER}/.well-known/jwks`), "only the official GitHub OIDC JWKS endpoint may be used");

  console.log(JSON.stringify({ suite: "test-only-acceptance-oidc", caseCount: 10, passCount: 10, failCount: 0 }));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
