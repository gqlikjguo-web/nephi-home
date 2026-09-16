"use strict";
const AiControls = (() => {
  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { "content-type": "application/json" } });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) throw new Error(payload.error?.message || "載入失敗，請稍後重試。");
    return payload.data;
  }
  function node(host, tag, text, field) {
    const result = host.ownerDocument.createElement(tag);
    if (text !== undefined) result.textContent = text;
    if (field) result.dataset.field = field;
    return result;
  }
  function summary(host) {
    const period = node(host, "p", "", "period"), usage = node(host, "p", "", "usage"), status = node(host, "p", "", "quotaStatus");
    status.setAttribute("role", "status");
    host.append(period, usage, status);
    return {
      clear() { period.textContent = ""; usage.textContent = ""; status.textContent = ""; },
      render(data) {
        period.textContent = `計費月份：${data.period}`;
        usage.textContent = `本月已用 ${data.used} 次／額度 ${data.monthlyLimit === null ? "未設定" : data.monthlyLimit} 次／剩餘 ${data.remaining === null ? "未設定" : data.remaining} 次`;
        status.textContent = data.monthlyLimit === null ? "額度未設定" : data.remaining === 0 ? "本月額度已用完" : data.used >= data.monthlyLimit * .9 ? "本月額度已使用 90% 以上" : data.used >= data.monthlyLimit * .8 ? "本月額度已使用 80% 以上" : "本月額度正常";
      }
    };
  }
  function createOperator(host, { getPropertyId }) {
    const enabled = node(host, "input", undefined, "aiEnabled"), label = node(host, "label", "AI 自動回覆");
    enabled.type = "checkbox"; enabled.disabled = true; label.append(enabled);
    host.append(node(host, "h2", "AI 回覆管理"), label);
    const totals = summary(host);
    const conversation = node(host, "select", undefined, "conversation"), conversationLabel = node(host, "label", "客人對話"), handoff = node(host, "button", "轉人工", "handoff"), message = node(host, "p", "", "message"), refresh = node(host, "button", "重新整理", "refresh");
    conversationLabel.append(conversation); handoff.type = "button"; refresh.type = "button"; handoff.disabled = true;
    message.setAttribute("role", "status"); message.setAttribute("aria-live", "polite");
    host.append(conversationLabel, handoff, refresh, message);
    let version = 0, guestVersion = 0, currentId = null, savedEnabled = false, human = false, items = [];
    const current = (revision, id) => revision === version && id === currentId && id === getPropertyId();
    function clear() {
      version++; guestVersion++; currentId = null; items = []; enabled.disabled = true; enabled.checked = false;
      conversation.disabled = true; conversation.replaceChildren(); handoff.disabled = true; totals.clear(); message.textContent = "";
    }
    async function load() {
      clear(); const id = getPropertyId(); if (!id) return;
      currentId = id; const revision = version; message.textContent = "載入中…";
      try {
        const [data, list] = await Promise.all([api(`/api/ai-controls?${new URLSearchParams({ propertyId: id })}`), api(`/api/ai-controls/conversations?${new URLSearchParams({ propertyId: id })}`)]);
        if (!current(revision, id)) return;
        if (data.propertyId !== id) throw new Error("旅宿已切換，請重新整理。");
        savedEnabled = data.aiEnabled; enabled.checked = savedEnabled; enabled.disabled = false; totals.render(data);
        items = (list.items || []).filter(item => typeof item.channelId === "string" && item.channelId && typeof item.userId === "string" && item.userId);
        const placeholder = node(host, "option", items.length ? "請選擇客人對話" : "目前沒有可管理的對話"); placeholder.value = "";
        conversation.replaceChildren(placeholder, ...items.map((item, index) => {
          const timestamp = item.lastMessageAt ? new Date(item.lastMessageAt) : null;
          const time = timestamp && Number.isFinite(timestamp.getTime()) ? timestamp.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "時間未提供";
          const preview = typeof item.messagePreview === "string" && item.messagePreview ? item.messagePreview.slice(0, 80) : "尚無訊息摘要";
          const identity = `${String(item.displayName || "客人對話").slice(0, 40)}（${item.userId.slice(-8)}）`;
          const option = node(host, "option", `${identity} · ${time} · ${preview}`); option.value = String(index); return option;
        }));
        conversation.value = ""; conversation.disabled = !items.length; message.textContent = "";
      } catch (error) { if (current(revision, id)) message.textContent = error.message || "連線失敗，請重試。"; }
    }
    enabled.onchange = async () => {
      if (enabled.disabled || currentId !== getPropertyId()) return;
      const revision = version, id = currentId, requested = enabled.checked; enabled.disabled = true;
      try {
        const data = await api(`/api/ai-controls?${new URLSearchParams({ propertyId: id })}`, { method: "PUT", body: JSON.stringify({ aiEnabled: requested }) });
        if (!current(revision, id)) return;
        if (data.propertyId !== id) throw new Error("旅宿已切換，請重新整理。");
        savedEnabled = data.aiEnabled; enabled.checked = savedEnabled; totals.render(data); message.textContent = "已儲存 AI 自動回覆設定。";
      } catch (error) { if (current(revision, id)) { enabled.checked = savedEnabled; message.textContent = error.message || "儲存失敗，請重試。"; } }
      finally { if (current(revision, id)) enabled.disabled = false; }
    };
    conversation.onchange = async () => {
      const guestRevision = ++guestVersion, revision = version, id = currentId;
      handoff.disabled = true; message.textContent = "";
      const guest = conversation.value === "" ? null : items[Number(conversation.value)]; if (!guest || !current(revision, id)) return;
      try {
        const query = new URLSearchParams({ propertyId: id, channelId: guest.channelId, userId: guest.userId });
        const data = await api(`/api/ai-controls/conversations?${query}`);
        if (!current(revision, id) || guestRevision !== guestVersion) return;
        human = data.humanControlled; handoff.textContent = human ? "恢復 AI" : "轉人工"; handoff.disabled = false;
      } catch (error) { if (current(revision, id) && guestRevision === guestVersion) message.textContent = error.message || "載入失敗，請重試。"; }
    };
    handoff.onclick = async () => {
      const guest = conversation.value === "" ? null : items[Number(conversation.value)], revision = version, guestRevision = guestVersion, id = currentId;
      if (handoff.disabled || !guest || !current(revision, id)) return;
      handoff.disabled = true; conversation.disabled = true;
      try {
        const data = await api(`/api/ai-controls/conversations?${new URLSearchParams({ propertyId: id })}`, { method: "PUT", body: JSON.stringify({ channelId: guest.channelId, userId: guest.userId, humanControlled: !human }) });
        if (!current(revision, id) || guestRevision !== guestVersion) return;
        human = data.humanControlled; handoff.textContent = human ? "恢復 AI" : "轉人工";
        message.textContent = human ? "此對話已轉人工。" : "此對話已恢復 AI；仍依旅宿開關與額度決定是否回覆。";
      } catch (error) { if (current(revision, id) && guestRevision === guestVersion) message.textContent = error.message || "儲存失敗，請重試。"; }
      finally { if (current(revision, id) && guestRevision === guestVersion) { handoff.disabled = false; conversation.disabled = false; } }
    };
    refresh.onclick = load;
    return { load, clear };
  }
  function createPlatform(host) {
    host.append(node(host, "h2", "每月 AI 額度"));
    const property = node(host, "select", undefined, "property"), propertyLabel = node(host, "label", "選擇旅宿"); propertyLabel.append(property); host.append(propertyLabel);
    const totals = summary(host), input = node(host, "input", undefined, "monthlyLimit"), label = node(host, "label", "每月額度（留白代表未設定）"), save = node(host, "button", "儲存額度", "saveLimit"), message = node(host, "p", "", "message");
    input.type = "number"; input.min = "0"; input.step = "1"; input.disabled = true; save.type = "button"; save.disabled = true;
    label.append(input); message.setAttribute("role", "status"); message.setAttribute("aria-live", "polite"); host.append(label, save, message);
    let version = 0, knownIds = new Set();
    property.onchange = async () => {
      const revision = ++version, id = property.value; input.disabled = true; save.disabled = true; input.value = ""; totals.clear(); message.textContent = "";
      if (!knownIds.has(id)) return;
      try {
        const data = await api(`/api/platform/ai-controls?${new URLSearchParams({ propertyId: id })}`);
        if (revision !== version || id !== property.value) return;
        if (data.propertyId !== id) throw new Error("旅宿已切換，請重新整理。");
        totals.render(data); input.value = data.monthlyLimit === null ? "" : String(data.monthlyLimit); input.disabled = false; save.disabled = false;
      } catch (error) { if (revision === version) message.textContent = error.message || "載入失敗，請重試。"; }
    };
    save.onclick = async () => {
      if (save.disabled || !knownIds.has(property.value)) return;
      const raw = input.value.trim(), monthlyLimit = raw === "" ? null : Number(raw);
      if (monthlyLimit !== null && (!Number.isSafeInteger(monthlyLimit) || monthlyLimit < 0)) { message.textContent = "請輸入 0 或正整數，或留白。"; return; }
      const revision = version, id = property.value; save.disabled = true;
      try {
        const data = await api("/api/platform/ai-controls", { method: "PUT", body: JSON.stringify({ propertyId: id, monthlyLimit }) });
        if (revision !== version || property.value !== id) return;
        if (data.propertyId !== id) throw new Error("旅宿已切換，請重新整理。");
        totals.render(data); input.value = data.monthlyLimit === null ? "" : String(data.monthlyLimit); message.textContent = "已儲存每月額度。";
      } catch (error) { if (revision === version) message.textContent = error.message || "儲存失敗，請重試。"; }
      finally { if (revision === version) save.disabled = false; }
    };
    async function load() {
      const revision = ++version; save.disabled = true; input.disabled = true;
      try {
        const data = await api("/api/admin/platform/properties"); if (revision !== version) return;
        const items = data.items || []; knownIds = new Set(items.map(item => item.propertyId));
        const empty = node(host, "option", "請選擇旅宿"); empty.value = "";
        property.replaceChildren(empty, ...items.map(item => { const option = node(host, "option", item.propertyName || item.propertyId); option.value = item.propertyId; return option; }));
        property.value = "";
      } catch (error) { if (revision === version) message.textContent = error.message || "載入失敗，請重試。"; }
    }
    return { load };
  }
  return { createOperator, createPlatform };
})();
if (typeof document !== "undefined") {
  const operatorHost = document.getElementById("aiControls");
  if (operatorHost) {
    const workspace = document.getElementById("workspace");
    const getPropertyId = () => workspace.hidden || typeof session === "undefined" ? null : session?.propertyId;
    const editor = AiControls.createOperator(operatorHost, { getPropertyId });
    let lastProperty;
    const synchronize = () => { const id = getPropertyId(); if (id !== lastProperty) { lastProperty = id; if (id) editor.load(); else editor.clear(); } };
    const observer = new MutationObserver(synchronize);
    observer.observe(workspace, { attributes: true, attributeFilter: ["hidden"] });
    observer.observe(document.getElementById("propertyLabel"), { childList: true, subtree: true });
    synchronize();
  }
  const platformHost = document.getElementById("platformAiControls");
  if (platformHost) AiControls.createPlatform(platformHost).load();
}
