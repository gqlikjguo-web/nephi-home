"use strict";

const box = document.querySelector("#applications");
const message = document.querySelector("#message");

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || "操作失敗");
  return payload.data;
}

function textElement(tag, value) {
  const element = document.createElement(tag);
  element.textContent = value;
  return element;
}

function labelWithControl(labelText, control) {
  const label = document.createElement("label");
  label.append(document.createTextNode(labelText), control);
  return label;
}

function renderApplication(app) {
  const article = document.createElement("article");
  article.className = "item";
  article.append(
    textElement("h2", app.propertyName || "未命名"),
    textElement("p", `聯絡人：${app.contactName || "－"}；狀態：${app.status}；完整度：${app.completeness.percent}%`),
    textElement("p", `房型 ${app.rooms.length}；組合方案 ${app.bundles.length}；附件 ${app.attachments.length}`)
  );

  const note = document.createElement("textarea");
  article.append(labelWithControl("審核備註", note));

  const propertyId = document.createElement("input");
  propertyId.value = app.propertyIdSuggestion || `property_${app.applicationId.slice(0, 8)}`;
  article.append(labelWithControl("核准 propertyId", propertyId));

  const username = document.createElement("input");
  username.value = "owner";
  username.dataset.user = "";
  article.append(labelWithControl("業者帳號", username));

  const actions = document.createElement("div");
  actions.className = "actions";
  for (const [label, action] of [["退回補件", "request-changes"], ["拒絕", "reject"], ["核准", "approve"]]) {
    const button = document.createElement("button");
    button.textContent = label;
    button.onclick = async () => {
      try {
        const body = action === "approve"
          ? { propertyId: propertyId.value, adminUsername: username.value }
          : { reason: note.value };
        const result = await api(`/api/admin/onboarding/applications/${app.applicationId}/${action}`, {
          method: "POST",
          body: JSON.stringify(body)
        });
        if (result.adminSetupToken) {
          message.textContent = `核准完成。請將一次性帳號設定網址安全交給業者：${location.origin}/admin/setup?token=${result.adminSetupToken}`;
        }
        await load();
      } catch (error) {
        message.textContent = error.message;
      }
    };
    actions.append(button);
  }
  article.append(actions);
  return article;
}

async function load() {
  try {
    const { items } = await api("/api/admin/onboarding/applications");
    box.replaceChildren(...items.map(renderApplication));
  } catch (error) {
    message.textContent = error.message;
  }
}

document.querySelector("#refresh").onclick = load;
load();
