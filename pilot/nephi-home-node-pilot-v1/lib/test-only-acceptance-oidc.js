"use strict";

const crypto = require("node:crypto");

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
const TEST_ONLY_ACCEPTANCE_AUDIENCE = "junzan-test-only-acceptance";
const EXPECTED_REPOSITORY = "gqlikjguo-web/nephi-home";
const EXPECTED_REF = "refs/heads/test-only/node-pilot-integration";
const EXPECTED_WORKFLOW_REF = `${EXPECTED_REPOSITORY}/.github/workflows/test-only-ci.yml@${EXPECTED_REF}`;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

function decodeJson(segment) {
  if (!segment || segment.length > 16_384) throw new Error("oidc_segment_invalid");
  const parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("oidc_json_invalid");
  return parsed;
}

function exactClaims(claims, deploymentCommit, nowSeconds) {
  if (claims.iss !== GITHUB_OIDC_ISSUER || claims.aud !== TEST_ONLY_ACCEPTANCE_AUDIENCE) return false;
  if (claims.repository !== EXPECTED_REPOSITORY || claims.ref !== EXPECTED_REF || claims.workflow_ref !== EXPECTED_WORKFLOW_REF) return false;
  if (claims.sha !== deploymentCommit) return false;
  if (![claims.iat, claims.nbf, claims.exp].every(Number.isFinite)) return false;
  if (claims.exp <= nowSeconds || claims.nbf > nowSeconds + 30 || claims.iat > nowSeconds + 30) return false;
  if (claims.exp - claims.iat > 600 || claims.exp <= claims.iat) return false;
  return true;
}

function createGithubActionsOidcVerifier({ deploymentCommit, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const expectedCommit = String(deploymentCommit || "").trim().toLowerCase();
  if (!SHA_PATTERN.test(expectedCommit)) throw new Error("test_only_acceptance_deployment_commit_required");
  if (typeof fetchImpl !== "function") throw new Error("test_only_acceptance_oidc_fetch_required");
  let cachedKeys = null;
  let keysExpireAt = 0;

  async function keys() {
    const current = now().getTime();
    if (cachedKeys && current < keysExpireAt) return cachedKeys;
    const response = await fetchImpl(GITHUB_OIDC_JWKS_URL, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(5000) : undefined
    });
    if (!response || !response.ok) throw new Error("github_oidc_jwks_unavailable");
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.keys)) throw new Error("github_oidc_jwks_invalid");
    cachedKeys = payload.keys.filter((key) => key && key.kty === "RSA" && (!key.use || key.use === "sig") && (!key.alg || key.alg === "RS256"));
    keysExpireAt = current + 5 * 60 * 1000;
    return cachedKeys;
  }

  return async function verifyGithubActionsOidc(token) {
    try {
      const compact = String(token || "");
      if (!compact || compact.length > 32_768) return false;
      const segments = compact.split(".");
      if (segments.length !== 3) return false;
      const header = decodeJson(segments[0]);
      if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid || header.kid.length > 256) return false;
      const jwk = (await keys()).find((candidate) => candidate.kid === header.kid);
      if (!jwk) return false;
      const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
      const signatureValid = crypto.verify("RSA-SHA256", Buffer.from(`${segments[0]}.${segments[1]}`), publicKey, Buffer.from(segments[2], "base64url"));
      if (!signatureValid) return false;
      const claims = decodeJson(segments[1]);
      return exactClaims(claims, expectedCommit, Math.floor(now().getTime() / 1000));
    } catch {
      return false;
    }
  };
}

module.exports = {
  createGithubActionsOidcVerifier,
  GITHUB_OIDC_ISSUER,
  GITHUB_OIDC_JWKS_URL,
  TEST_ONLY_ACCEPTANCE_AUDIENCE,
  EXPECTED_REPOSITORY,
  EXPECTED_REF,
  EXPECTED_WORKFLOW_REF
};
