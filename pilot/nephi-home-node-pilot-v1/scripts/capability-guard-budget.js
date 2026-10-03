"use strict";
const { insist } = require("./capability-guard-content");
function authorizeReal(budget, context) {
  insist(context.scopeApproved === true, "OWNER_APPROVAL_REQUIRED");
  insist(budget?.mode === "AFFECTED_REAL", "REAL_DEFAULT_DENY");
  insist(context.deterministic === true && context.modelPathChanged === true, "REAL_NOT_ELIGIBLE");
  insist(budget.candidateDigest === context.candidateDigest, "REAL_CANDIDATE_DIGEST_MISMATCH");
  insist(Array.isArray(budget.cases) && budget.cases.length && new Set(budget.cases).size === budget.cases.length, "REAL_CASES_REQUIRED");
  insist(budget.cases.every(id => context.affectedCases.includes(id)), "REAL_OUTSIDE_AFFECTED_CASES");
  insist(Number.isInteger(budget.maxCalls) && budget.maxCalls > 0 && budget.maxCalls <= budget.cases.length * 2, "REAL_CALL_BUDGET");
  insist(Number.isInteger(budget.maxTokens) && budget.maxTokens > 0 && typeof budget.reason === "string" && budget.reason.trim(), "REAL_TOKEN_BUDGET_REQUIRED");
  return true;
}
function validateRealLedger(budget, records) {
  const completed = new Set(), attempts = new Map(); let calls = 0, tokens = 0;
  for (const r of records) {
    insist(budget.cases.includes(r.caseId) && r.candidateDigest === budget.candidateDigest, "REAL_LEDGER_BINDING");
    insist(!completed.has(r.caseId), "COMPLETED_CASE_REPLAY_FORBIDDEN");
    insist(Number.isInteger(r.calls) && r.calls >= 0 && r.calls <= 2, "UNDERSTANDING_CALL_LIMIT");
    insist(Number.isInteger(r.tokens) && r.tokens >= 0, "MISSING_USAGE");
    const prior = attempts.get(r.caseId) || 0;
    insist(r.attempt === prior + 1 && (!prior || typeof r.retryReason === "string" && r.retryReason.trim()), "RETRY_REASON_REQUIRED");
    attempts.set(r.caseId, r.attempt); if (r.completed) completed.add(r.caseId);
    calls += r.calls; tokens += r.tokens;
  }
  insist(calls <= budget.maxCalls && tokens <= budget.maxTokens, "REAL_BUDGET_EXCEEDED");
  return { calls, tokens, cases: [...completed] };
}
function selectRealCases(plan, verification, oracle) {
  insist(plan.modelPathChanged === true, "REAL_NOT_ELIGIBLE");
  const affected = [...new Set([...plan.DIRECTLY_AFFECTED_CAPABILITIES,...plan.TRANSITIVE_AFFECTED_CAPABILITIES])];
  const mapping = verification.realCases, turns = oracle.turns;
  insist(Array.isArray(mapping) && Array.isArray(turns) && mapping.length && new Set(mapping.map(c=>c.id)).size===mapping.length, "REAL_MAPPING_REQUIRED");
  insist(mapping.every(c=>turns.some(t=>t.id===c.id) && Array.isArray(c.capabilities)), "REAL_MAPPING_INVALID");
  insist(affected.length && affected.every(id=>mapping.some(c=>c.capabilities.includes(id))), "REAL_CAPABILITY_UNCOVERED");
  const selected = new Set(mapping.filter(c=>c.capabilities.some(id=>affected.includes(id))).map(c=>c.id));
  const direct = [...selected];
  let added=true;
  while(added){added=false;for(const id of selected){const c=turns.find(t=>t.id===id);insist(c,"REAL_CASE_MISSING");
    if(c.previous && !selected.has(c.previous)){insist(turns.some(t=>t.id===c.previous),"REAL_DEPENDENCY_MISSING");selected.add(c.previous);added=true;}}}
  const ids=turns.filter(t=>selected.has(t.id)).map(t=>t.id);
  for(const c of turns.filter(t=>selected.has(t.id)&&t.previous))insist(ids.indexOf(c.previous)<ids.indexOf(c.id),"REAL_DEPENDENCY_ORDER");
  return {ids,affectedCapabilities:affected.sort(),directCases:direct,prerequisiteCases:ids.filter(id=>!direct.includes(id))};
}
module.exports = { authorizeReal, validateRealLedger, selectRealCases };
