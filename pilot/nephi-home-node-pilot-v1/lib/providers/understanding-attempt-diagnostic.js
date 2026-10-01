"use strict";

// Non-authoritative snapshots only. Never used by admission or correction.
// Manual records and terminal production schema-failure payloads may persist
// these snapshots; public safe traces never project them. No response wrapper.
const DENIED_KEY = /(?:api.?key|authorization|cookie|credential|token|secret|pass(?:word|phrase)|headers?|prompt|reasoning|raw|database.?url|private.?notes?)/iu;

function sanitize(value, secret) {
  const counts = { redactedFields: 0, redactedValues: 0, truncated: 0 };
  let nodes = 0;
  function text(value) {
    let output = String(value);
    if (secret) output = output.split(secret).join("[REDACTED]");
    output = output.replace(/\bBearer\s+\S+/giu, "[REDACTED]")
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED]")
      .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/gu, "[REDACTED]")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[REDACTED]")
      .replace(/(?:\+?886[- ]?|0)9\d{2}[- ]?\d{3}[- ]?\d{3}/gu, "[REDACTED]")
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/]+@[^\s]+/giu, "[REDACTED]");
    if (output !== value) counts.redactedValues++;
    if (output.length > 32000) { counts.truncated++; return output.slice(0, 32000) + "[TRUNCATED]"; }
    return output;
  }
  function visit(item, depth = 0) {
    if (++nodes > 30000 || depth > 24) { counts.truncated++; return "[TRUNCATED]"; }
    if (item === undefined) return null;
    if (item === null || typeof item === "boolean" || typeof item === "number") return item;
    if (typeof item === "string") return text(item);
    if (Array.isArray(item)) {
      if (item.length > 200) counts.truncated++;
      return item.slice(0, 200).map(child => visit(child, depth + 1));
    }
    const result = {};
    const entries = Object.entries(item);
    if (entries.length > 200) counts.truncated++;
    for (const [key, child] of entries.slice(0, 200)) {
      // Match the JSON body actually submitted to correction: absent object
      // properties are omitted, while absent array entries serialize as null.
      if (child === undefined) continue;
      if (key !== "rawText" && DENIED_KEY.test(key) || text(key) !== key) {
        counts.redactedFields++;
        result[`[redacted-field-${counts.redactedFields}]`] = "[REDACTED]";
      } else Object.defineProperty(result, key, { value: visit(child, depth + 1), enumerable: true });
    }
    return result;
  }
  return { value: visit(value), capture: counts };
}

function schemaErrorEvidence(violation, output, failures) {
  const failure = (failures || []).find(item => item.boundary === "C02");
  const error = violation || (failure && typeof failure.reason === "object" ? failure.reason : null);
  if (!error && !failure) return null;
  const fieldPath = error?.fieldPath || failure.field || "$";
  const actual = fieldPath === "$" ? output : fieldPath.split(".").reduce((value, key) => value?.[key], output);
  // Preserve the existing validator's rule verbatim; do not run a second schema
  // validator or manufacture a JSON-Schema keyword for a custom C02 predicate.
  const expected = error?.expected || failure.reason;
  return { fieldPath, rule: expected, expected, actual: actual === undefined ? { valueType: "undefined" } : actual,
    validationErrorCode: error?.validationErrorCode || failure.code,
    validatorActual: error?.actual || null };
}

function captureUnderstandingAttempts(entries, reports, acceptedAttempt, secret) {
  try {
    return entries.slice(0, 2).map((entry, index) => {
      const report = reports[index];
      const captured = sanitize({ ...entry,
        attemptNumber: report.attemptNumber, attemptType: report.attemptType,
        validationResult: report.validationResult,
        accepted: report.attemptNumber === acceptedAttempt,
        rejected: report.attemptNumber !== acceptedAttempt,
        adoption: entry.adoption ? { ...entry.adoption,
          // An unadmitted candidate has no validated replacement fields. The
          // admission failure, not that absence, explains its rejection.
          reportedFailure: entry.adoption.rejectionStage === "admission"
            ? report.validationResult.terminalCode || null
            : report.validationResult.adoptionFailure || null } : null
      }, secret);
      return { ...captured.value, capture: captured.capture };
    });
  } catch {
    // Observability failure must never change the existing execution verdict.
    return [{ captureError: "UNDERSTANDING_DIAGNOSTIC_CAPTURE_FAILED" }];
  }
}

function correctedAttemptReceipt(attempts) {
  return attempts.map(entry => ({
    attemptNumber: entry.attemptNumber,
    attemptType: entry.attemptType,
    validationResult: entry.validationResult,
    schemaError: entry.schemaError,
    admissionFailureCode: entry.admissionFailureCode,
    correctionInput: entry.correctionInput ? { failures: entry.correctionInput.failures } : null,
    adoption: entry.adoption,
    accepted: entry.accepted,
    rejected: entry.rejected
  }));
}

function productionUnderstandingFailureEvidence(result) {
  try {
    const attempts = result?.understandingAttempts || result?.artifacts?.understanding?.[
      Symbol.for("junzan.openAiUnderstandingV1ProviderDiagnostic")]?.attemptEvidence;
    if (!Array.isArray(attempts) || attempts.length === 0 || attempts.length > 2) return {};
    const corrected = attempts.length === 2 && attempts[0].accepted === false
      && attempts[0].validationResult?.ok === false && attempts[1].accepted === true
      && attempts[1].validationResult?.ok === true;
    const terminalSchemaFailure = result?.earliestFailure?.layer === "UNDERSTANDING"
      && !attempts.some(entry => entry.accepted === true) && attempts.some(entry => entry.schemaError);
    if (!corrected && !terminalSchemaFailure) return {};
    // Reuse the existing redaction boundary. These are already captured with
    // the provider's exact secret removed; never consult env or a raw response.
    // Successful correction needs the failure/adoption receipt, not either raw
    // output or the previousUnderstandingOutput echoed in the correction body.
    const captured = sanitize(corrected ? correctedAttemptReceipt(attempts) : attempts);
    const diagnostic = { schemaVersion: 1, attempts: captured.value, capture: captured.capture };
    if (Buffer.byteLength(JSON.stringify(diagnostic), "utf8") > 512 * 1024)
      return { understandingFailureDiagnostic: { schemaVersion: 1, captureError: "UNDERSTANDING_DIAGNOSTIC_SIZE_LIMIT" } };
    return { understandingFailureDiagnostic: diagnostic };
  } catch {
    // A diagnostic failure cannot affect admission, persistence or delivery.
    return {};
  }
}

module.exports = { captureUnderstandingAttempts, schemaErrorEvidence, productionUnderstandingFailureEvidence };
