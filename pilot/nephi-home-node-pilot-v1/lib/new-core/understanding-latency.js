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
module.exports = { monotonicNow, createLatencyClock, emitPreparationLatency };
