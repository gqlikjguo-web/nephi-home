"use strict";

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function renderPublicHtml(source, brand) {
  return String(source)
    .replaceAll("{{PUBLIC_BRAND_NAME}}", escapeHtml(brand.brandName))
    .replaceAll("{{PUBLIC_BASE_URL}}", "");
}

module.exports = { renderPublicHtml };
