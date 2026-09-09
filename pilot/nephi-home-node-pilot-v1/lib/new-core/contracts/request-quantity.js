"use strict";
const {validateSourceEvidence}=require('./source-evidence');
const FIELDS=['requestedQuantity','distinctRequirement','evidenceRefs'];
function validateRequestQuantity(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==FIELDS.length||Object.keys(value).some(k=>!FIELDS.includes(k)))return false;
  return Number.isSafeInteger(value.requestedQuantity)&&value.requestedQuantity>=1
    &&['none','distinct_entities'].includes(value.distinctRequirement)&&validateSourceEvidence(value.evidenceRefs).ok;
}
module.exports={validateRequestQuantity};
