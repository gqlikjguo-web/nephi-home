"use strict";

const GOOGLE_MAP_HOSTS = new Set(["maps.app.goo.gl", "maps.google.com"]);

function normalizeGoogleMapsUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2000) return "";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const isGoogleMapsPath = (host === "google.com" || host === "www.google.com") && url.pathname.startsWith("/maps");
    return url.protocol === "https:" && (GOOGLE_MAP_HOSTS.has(host) || isGoogleMapsPath) ? url.toString() : "";
  } catch { return ""; }
}

module.exports = { normalizeGoogleMapsUrl };
