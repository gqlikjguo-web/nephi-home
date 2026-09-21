"use strict";
// External release admission only. Candidate files are never approval evidence.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), { execFileSync } = require("node:child_process");
const TASK = ".github/core-reliability-task.json";
const POLICY = ".github/core-reliability-policy.json";
const receipts = new WeakMap();
function insist(ok, reason) { if (!ok) throw new Error(reason); }
function digest(value) { return crypto.createHash("sha256").update(Buffer.isBuffer(value) ? value : typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
function git(root, args) { return execFileSync("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }); }
function describe({ root, baseline, candidate, task, policy, context }) {
  insist(/^[a-f0-9]{40}$/.test(baseline) && /^[a-f0-9]{40}$/.test(candidate), "CONTRACT_INVALID_SHA");
  git(root, ["merge-base", "--is-ancestor", baseline, candidate]);
  const changedPaths = git(root, ["diff", "--no-renames", "--name-only", "-z", baseline, candidate]).toString().split("\0").filter(Boolean).sort();
  const protectedPaths = changedPaths.filter(p => policy.protectedPaths.includes(p));
  if (!protectedPaths.length) return null;
  insist(task.contractChangeAllowed === true, "CONTRACT_REQUEST_REQUIRED");
  insist(changedPaths.every(p => p === TASK || protectedPaths.includes(p)) &&
    protectedPaths.every(p => /^(?:pilot\/nephi-home-node-pilot-v1\/)?tests\//.test(p) && !policy.governancePaths.includes(p)) &&
    !changedPaths.some(p => policy.capabilities.some(c => c.paths.some(prefix => p.startsWith(prefix)))), "CONTRACT_ONLY_CHANGE_REQUIRED");
  insist(task.baseline === baseline, "CONTRACT_BASELINE_MISMATCH");
  const authority = policy.contractReview;
  insist(authority && authority.repository === context.repository && context.runAttempt === 1 &&
    Number.isSafeInteger(context.runId) && context.runId > 0 && Number.isSafeInteger(context.pullRequest) && context.pullRequest > 0, "CONTRACT_AUTHORITY_REQUIRED");
  return {
    schemaVersion: 1, repository: context.repository, pullRequest: context.pullRequest,
    runId: context.runId, runAttempt: context.runAttempt, baselineSha: baseline, candidateSha: candidate,
    changedPaths, protectedPaths, taskDigest: digest(task), policyDigest: digest(policy),
    // Hash bytes, including trailing newlines; disable local diff drivers/textconv.
    diffSha256: digest(git(root, ["diff", "--no-ext-diff", "--no-textconv", "--binary", "--full-index", "--no-renames", baseline, candidate, "--"]))
  };
}
async function authorize(descriptor, policy, token) {
  insist(token, "GITHUB_REVIEW_CREDENTIAL_REQUIRED");
  const authority = policy.contractReview;
  insist(authority && descriptor.repository === authority.repository && /^[\w.-]+\/[\w.-]+$/.test(authority.repository) && descriptor.policyDigest === digest(policy), "CONTRACT_AUTHORITY_MISMATCH");
  insist(descriptor.runAttempt === 1 && Number.isSafeInteger(descriptor.runId) && descriptor.runId > 0 && Number.isSafeInteger(descriptor.pullRequest) && descriptor.pullRequest > 0, "CONTRACT_INVALID_RUN");
  async function get(suffix) {
    const response = await fetch(`https://api.github.com/repos/${authority.repository}${suffix}`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" }
    });
    insist(response.ok, "CONTRACT_GITHUB_READ_FAILED");
    return response.json();
  }
  const run = await get(`/actions/runs/${descriptor.runId}`);
  insist(run.id === descriptor.runId && run.run_attempt === 1 && run.event === "pull_request_target" &&
    run.path === authority.workflow && run.head_sha === descriptor.candidateSha && run.repository?.full_name === authority.repository, "CONTRACT_RUN_MISMATCH");
  const pr = await get(`/pulls/${descriptor.pullRequest}`);
  insist(pr.state === "open" && pr.head?.sha === descriptor.candidateSha && pr.head?.repo?.full_name === authority.repository &&
    pr.base?.sha === descriptor.baselineSha && pr.base?.ref === "production", "CONTRACT_PR_MISMATCH");
  const branch = await get("/branches/production");
  insist(branch.commit?.sha === descriptor.baselineSha, "CONTRACT_BASELINE_CHANGED");
  const history = await get(`/actions/runs/${descriptor.runId}/approvals`);
  const prefix = `CONTRACT_CHANGE_APPROVED ${digest(descriptor)} REVIEW_SHA256=`;
  const review = Array.isArray(history) && history.find(r => r.state === "approved" && r.user?.id === authority.reviewerId &&
    r.environments?.some(e => e.id === authority.environmentId && e.name === authority.environment) &&
    typeof r.comment === "string" && r.comment.startsWith(prefix) && /^[a-f0-9]{64}$/.test(r.comment.slice(prefix.length)));
  insist(review, "CONTRACT_APPROVAL_REQUIRED");
  const receipt = Object.freeze({ descriptorDigest: digest(descriptor), candidateSha: descriptor.candidateSha, baselineSha: descriptor.baselineSha,
    runId: descriptor.runId, reviewerId: review.user.id, environmentId: authority.environmentId, independentReviewSha256: review.comment.slice(prefix.length) });
  receipts.set(receipt, structuredClone(descriptor));
  return receipt;
}
function matches(receipt, changed, task, policy) {
  const d = receipt && receipts.get(receipt);
  return Boolean(d && d.taskDigest === digest(task) && d.policyDigest === digest(policy) && d.baselineSha === task.baseline &&
    JSON.stringify(d.changedPaths) === JSON.stringify([...changed].sort()));
}
function describeCli() {
  const root = path.resolve(process.env.CORE_CONTRACT_ROOT || process.cwd());
  const baseline = process.env.BASELINE, candidate = process.env.CANDIDATE;
  insist(/^[a-f0-9]{40}$/.test(baseline) && /^[a-f0-9]{40}$/.test(candidate), "CONTRACT_INVALID_SHA");
  const task = JSON.parse(git(root, ["show", `${candidate}:${TASK}`]));
  const policy = JSON.parse(git(root, ["show", `${baseline}:${POLICY}`]));
  const descriptor = describe({ root, baseline, candidate, task, policy, context: {
    repository: process.env.GITHUB_REPOSITORY, pullRequest: Number(process.env.CORE_CONTRACT_PR), runId: Number(process.env.GITHUB_RUN_ID), runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT)
  } });
  if (!descriptor) return;
  const text = `\n## Explicit Contract-change review required\n\nReview the exact diff and the independent review report before approval.\n\n\`\`\`json\n${JSON.stringify(descriptor, null, 2)}\n\`\`\`\n\nApproval comment: \`CONTRACT_CHANGE_APPROVED ${digest(descriptor)} REVIEW_SHA256=<SHA-256 of independent review evidence>\`\n\nNo matching external review means STOP.\n`;
  insist(process.env.GITHUB_STEP_SUMMARY, "CONTRACT_REVIEW_SUMMARY_REQUIRED");
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  console.log(JSON.stringify({ descriptorDigest: digest(descriptor), ...descriptor }));
}
if (require.main === module) { try { insist(process.argv[2] === "describe", "CONTRACT_INVALID_COMMAND"); describeCli(); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { describe, authorize, matches, digest };
