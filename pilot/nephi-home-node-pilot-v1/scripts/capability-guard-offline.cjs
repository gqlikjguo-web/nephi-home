"use strict";
// Test-process preload. Loopback fixtures only; no external model/provider network.
const fs = require("node:fs");
const allowed = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
function check(host) {
  if (!host || allowed.has(String(host))) return;
  if (process.env.CAPABILITY_NETWORK_AUDIT) fs.appendFileSync(process.env.CAPABILITY_NETWORK_AUDIT, JSON.stringify({ blocked: true, host: String(host), pid: process.pid }) + "\n");
  throw Error("OFFLINE_BASELINE_EXTERNAL_NETWORK_FORBIDDEN");
}
function hostOf(value) {
  if (value instanceof URL) return value.hostname;
  if (typeof value === "string") return new URL(value).hostname;
  return value?.hostname || value?.host;
}
for (const name of ["node:http", "node:https"]) {
  const client = require(name);
  for (const method of ["request", "get"]) {
    const original = client[method];
    client[method] = function (...args) { check(hostOf(args[0])); return original.apply(this, args); };
  }
}
if (globalThis.fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = function (input, ...args) { check(hostOf(input?.url || input)); return original.call(this, input, ...args); };
}
const net = require("node:net"), connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // net.connect/createConnection forwards Node's normalized [options, callback].
  const connectionArgs = Array.isArray(args[0]) ? args[0] : args;
  const first = connectionArgs[0];
  if (first && typeof first === "object") check(first.host);
  else if (typeof first === "number" && typeof connectionArgs[1] === "string") check(connectionArgs[1]);
  return connect.apply(this, args);
};
