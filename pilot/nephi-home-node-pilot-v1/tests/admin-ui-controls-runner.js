'use strict';
// STRUCTURED_CONTRACT_TEST: UI wiring only; persistence is covered by existing component tests.
const assert=require('node:assert/strict'),fs=require('node:fs');
const read=p=>fs.readFileSync(__dirname+'/../public/'+p,'utf8');
const html=read('admin.html'),ai=read('assets/admin-ai-controls.js'),rooms=read('assets/admin-room-composition.js'),pricing=read('assets/admin.js');
assert.ok(html.includes('/assets/admin-controls.css'),'shared accessible control styles must be loaded');
const css=read('assets/admin-controls.css');
assert.match(css,/admin-toggle/);assert.match(css,/admin-choice-row/);assert.match(css,/admin-confirmation-row/);
assert.match(ai,/quotaProgress/);assert.match(ai,/usageToday/);assert.match(ai,/usageWeek/);assert.match(ai,/usageMonth/);
assert.doesNotMatch(ai,/rowHandoff/,'guest list selects only; handoff belongs to detail header');
assert.match(pricing,/toggle\.className="admin-toggle"/);assert.match(pricing,/toggle\.dataset\.roomField="enabled"/);
assert.match(rooms,/我確認以上已包含所有實體房間/);assert.match(rooms,/admin-confirmation-row/);assert.match(rooms,/admin-choice-row/);
console.log('PASS shared UI control wiring and dedicated customer action (STRUCTURED_CONTRACT_TEST)');
