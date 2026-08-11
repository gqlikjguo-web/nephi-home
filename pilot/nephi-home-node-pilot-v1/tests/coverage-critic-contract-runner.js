"use strict";

const assert = require("node:assert/strict");

let criticModule = null;
try {
  criticModule = require("../lib/providers/test-only-openai-coverage-critic");
} catch (error) {
  if (!error || error.code !== "MODULE_NOT_FOUND") throw error;
}

assert.ok(criticModule, "Coverage Critic provider must exist before its contract can pass");

const {
  TestOnlyOpenAiCoverageCritic,
  COVERAGE_CRITIC_DIAGNOSTIC
} = criticModule;

function response(output) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "req_critic_contract" },
    text: async () => JSON.stringify({ output_text: JSON.stringify(output) })
  };
}

function sourceFixture() {
  const messageText = "Please cover the first request and also the second request.";
  const firstQuote = "the first request";
  const secondQuote = "the second request";
  const firstStart = messageText.indexOf(firstQuote);
  const secondStart = messageText.indexOf(secondQuote);
  return {
    sourceEvents: [{ eventId: "critic-event", messageRef: "critic-message", messageText }],
    coveredRequests: [{
      sourceText: firstQuote,
      evidenceRefs: [{
        eventId: "critic-event",
        messageRef: "critic-message",
        startOffset: firstStart,
        endOffset: firstStart + firstQuote.length,
        quote: firstQuote
      }]
    }],
    missing: {
      eventId: "critic-event",
      messageRef: "critic-message",
      startOffset: secondStart,
      endOffset: secondStart + secondQuote.length,
      quote: secondQuote
    }
  };
}

(async () => {
  const fixture = sourceFixture();
  const bodies = [];
  const critic = new TestOnlyOpenAiCoverageCritic({
    apiKey: "critic-test-key",
    model: "critic-test-model",
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return response({ missingRequests: [fixture.missing] });
    }
  });

  const result = await critic.review({
    sourceEvents: fixture.sourceEvents,
    coveredRequests: fixture.coveredRequests
  }, { callNumber: 2 });

  assert.deepEqual(result.missingRequests, [fixture.missing]);
  assert.equal(bodies.length, 1, "Critic performs exactly one provider call");
  assert.equal(bodies[0].text.format.type, "json_schema");
  assert.equal(bodies[0].text.format.name, "junzan_coverage_critic_v1");
  assert.equal(bodies[0].text.format.strict, true);
  const schema = bodies[0].text.format.schema;
  assert.deepEqual(schema.required, ["missingRequests"]);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.missingRequests.maxItems, 24);
  assert.equal(schema.properties.missingRequests.items.additionalProperties, false);
  assert.deepEqual(schema.properties.missingRequests.items.required, ["eventId", "messageRef", "startOffset", "endOffset", "quote"]);

  const criticInput = JSON.parse(bodies[0].input[1].content[0].text);
  assert.deepEqual(Object.keys(criticInput).sort(), ["coveredRequests", "sourceEvents"]);
  assert.deepEqual(criticInput.sourceEvents, fixture.sourceEvents);
  assert.deepEqual(criticInput.coveredRequests, fixture.coveredRequests);
  for (const forbidden of ["propertyCatalog", "catalog", "price", "availability", "resolver", "postgresql", "finalResponse", "capability"]) {
    assert.equal(JSON.stringify(criticInput).toLowerCase().includes(forbidden.toLowerCase()), false, `Critic input must not contain ${forbidden}`);
  }
  assert.equal(JSON.stringify(bodies[0]).includes("critic-test-key"), false);
  assert.match(bodies[0].input[0].content[0].text, /missing substantive request spans/i);
  assert.match(bodies[0].input[0].content[0].text, /must not choose.*task type/i);
  assert.match(bodies[0].input[0].content[0].text, /must not answer/i);

  const diagnostic = result[COVERAGE_CRITIC_DIAGNOSTIC];
  assert.equal(diagnostic.callNumber, 2);
  assert.equal(diagnostic.resultStatus, "missing_detected");
  assert.equal(diagnostic.reportedMissingSpanCount, 1);

  let emptyCalls = 0;
  const emptyCritic = new TestOnlyOpenAiCoverageCritic({
    apiKey: "critic-test-key",
    model: "critic-test-model",
    fetchImpl: async () => {
      emptyCalls += 1;
      return response({ missingRequests: [] });
    }
  });
  const empty = await emptyCritic.review({ sourceEvents: fixture.sourceEvents, coveredRequests: fixture.coveredRequests }, { callNumber: 2 });
  assert.deepEqual(empty.missingRequests, []);
  assert.equal(emptyCalls, 1);
  assert.equal(empty[COVERAGE_CRITIC_DIAGNOSTIC].resultStatus, "complete");

  let malformedCalls = 0;
  const malformedCritic = new TestOnlyOpenAiCoverageCritic({
    apiKey: "critic-test-key",
    model: "critic-test-model",
    fetchImpl: async () => {
      malformedCalls += 1;
      return response({ missingRequests: "not-an-array" });
    }
  });
  await assert.rejects(
    () => malformedCritic.review({ sourceEvents: fixture.sourceEvents, coveredRequests: fixture.coveredRequests }, { callNumber: 2 }),
    (error) => error && error.code === "coverage_critic_structured_output_error" && error.errorCategory === "structured_output"
  );
  assert.equal(malformedCalls, 1, "Malformed Critic output must not retry");

  let timeoutCalls = 0;
  const timeoutCritic = new TestOnlyOpenAiCoverageCritic({
    apiKey: "critic-test-key",
    model: "critic-test-model",
    fetchImpl: async () => {
      timeoutCalls += 1;
      const error = new Error("timeout");
      error.name = "AbortError";
      throw error;
    }
  });
  await assert.rejects(
    () => timeoutCritic.review({ sourceEvents: fixture.sourceEvents, coveredRequests: fixture.coveredRequests }, { callNumber: 2 }),
    (error) => error && error.code === "coverage_critic_timeout" && error.timeout === true
  );
  assert.equal(timeoutCalls, 1, "Critic timeout must not retry");

  process.stdout.write("Coverage Critic direct contract tests passed.\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
