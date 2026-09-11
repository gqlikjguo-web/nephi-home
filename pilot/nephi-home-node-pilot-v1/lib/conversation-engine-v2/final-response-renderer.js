"use strict";

const { SAFE_HANDOFF_TEXT } = require("./render-obligation");
function assembleFinalResponse(options = {}) {
  const action=options.finalDecision?.action;
  if(!["reply","clarification","handoff","no_reply"].includes(action))throw new TypeError("final_decision_action_required");
  const layout=require("./render-obligation").coverageLayout(options.responsePlan??null,options);
  return {action,replyText:action==="no_reply"?"":layout.text.slice(0,options.responsePlan?.maxLength||1200),shouldReply:action!=="no_reply"};
}
function buildFinalResponse(options = {}) {
  if (options.preparedResponse) {
    return require("./claim-validator").sealFinalResponse(options.preparedResponse, options.finalValidation);
  }
  const response = assembleFinalResponse(options);
  if (!options.responsePlan?.turnId || !response.shouldReply) return response;
  const { validateClaims, sealFinalResponse } = require("./claim-validator");
  const validation = validateClaims(response.replyText, options.responsePlan,
    options.responsePlan.sections.flatMap(section => section.coveredTaskIds || [section.taskId]), null, options);
  if (!validation.ok) return Object.freeze({ action: response.action, shouldReply: false, replyText: "" });
  return sealFinalResponse(response, validation);
}

module.exports = { SAFE_HANDOFF_TEXT, assembleFinalResponse, buildFinalResponse };
