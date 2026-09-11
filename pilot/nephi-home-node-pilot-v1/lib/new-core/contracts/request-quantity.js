"use strict";
const {validateSourceEvidence}=require('./source-evidence');
const {validateQuantityFields}=require("../../conversation-contracts/resolver-quantity");
const FIELDS=['requestedQuantity','distinctRequirement','evidenceRefs'];
function validateRequestQuantity(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==FIELDS.length||Object.keys(value).some(k=>!FIELDS.includes(k)))return false;
  return validateQuantityFields(value).ok&&validateSourceEvidence(value.evidenceRefs).ok;
}
module.exports={validateRequestQuantity};
