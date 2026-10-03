"use strict";
// Readiness only. Never imported by ingress and never returns a runtime/endpoint.
function matchesCanaryScope(scopes, scope) {
  const fields = ["propertyId", "channel", "userId"];
  if (!fields.every(f => typeof scope?.[f] === "string" && scope[f].length)) return false;
  return scopes.filter(s => fields.every(f => typeof s[f] === "string" && s[f].length && s[f] === scope[f])).length === 1;
}
function canaryReadiness(plan = {}) {
  const required = ["verifiedIngressIdentity", "scopePartitionedCoordinator", "scopePartitionedState", "replyOwnerFencing", "exactArtifactRouting", "noCrossPropertyFacts", "independentOwnerApproval"];
  const missing = required.filter(k => plan.evidence?.[k]?.status !== "PASS" || !plan.evidence[k].digest);
  if (plan.enabled !== false) missing.push("ACTIVATION_NOT_AUTHORIZED");
  if (!Array.isArray(plan.ownerScopes) || !plan.ownerScopes.length) missing.push("OWNER_SCOPE_REQUIRED");
  // A JSON assertion is not architecture evidence. This task implements no router.
  return { ok: false, status: "BLOCKED", routingActivated: false, missing,
    reason: "No installed independently verified dual-artifact routing/coordinator/reply fencing; do not switch real customers." };
}
module.exports = { matchesCanaryScope, canaryReadiness };
