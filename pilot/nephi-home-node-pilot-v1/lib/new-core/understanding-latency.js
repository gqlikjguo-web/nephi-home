"use strict";
const { performance } = require("node:perf_hooks");
const monotonicNow = () => performance.now();
function createLatencyClock(now = monotonicNow) {
  const startedMs = now();
  let last = startedMs, phase = "prep";
  const totals = new Map([["prep",0],["openai",0],["validation",0],["other",0]]);
  function sample(next) {
    const at = now();
    totals.set(phase, totals.get(phase) + at - last);
    last = at; phase = next;
    return at;
  }
  return {
    enter(next) { sample(next); },
    finish() {
      const endedMs = sample(phase);
      return { startedMs, endedMs, prepMs:totals.get("prep"), openaiMs:totals.get("openai"),
        validationMs:totals.get("validation"), otherMs:totals.get("other"), totalMs:endedMs-startedMs };
    }
  };
}
function emitPreparationLatency(sink, traceId, segment, startedMs) {
  const endedMs = monotonicNow();
  if (typeof sink === "function") {
    try { sink({ traceId, stage:"new_core_latency", segment, startedMs, endedMs, durationMs:endedMs-startedMs }); }
    catch { /* Timing cannot affect processing. */ }
  }
}

// Observational metadata only: never retain the supplied request or credential.
function createTransportObservation({ requestStartedAtMs, signal, apiKey }) {
  const value = { schemaVersion: 1, requestStartedAtMs, fetchStartedAtMs: null,
    headersReceivedAtMs: null, bodyCompletedAtMs: null, abortTriggeredAtMs: null,
    timeoutStage: null, clientRequestId: null, providerRequestId: null, httpStatus: null, sizes: {} };
  let phase = "preparation";
  const observe = work => { try { work(); } catch { value.diagnosticUnavailable = true; } };
  const aborted = () => observe(() => { value.abortTriggeredAtMs = Date.now(); value.timeoutStage = phase; });
  observe(() => signal.addEventListener("abort", aborted, { once: true }));
  const bytes = item => Buffer.byteLength(typeof item === "string" ? item : JSON.stringify(item), "utf8");
  return {
    request(clientRequestId, body) { observe(() => {
      value.clientRequestId = clientRequestId === apiKey ? null : clientRequestId;
      const request = JSON.parse(body), inputText = request.input[1].content[0].text;
      const input = JSON.parse(inputText);
      value.sizes.requestBodyBytes = bytes(body);
      value.sizes.modelInputBytes = bytes(request.input);
      value.sizes.understandingInputBytes = bytes(inputText);
      value.sizes.schemaBytes = bytes(request.text.format.schema);
      value.sizes.instructionsBytes = bytes(request.input[0].content[0].text);
      value.sizes.correctionBytes = request.input.length > 2 ? bytes(request.input.slice(2)) : 0;
      value.sizes.sourceEventsCount = input.sourceEvents.length;
      value.sizes.sourceEventsBytes = bytes(input.sourceEvents);
      value.sizes.historyCount = input.recentConversation.length;
      value.sizes.historyBytes = bytes(input.recentConversation);
      value.sizes.capabilityCatalogCount = input.capabilityCatalog.length;
      value.sizes.capabilityCatalogBytes = bytes(input.capabilityCatalog);
      value.sizes.subjectCatalogCount = input.publicSubjectCatalog.length;
      value.sizes.subjectCatalogBytes = bytes(input.publicSubjectCatalog);
      const summaries = input.recentConversation.flatMap(event => event.referenceableRequestSummaries || []);
      value.sizes.contextSummaryCount = summaries.length; value.sizes.contextSummaryBytes = bytes(summaries);
    }); },
    mark(stage) { observe(() => {
      if (stage === "fetch") { phase = "fetch"; value.fetchStartedAtMs = Date.now(); }
      else if (stage === "headers") { phase = "body"; value.headersReceivedAtMs = Date.now(); }
      else if (stage === "body") { phase = "parse"; value.bodyCompletedAtMs = Date.now(); }
      else if (["commercial_admission", "validation"].includes(stage)) phase = stage;
    }); },
    response(httpStatus, providerRequestId) { observe(() => {
      value.httpStatus = httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null;
      value.providerRequestId = typeof providerRequestId === "string"
        && /^req[-_][A-Za-z0-9_-]{1,160}$/.test(providerRequestId)
        && (!apiKey || !providerRequestId.includes(apiKey)) ? providerRequestId : null;
    }); },
    snapshot() { return { ...value, sizes: { ...value.sizes } }; },
    close() { observe(() => signal.removeEventListener("abort", aborted)); }
  };
}

module.exports = { monotonicNow, createLatencyClock, emitPreparationLatency, createTransportObservation };
