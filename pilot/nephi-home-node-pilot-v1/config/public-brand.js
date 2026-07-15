"use strict";

const DEFAULT_PUBLIC_BASE_URL = "https://nephi-home-node-pilot-test-only.onrender.com";

function normalizePublicBaseUrl(value) {
  const url = new URL(String(value || DEFAULT_PUBLIC_BASE_URL).trim());
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("PUBLIC_BASE_URL must use HTTP or HTTPS");
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function createPublicBrand(env = process.env) {
  return Object.freeze({
    brandName: "JunZan AI",
    publicBaseUrl: normalizePublicBaseUrl(env.PUBLIC_BASE_URL)
  });
}

module.exports = { createPublicBrand, DEFAULT_PUBLIC_BASE_URL };
