"use strict";

const TEST_SERVICE_ID = "srv-d9bqupbbc2fs73aselig";
const TEST_DB_ID = "dpg-da6qo0jbc2fs738f11v0-a";
const IDENTITY = Object.freeze({
  userId: "test-only-public-new-core-test",
  propertyId: "nephi_home",
  username: "test-only-public",
  properties: Object.freeze([Object.freeze({ propertyId: "nephi_home" })])
});

// Called with deployment configuration only. HTTP input cannot supply identity.
function createFixedTestAdminAccess({ testOnlyEnvironment, env }) {
  return function getFixedTestAdminIdentity() {
    if (testOnlyEnvironment !== true || env.TEST_ONLY_ENVIRONMENT !== "true"
      || env.RENDER_SERVICE_ID !== TEST_SERVICE_ID) return null;
    for (const key of ["DATABASE_URL", "NEW_CORE_MANUAL_TEST_FACTS_DATABASE_URL"]) {
      let target;
      try { target = new URL(env[key]); } catch { return null; }
      if (!["postgres:", "postgresql:"].includes(target.protocol)
        || target.hostname !== TEST_DB_ID || target.pathname !== "/nephi_home_node_pilot_test_only"
        || target.search || target.hash || (target.port && target.port !== "5432")) return null;
    }
    return IDENTITY;
  };
}

// Only the existing operational editors required for isolated manual acceptance.
// Account/platform/LINE administration and customer records keep cookie auth.
function isFixedTestAdminDataRoute(method, pathname) {
  const exact = {
    "/api/homestays": ["GET"],
    "/api/bootstrap": ["GET"],
    "/api/settings": ["PUT"],
    "/api/property-profile": ["GET", "PUT"],
    "/api/property-facts": ["GET", "PUT"],
    "/api/room-composition": ["GET", "PUT"],
    "/api/availability/month": ["GET", "POST"],
    "/api/availability/day": ["POST"],
    "/api/availability/day-note": ["PUT"],
    "/api/availability/batch": ["POST"],
    "/api/room-pricing": ["GET", "PUT"],
    "/api/bundles": ["GET", "POST"],
    "/api/room-price-overrides": ["POST"],
    "/api/inventory-price-overrides": ["POST", "DELETE"],
    "/api/date-price-classifications": ["POST", "DELETE"],
    "/api/custom-replies": ["GET", "POST"]
  };
  if (Object.hasOwn(exact, pathname)) return exact[pathname].includes(method);
  const parts = pathname.split("/");
  if (parts.length === 4 && parts[1] === "api" && parts[3]) {
    if (parts[2] === "room-pricing") return method === "PUT";
    if (parts[2] === "bundles") return ["PUT", "DELETE"].includes(method);
    if (parts[2] === "custom-replies" && parts[3] !== "test") return ["PUT", "DELETE"].includes(method);
  }
  return parts.length === 5 && parts[1] === "api" && parts[2] === "custom-replies"
    && Boolean(parts[3]) && parts[3] !== "test" && parts[4] === "enabled" && method === "PATCH";
}

module.exports = { createFixedTestAdminAccess, isFixedTestAdminDataRoute };
