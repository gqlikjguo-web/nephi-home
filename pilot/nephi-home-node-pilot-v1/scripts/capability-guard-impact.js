"use strict";
const { insist, hash } = require("./capability-guard-content");
function impact(manifest, baseline, paths, task) {
  const nodes = new Map(manifest.nodes.map(n => [n.id,n]));
  insist(nodes.size === manifest.nodes.length, "DUPLICATE_COMPONENT");
  const byFile = new Map(), caps = new Map(baseline.capabilities.map(c => [c.id,c]));
  for (const n of nodes.values()) {
    insist(n.responsibility && n.authority && Array.isArray(n.forbiddenAuthorities), "COMPONENT_AUTHORITY_MISSING");
    for (const d of n.dependsOn) insist(nodes.has(d), "UNKNOWN_DEPENDENCY");
    for (const c of n.capabilities) insist(caps.has(c), "UNKNOWN_CAPABILITY");
    for (const f of n.files) { insist(!byFile.has(f), "MULTIPLE_COMPONENT_AUTHORITIES"); byFile.set(f,n.id); }
  }
  const unknown = paths.filter(p => !byFile.has(p) && !manifest.nonRuntimePaths.includes(p));
  insist(!unknown.length, "UNMAPPED_COMPONENT: " + unknown.join(","));
  const outside = paths.filter(p => !task.allowedPaths.includes(p));
  insist(!outside.length, "OUT_OF_SCOPE: " + outside.join(","));
  const runtime = paths.filter(p => byFile.has(p));
  insist(runtime.every(p => task.impact?.safeModificationPoints?.includes(p)), "OUTSIDE_SAFE_POINT");
  insist(runtime.every(p => task.impact?.authorities?.includes(nodes.get(byFile.get(p)).authority)), "UNAPPROVED_AUTHORITY");
  const direct = new Set(runtime.map(p => byFile.get(p))), closure = new Set(direct);
  let added = true;
  while (added) { added = false; for (const n of nodes.values()) if (!closure.has(n.id) && n.dependsOn.some(d => closure.has(d))) { closure.add(n.id); added = true; } }
  const directCaps = new Set([...direct].flatMap(id => nodes.get(id).capabilities));
  const allCaps = new Set([...closure].flatMap(id => nodes.get(id).capabilities));
  const runners = [...new Set([...allCaps].flatMap(id => caps.get(id).runners))].sort();
  return { CHANGED_COMPONENTS: [...direct].sort(), TRANSITIVE_COMPONENTS: [...closure].filter(n => !direct.has(n)).sort(),
    DIRECTLY_AFFECTED_CAPABILITIES: [...directCaps].sort(), TRANSITIVE_AFFECTED_CAPABILITIES: [...allCaps].filter(c => !directCaps.has(c)).sort(),
    OUT_OF_SCOPE_FILES: [], requiredBaselineRunners: runners, modelPathChanged: [...direct].some(id => (manifest.modelChangeAuthorities || []).includes(nodes.get(id).authority)),
    manifestDigest: hash(manifest), classification: "STRUCTURED_CONTRACT_TEST" };
}
function requiredRunners(plan, verification, redRunners = []) {
  insist(redRunners.every(r => typeof r === "string" && r.startsWith("tests/") && r.endsWith(".js") && !r.includes("..")), "INVALID_RED_RUNNER");
  return [...new Set([...redRunners, ...plan.requiredBaselineRunners, ...verification.always, ...verification.coreRegression, ...verification.finalChecks])];
}
function verifyEvidence(report, digest, required) {
  insist(report.status === "PASS", "GATE_NOT_PASS");
  insist(report.candidateDigest === digest, "CANDIDATE_DIGEST_MISMATCH");
  insist(report.openAiCalls === 0, "OFFLINE_PROVIDER_CALL");
  insist(report.results?.length === required.length && new Set(report.results.map(r => r.id)).size === required.length, "INCOMPLETE_RESULT_SET");
  for (const id of required) {
    const r = report.results.find(x => x.id === id);
    insist(r && r.status === "PASS" && r.exitCode === 0 && r.candidateDigest === digest && typeof r.log === "string" && hash(r.log) === r.logSha256, "INVALID_RUNNER_EVIDENCE: " + id);
  }
  return true;
}
module.exports = { impact, requiredRunners, verifyEvidence };
