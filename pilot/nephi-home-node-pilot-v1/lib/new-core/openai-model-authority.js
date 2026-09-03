"use strict";

const NEW_CORE_OPENAI_MODEL = "gpt-5.6-luna";

function assertNewCoreOpenAiModelIdentity(requestedModel, resolvedModel) {
  if (requestedModel !== NEW_CORE_OPENAI_MODEL || resolvedModel !== NEW_CORE_OPENAI_MODEL) {
    const error = new Error("MODEL_IDENTITY_MISMATCH");
    error.code = "MODEL_IDENTITY_MISMATCH";
    throw error;
  }
  return Object.freeze({ requestedModel, resolvedModel });
}

module.exports = {
  NEW_CORE_OPENAI_MODEL,
  assertNewCoreOpenAiModelIdentity
};
