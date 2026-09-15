"use strict";
const assert=require("node:assert/strict");
const {setup}=require("./helpers/burst-production-fixture");
(async()=>{
 const x=await setup("latency-trace",{debounce:0});
 try {
  await x.post([x.event("latency")]);await x.done("latency");
  const trace=x.record("latency").safeTrace;
  const timing=trace.filter(e=>e.stage==="new_core_latency");
  assert.deepEqual(timing.map(e=>e.segment),["adapter_preparation","c01_preparation","provider"]);
  const [adapter,c01,provider]=timing;
  assert.ok(adapter.endedMs<=c01.startedMs&&c01.endedMs<=provider.startedMs);
  const inbound=trace.find(e=>e.stage==="line_inbound");
  const send=trace.find(e=>e.stage==="line_transport"&&e.reasonCode==="reply_attempt");
  assert.equal(inbound.monotonicMs,adapter.startedMs);
  assert.ok(send.monotonicMs>=provider.endedMs);
  assert.equal(provider.correctionCalls,0);
  assert.equal(x.record("latency").processingStatus,"reply_succeeded");
  assert.equal(x.core[0].earliestFailure,null);
  console.log("PASS production adapter -> provider -> safe persisted trace -> fake LINE; monotonic correlation");
 }finally{await x.app.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
