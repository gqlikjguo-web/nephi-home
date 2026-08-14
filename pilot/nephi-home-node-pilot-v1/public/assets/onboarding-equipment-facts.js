"use strict";

(function expose(root) {
  const registry = root.HighFrequencyEquipment;
  const formData = root.PropertyFactsFormData;
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

  function drafts(facts) { return formData.buildHighFrequencyEquipmentDrafts(facts, "operator_onboarding"); }

  function render(container, facts) {
    const current = drafts(facts), byId = new Map(current.map((fact) => [fact.canonicalId, fact]));
    container.innerHTML = registry.HIGH_FREQUENCY_EQUIPMENT_GROUPS.map((group) => `
      <section class="equipment-group">
        <h3>${escapeHtml(group.publicName)}</h3>
        <div class="equipment-grid">${group.items.map((item) => {
          const fact = byId.get(item.canonicalId);
          return `<article class="equipment-fact-row" data-equipment-fact="${escapeHtml(item.canonicalId)}">
            <h4>${escapeHtml(item.publicName)}</h4>
            <label>狀態<select data-equipment-status>
              <option value="unknown" ${fact.status === "unknown" ? "selected" : ""}>未知</option>
              <option value="allowed" ${fact.status === "allowed" ? "selected" : ""}>有</option>
              <option value="not_allowed" ${fact.status === "not_allowed" ? "selected" : ""}>沒有</option>
            </select></label>
            <label>適用範圍<select data-equipment-scope>
              <option value="whole_property" ${fact.appliesTo === "whole_property" ? "selected" : ""}>整間旅宿</option>
              <option value="room_only" ${fact.appliesTo === "room_only" ? "selected" : ""}>僅房間</option>
              <option value="both" ${fact.appliesTo === "both" ? "selected" : ""}>整間與房間</option>
            </select></label>
            <label>正式對客說明<textarea data-equipment-public-text rows="3" placeholder="可直接回覆旅客的正式說明">${escapeHtml(fact.publicText)}</textarea></label>
            <label>備註<textarea data-equipment-notes rows="2" placeholder="業者內部備註（選填）">${escapeHtml(fact.notes)}</textarea></label>
          </article>`;
        }).join("")}</div>
      </section>`).join("");
    for (const row of container.querySelectorAll("[data-equipment-fact]")) {
      const status = row.querySelector("[data-equipment-status]");
      const scope = row.querySelector("[data-equipment-scope]");
      const publicText = row.querySelector("[data-equipment-public-text]");
      const notes = row.querySelector("[data-equipment-notes]");
      const notesLabel = notes.closest("label");
      const noteHint = document.createElement("small");
      noteHint.className = "equipment-internal-note";
      noteHint.textContent = "\u50c5\u696d\u8005\u5167\u90e8\uff0c\u4e0d\u76f4\u63a5\u56de\u8986\u65c5\u5ba2";
      notes.placeholder = "\u50c5\u696d\u8005\u5167\u90e8\uff0c\u4e0d\u76f4\u63a5\u56de\u8986\u65c5\u5ba2";
      notesLabel.insertBefore(noteHint, notes);
      const sync = () => {
        const policy = formData.equipmentFieldPolicy(status.value);
        scope.closest("label").hidden = !policy.showScope;
        publicText.closest("label").hidden = !policy.showPublicText;
        notesLabel.hidden = !policy.showNotes;
        publicText.disabled = !policy.showPublicText;
        publicText.required = policy.publicTextRequired;
        if (status.value === "unknown") publicText.value = "";
      };
      status.onchange = sync;
      sync();
    }
  }

  function collect(container, facts) {
    const current = drafts(facts);
    for (const row of container.querySelectorAll("[data-equipment-fact]")) {
      const fact = current.find((item) => item.canonicalId === row.dataset.equipmentFact);
      fact.status = row.querySelector("[data-equipment-status]").value;
      fact.appliesTo = row.querySelector("[data-equipment-scope]").value;
      fact.publicText = fact.status === "unknown" ? "" : row.querySelector("[data-equipment-public-text]").value;
      fact.notes = row.querySelector("[data-equipment-notes]").value;
    }
    return formData.buildPropertyFactsPayload("", current).facts;
  }

  function missingFields(container) {
    const missing = [];
    for (const input of container.querySelectorAll("[required]")) {
      input.closest("label")?.querySelector(".field-error")?.remove();
      if (String(input.value || "").trim() && input.checkValidity()) continue;
      const row = input.closest("[data-equipment-fact]");
      const name = registry.equipmentByCanonicalId(row.dataset.equipmentFact)?.publicName || row.dataset.equipmentFact;
      missing.push({ name: `equipment-${row.dataset.equipmentFact}`, label: `${name}－正式對客說明`, el: input, step: 3 });
    }
    return missing;
  }

  function appendPreview(container, facts) {
    const heading = document.createElement("h3");
    heading.textContent = "常用設備";
    container.append(heading);
    for (const fact of facts || []) {
      const definition = registry.equipmentByCanonicalId(fact.canonicalId);
      if (!definition) continue;
      const item = document.createElement("article"), title = document.createElement("strong"), status = document.createElement("p");
      item.className = "item";
      title.textContent = definition.publicName;
      status.textContent = `${({ allowed: "有", not_allowed: "沒有", unknown: "未知" })[fact.status] || "未知"}｜${({ whole_property: "整間旅宿", room_only: "僅房間", both: "整間與房間" })[fact.appliesTo] || "整間旅宿"}`;
      if (!formData.equipmentFieldPolicy(fact.status).showScope) status.textContent = status.textContent.split("\uff5c")[0];
      item.append(title, status);
      if (fact.publicText) { const text = document.createElement("p"); text.textContent = fact.publicText; item.append(text); }
      container.append(item);
    }
  }

  root.OnboardingEquipmentFacts = Object.freeze({ drafts, render, collect, missingFields, appendPreview });
})(globalThis);
