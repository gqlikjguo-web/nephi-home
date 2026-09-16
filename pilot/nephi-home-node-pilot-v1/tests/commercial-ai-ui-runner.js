"use strict";
// RUNTIME_COMPONENT_TEST: real browser controller with DOM and HTTP doubles; no external resources.
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
class Node {
  constructor(tag, ownerDocument) { Object.assign(this, { tagName: tag, ownerDocument, children: [], dataset: {}, value: "", disabled: false, hidden: false, checked: false, textContent: "" }); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this[key] = value; }
  querySelectorAll() { return this.children.flatMap(n => [n, ...n.querySelectorAll()]); }
}
const plain = value => JSON.parse(JSON.stringify(value));
async function run() {
  const file = __dirname + "/../public/assets/admin-ai-controls.js";
  assert.ok(fs.existsSync(file), "AI control controller must exist before operators can change AI state");
  const doc = { createElement: tag => new Node(tag, doc) };
  const host = new Node("section", doc), platformHost = new Node("section", doc);
  let propertyId = "owner-alpha", limit = 100, used = 80, enabled = true, human = false, fail = false, pending = null, cookiePropertyId = null, reverseGuests = false;
  let delayedHistory = null, delayedControl = null, delayedWrite = null;
  const writes = [], reads = [];
  const conversationItems = [
    { channelId: "channel/A", userId: "user?A", displayName: "同名 <script>", messagePreview: "請問入住時間？", lastMessageAt: "2026-09-16T01:00:00.000Z" },
    { channelId: "channel/B", userId: "user?B", displayName: "同名 <script>", messagePreview: "我要確認停車位置 <script>" + "長".repeat(90), lastMessageAt: "2026-09-16T02:00:00.000Z" },
    { displayName: "缺少識別" }
  ];
  const status = () => ({ propertyId, monthlyLimit: limit, used, remaining: limit === null ? null : Math.max(0, limit-used), period: "2026-09", aiEnabled: enabled, status: limit === null ? "unconfigured" : used >= limit ? "full" : used >= limit * .9 ? "90" : used >= limit * .8 ? "80" : "normal" });
  const respond = (data, ok = true) => ({ ok, json: async () => ok ? { ok: true, data: plain(data) } : { ok: false, error: { message: "拒絕變更" } } });
  const fetch = async (url, options = {}) => {
    const requestUrl = new URL(url, "https://ui.example.invalid"), path = requestUrl.pathname;
    const expectedProperty = requestUrl.searchParams.get("propertyId");
    // Mirror the route's shared-cookie scope check before any store mutation.
    if (path.startsWith("/api/ai-controls") && expectedProperty && expectedProperty !== (cookiePropertyId || propertyId)) return respond(null, false);
    if (options.method === "PUT") {
      const body = JSON.parse(options.body); writes.push({ url, body });
      if (fail) return respond(null, false);
      if (delayedWrite) return delayedWrite;
      if (path === "/api/ai-controls") enabled = body.aiEnabled;
      else if (url === "/api/platform/ai-controls") limit = body.monthlyLimit;
      else { assert.equal(path, "/api/ai-controls/conversations"); human = body.humanControlled; return respond({ humanControlled: human }); }
      return respond(status());
    }
    reads.push(url);
    if (url === "/api/admin/platform/properties") return respond({ items: [{ propertyId: "owner-alpha", propertyName: "A旅宿" }, { propertyId: "owner-beta", propertyName: "B旅宿" }] });
    if (path === "/api/ai-controls/conversations" && !requestUrl.searchParams.has("channelId")) return respond({ items: reverseGuests ? [...conversationItems].reverse() : conversationItems });
    if (path === "/api/ai-controls/conversations" && requestUrl.searchParams.has("channelId") && delayedControl) return delayedControl;
    if (url.startsWith("/api/ai-controls/conversations?")) return respond({ humanControlled: human });
    if (path === "/api/ai-controls/usage") return respond({today:2,week:5,day:"2026-09-17",weekStart:"2026-09-14"});
    if (path === "/api/ai-controls/history" && delayedHistory && requestUrl.searchParams.get("userId") === "user?A") return delayedHistory;
    if (path === "/api/ai-controls/history") return respond({items:[{reviewId:"r",guestMessage:requestUrl.searchParams.get("userId"),replyText:"Saved reply",replyDelivered:true,createdAt:"2026-09-17T01:00:00Z"}],nextCursor:null});
    if (pending) return pending;
    return respond(status());
  };
  const context = vm.createContext({ fetch, URLSearchParams });
  vm.runInContext(fs.readFileSync(file, "utf8"), context);
  const controls = vm.runInContext("AiControls", context);
  const operator = controls.createOperator(host, { getPropertyId: () => propertyId });
  const field = (name, root = host) => root.querySelectorAll().find(n => n.dataset.field === name);
  await operator.load();
  assert.equal(writes.length, 0); assert.equal(field("aiEnabled").checked, true); assert.match(field("switchLabel").textContent,/開啟/); assert.match(field("usageWindow").textContent,/2.*5.*80/);
  // A different tab changes the shared cookie to beta while this DOM still displays alpha.
  cookiePropertyId = "owner-beta";
  field("aiEnabled").checked = false; await field("aiEnabled").onchange();
  assert.equal(writes.length, 0, "stale-tab AI toggle must be rejected before mutating the cookie-selected property");
  assert.equal(enabled, true); assert.equal(field("aiEnabled").checked, true); assert.match(field("message").textContent, /拒絕變更/);
  cookiePropertyId = null;
  assert.match(field("usage").textContent, /80.*100.*20/); assert.match(field("period").textContent, /2026-09/); assert.match(field("quotaStatus").textContent, /80%/);
  assert.equal(field("monthlyLimit"), undefined, "operator cannot edit monthly limits");
  field("aiEnabled").checked = false; await field("aiEnabled").onchange();
  assert.deepEqual(writes.at(-1), { url: "/api/ai-controls?propertyId=owner-alpha", body: { aiEnabled: false } });
  fail = true; field("aiEnabled").checked = true; await field("aiEnabled").onchange();
  assert.equal(field("aiEnabled").checked, false); assert.match(field("message").textContent, /拒絕變更/); fail = false;
  const select = field("conversation"); const rowText=row=>row.children.slice(0,4).map(n=>n.textContent).join(" "); const openSecond=()=>select.children[1].children[0].onclick(); assert.equal(select.children.length, 2, "invalid tuples must not be selectable");
  const firstLabel = rowText(select.children[0]), secondLabel = rowText(select.children[1]);
  assert.match(firstLabel, /請問入住時間？/, "first same-name guest must show their message preview");
  assert.match(secondLabel, /我要確認停車位置 <script>/, "second same-name guest must show their own literal message preview");
  assert.match(firstLabel, /user\?A/); assert.match(secondLabel, /user\?B/);
  assert.match(firstLabel, /2026/); assert.match(secondLabel, /2026/);
  assert.notEqual(firstLabel, secondLabel); assert.ok(secondLabel.length < 160, "message preview must be bounded");
  reverseGuests = true; await operator.load();
  assert.equal(rowText(select.children[0]), secondLabel, "guest identity label must survive server list reordering");
  assert.equal(rowText(select.children[1]), firstLabel);
  reverseGuests = false; await operator.load();
  await openSecond(); assert.equal(field("handoff").textContent, "轉人工");
  cookiePropertyId = "owner-beta"; const beforeStaleHandoff = writes.length;
  await field("handoff").onclick(); assert.equal(writes.length, beforeStaleHandoff, "stale-tab handoff must not mutate the cookie-selected property");
  assert.equal(human, false); assert.equal(field("handoff").textContent, "轉人工");
  await openSecond(); assert.equal(field("handoff").disabled, true, "stale-tab conversation reads must fail closed");
  await operator.load(); assert.equal(field("aiEnabled").disabled, true); assert.equal(field("conversation").children.length, 0);
  cookiePropertyId = null; await operator.load(); await openSecond();
  await field("handoff").onclick();
  assert.equal(writes.at(-1).url, "/api/ai-controls/conversations?propertyId=owner-alpha");
  assert.deepEqual(writes.at(-1).body, { channelId: "channel/B", userId: "user?B", humanControlled: true });
  assert.equal(field("handoff").textContent, "恢復 AI");
  await field("handoff").onclick(); assert.equal(writes.at(-1).body.humanControlled, false);
  assert.ok(reads.some(url => url.includes("channelId=channel%2FB") && url.includes("userId=user%3FB")));
  for (const url of reads.filter(value => value.startsWith("/api/ai-controls"))) assert.equal(new URL(url, "https://ui.example.invalid").searchParams.get("propertyId"), "owner-alpha", "every operator read must declare the displayed property");
  const textTree = root => [root.textContent,...root.querySelectorAll().map(n=>n.textContent)].join(" ");
  let finishHistory; delayedHistory = new Promise(resolve=>{finishHistory=resolve;});
  const openingA=select.children[0].children[0].onclick();
  assert.equal(field("history").children.length,0,"switching guest clears previous saved messages immediately");
  await openSecond();assert.match(textTree(field("history")),/user\?B/);
  finishHistory(respond({items:[{reviewId:"a",guestMessage:"SECRET_A",replyText:"",createdAt:"2026-09-17T01:00:00Z"}],nextCursor:null}));await openingA;delayedHistory=null;
  assert.doesNotMatch(textTree(field("history")),/SECRET_A/,"late guest A response cannot enter guest B history");
  assert.match(textTree(field("history")),/user\?B/);
  let finishControl; delayedControl=new Promise(resolve=>{finishControl=resolve;});
  const openingControl=select.children[0].children[0].onclick();
  await field("rowHandoff",select.children[0]).onclick();
  finishControl(respond({humanControlled:false}));await openingControl;delayedControl=null;
  assert.equal(field("handoff").textContent,"恢復 AI","a stale control read must not undo confirmed handoff in UI");
  await field("handoff").onclick();assert.equal(human,false);
  let finishWrite; delayedWrite=new Promise(resolve=>{finishWrite=resolve;});
  field("aiEnabled").checked=true;const writing=field("aiEnabled").onchange();const readsBefore=reads.length;
  assert.equal(field("refresh").disabled,true);await operator.load();assert.equal(reads.length,readsBefore,"refresh cannot replace UI with a pre-write snapshot");
  enabled=true;finishWrite(respond(status()));await writing;delayedWrite=null;assert.equal(field("refresh").disabled,false);assert.equal(field("aiEnabled").checked,true);
  limit = null; await operator.load(); assert.match(field("quotaStatus").textContent, /額度未設定/); assert.doesNotMatch(field("usage").textContent, /無限/);
  limit = 100; used = 90; await operator.load(); assert.match(field("quotaStatus").textContent, /90%/);
  used = 100; await operator.load(); assert.match(field("quotaStatus").textContent, /用完/);
  let release; pending = new Promise(resolve => { release = resolve; }); const loading = operator.load();
  propertyId = "owner-beta"; operator.clear(); pending = null; await operator.load();
  release(respond({ ...status(), propertyId: "owner-alpha", used: 1 })); await loading;
  assert.match(field("usage").textContent, /100/); assert.equal(field("handoff").disabled, true);
  propertyId = null; operator.clear(); assert.equal(field("aiEnabled").disabled, true); assert.equal(field("conversation").children.length, 0);
  propertyId = "owner-alpha"; used = 10;
  const platform = controls.createPlatform(platformHost); await platform.load();
  const property = field("property", platformHost); property.value = "owner-alpha"; await property.onchange();
  const input = field("monthlyLimit", platformHost), save = field("saveLimit", platformHost);
  const before = writes.length; input.value = "-1"; await save.onclick(); input.value = "1.5"; await save.onclick(); assert.equal(writes.length, before);
  input.value = "0"; await save.onclick(); assert.deepEqual(writes.at(-1), { url: "/api/platform/ai-controls", body: { propertyId: "owner-alpha", monthlyLimit: 0 } });
  input.value = ""; await save.onclick(); assert.equal(writes.at(-1).body.monthlyLimit, null);
  fail = true; input.value = "25"; await save.onclick(); assert.equal(input.value, "25"); assert.match(field("message", platformHost).textContent, /拒絕變更/);
  // Execute the script included by each actual page, with browser DOM/observer doubles.
  // This catches a missing script/host and login/property changes that fail to mount or clear controls.
  fail = false;
  for (const [page, hostId] of [["admin.html", "aiControls"], ["admin-platform.html", "platformAiControls"]]) {
    const html = fs.readFileSync(__dirname + "/../public/" + page, "utf8"), elements = new Map(), observers = [];
    const browserDoc = { createElement: tag => new Node(tag, browserDoc), getElementById: id => elements.get(id) || null };
    for (const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g)) elements.set(match[2], new Node(match[1], browserDoc));
    if (elements.has("workspace")) elements.get("workspace").hidden = true;
    const browser = vm.createContext({ document: browserDoc, fetch, URLSearchParams, MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} } });
    vm.runInContext("let session = null;", browser);
    const scripts = [...html.matchAll(/<script src="([^"]+)"[^>]*>/g)].map(match => match[1]).filter(src => src.endsWith("/admin-ai-controls.js"));
    for (const script of scripts) vm.runInContext(fs.readFileSync(__dirname + "/../public" + script, "utf8"), browser);
    const mounted = elements.get(hostId); assert.ok(mounted && mounted.children.length, page + " must mount working controls");
    if (page === "admin.html") {
      assert.equal(field("aiEnabled", mounted).disabled, true);
      vm.runInContext('session = { propertyId: "owner-alpha" };', browser); elements.get("workspace").hidden = false; observers.forEach(callback => callback());
      await new Promise(resolve => setImmediate(resolve)); assert.equal(field("aiEnabled", mounted).disabled, false);
      elements.get("workspace").hidden = true; observers.forEach(callback => callback()); assert.equal(field("aiEnabled", mounted).disabled, true); assert.equal(field("conversation", mounted).children.length, 0);
    } else {
      await new Promise(resolve => setImmediate(resolve)); assert.equal(field("property", mounted).children.length, 3);
    }
  }
  console.log("PASS commercial AI UI: quota states, operator toggle, trusted same-name guest tuples, handoff/resume, stale property reads, platform zero/null/invalid limits and failed writes (RUNTIME_COMPONENT_TEST)");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
