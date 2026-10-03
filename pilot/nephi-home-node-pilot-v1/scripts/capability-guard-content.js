"use strict";
// External governance only. No application import or provider access.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
}
function hash(v) { return crypto.createHash("sha256").update(Buffer.isBuffer(v) || typeof v === "string" ? v : JSON.stringify(canonical(v))).digest("hex"); }
function insist(ok, message) { if (!ok) throw Error(message); }
function exact(p) { return typeof p === "string" && p.length > 0 && !path.posix.isAbsolute(p) && path.posix.normalize(p) === p
  && !p.includes("\\") && !p.split("/").includes("..") && !Array.from(p).some(c => c.charCodeAt(0) < 32); }
function git(root, args) { return execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }); }
function gitTree(root, ref) {
  insist(/^[0-9a-f]{40}$/.test(ref), "COMMIT_REQUIRED");
  const tree = new Map();
  for (const line of git(root, ["ls-tree", "-rz", ref]).toString().split("\0").filter(Boolean)) {
    const tab = line.indexOf("\t"), [mode, type, oid] = line.slice(0, tab).split(" "), name = line.slice(tab + 1);
    insist(exact(name) && type === "blob", "UNSAFE_TREE_ENTRY");
    const content = git(root, ["cat-file", "blob", oid]); tree.set(name, { mode, sha256: hash(content), content });
  }
  return tree;
}
function workspaceTree(root, ignored = []) {
  insist(ignored.every(p => p === "pilot/nephi-home-node-pilot-v1/node_modules"), "UNSAFE_IGNORED_PATH");
  const files = git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean);
  const tree = new Map();
  for (const name of new Set(files)) {
    if (ignored.includes(name) || ignored.some(p => name.startsWith(p + "/"))) continue;
    insist(exact(name), "UNSAFE_PATH"); const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const st = fs.lstatSync(file); insist(st.isFile() && !st.isSymbolicLink(), "NONREGULAR_SOURCE: " + name);
    const content = fs.readFileSync(file); tree.set(name, { mode: st.mode & 0o111 ? "100755" : "100644", sha256: hash(content), content });
  }
  return tree;
}
function contentDigest(tree, paths = [...tree.keys()]) {
  return hash([...paths].sort().map(p => { insist(tree.has(p), "MISSING_PATH: " + p); const e = tree.get(p); return [p, e.mode, e.sha256]; }));
}
function changed(a, b) { return [...new Set([...a.keys(), ...b.keys()])].filter(p => a.get(p)?.sha256 !== b.get(p)?.sha256 || a.get(p)?.mode !== b.get(p)?.mode).sort(); }
function writeLock(file, tree) {
  const lock = { schemaVersion: 1, candidateDigest: contentDigest(tree), entries: [...tree].map(([p,e]) => [p,e.mode,e.sha256]) };
  fs.writeFileSync(file, JSON.stringify(lock, null, 2), { flag: "wx" }); return lock;
}
function checkLock(file, tree) { insist(JSON.parse(fs.readFileSync(file)).candidateDigest === contentDigest(tree), "CANDIDATE_CONTENT_DRIFT"); return true; }
function assertTrustedManifest(trusted, candidate) { insist(hash(trusted) === hash(candidate), "GOVERNANCE_REVIEW_REQUIRED"); return true; }
function promotion(test, release, policy, lock) {
  insist(lock?.productDigest && lock.policyDigest === hash(policy), "ACCEPTED_CONTENT_LOCK_REQUIRED");
  insist(Array.isArray(policy.mustMatch) && policy.mustMatch.length && new Set(policy.mustMatch).size === policy.mustMatch.length, "INVALID_PRODUCT_MANIFEST");
  const match = new Set(policy.mustMatch), meta = new Set(policy.metadata || []), overlay = new Map(Object.entries(policy.testOnly || {}));
  insist([...match, ...meta, ...overlay.keys()].every(exact), "INVALID_PRODUCT_PATH");
  insist(new Set([...match, ...meta, ...overlay.keys()]).size === match.size + meta.size + overlay.size, "AMBIGUOUS_PATH_CLASS");
  for (const tree of [test, release]) for (const [p,e] of tree) {
    insist(match.has(p) || meta.has(p) || overlay.has(p), "UNCLASSIFIED_PRODUCT_PATH: " + p);
    insist(["100644", "100755"].includes(e.mode), "UNSAFE_PRODUCT_MODE");
    if (overlay.has(p)) insist(e.mode === "100644" && e.sha256 === overlay.get(p), "TEST_OVERLAY_DRIFT");
  }
  insist(contentDigest(test, policy.mustMatch) === lock.productDigest && contentDigest(release, policy.mustMatch) === lock.productDigest, "PRODUCT_CONTENT_DRIFT");
  return { ok: true, productDigest: lock.productDigest, matched: match.size, deploymentAuthorized: false };
}
module.exports = { hash, insist, exact, gitTree, workspaceTree, contentDigest, changed, writeLock, checkLock, assertTrustedManifest, promotion };
