"use strict";
// Operator-owned draft; only the existing API validates and persists facts.
const RoomCompositionEditor = (() => {
  function create(host, { getPropertyId }) {
    const doc = host.ownerDocument;
    const node = (tag, text = '') => { const el = doc.createElement(tag); el.textContent = text; return el; };
    const button = (text, action, handler) => { const el = node('button', text); el.type = 'button'; el.dataset.action = action; el.onclick = handler; return el; };
    const status = node('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const form = node('form'), inputs = node('fieldset'), roomList = node('div'), bundlesList = node('div');
    const complete = node('input'); complete.type = 'checkbox'; complete.dataset.field = 'inventoryComplete';
    const label = (text, input) => { const el = node('label', text); el.append(input); return el; };
    let scope = null, generation = 0, draft = null, types = [], bundles = [], busy = false, conflict = false;
    const add = button('新增實體房間', 'add', () => {
      if (!editable() || draft.physicalRooms.length >= 10000) return;
      draft.physicalRooms.push({ physicalRoomId: crypto.randomUUID(), roomTypeId: '', publicName: '' });
      draft.inventoryComplete = false; render();
    });
    const reload = button('重新載入', 'reload', () => load());
    const save = button('儲存房間組成', 'save', () => submit());
    inputs.append(label('已完整登錄所有實體房間', complete), roomList, add, node('h3', '包棟包含的實體房間'), bundlesList);
    form.append(inputs, save, reload);
    form.onsubmit = event => { event.preventDefault(); return submit(); };
    host.append(node('h2', '房間組成'), node('p', '請逐間登錄實際房間，並選擇所屬房型。房型不是房數；只有確認資料完整後才勾選完整登錄。刪除房間也會移除其包棟成員關聯。'), form, status);
    complete.onchange = () => { if (editable()) draft.inventoryComplete = complete.checked; };
    function editable() { return draft && scope && scope === getPropertyId() && !busy && !conflict; }
    function controls() {
      inputs.disabled = !editable(); save.disabled = !editable(); reload.disabled = busy || !getPropertyId();
    }
    async function request(url, options) {
      const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json' } });
      const body = await response.json();
      if (!response.ok) { const error = new Error(body.error?.message || '操作失敗'); error.code = body.error?.code; throw error; }
      return body.data;
    }
    function renderBundles() {
      bundlesList.replaceChildren();
      for (const bundle of bundles) {
        const group = node('fieldset'), legend = node('legend', bundle.name);
        let item = draft.bundleCompositions.find(value => value.bundleId === bundle.id);
        // Rendering a missing bundle does not silently create a persisted entry.
        const edit = () => {
          if (!item) { item = { bundleId: bundle.id, complete: false, memberPhysicalRoomIds: [] }; draft.bundleCompositions.push(item); }
          return item;
        };
        group.append(legend);
        for (const room of draft.physicalRooms) {
          const selected = item?.memberPhysicalRoomIds.includes(room.physicalRoomId) || false;
          if (!selected && !bundle.memberRoomIds.includes(room.roomTypeId)) continue;
          const field = node('input'); field.type = 'checkbox'; field.checked = selected; field.dataset.field = 'member';
          field.onchange = () => {
            if (!editable()) return;
            const value = edit();
            value.memberPhysicalRoomIds = value.memberPhysicalRoomIds.filter(id => id !== room.physicalRoomId);
            if (field.checked) value.memberPhysicalRoomIds.push(room.physicalRoomId);
            value.complete = false; renderBundles();
          };
          group.append(label(room.publicName || '未命名房間', field));
        }
        const confirmed = node('input'); confirmed.type = 'checkbox'; confirmed.checked = item?.complete === true; confirmed.dataset.field = 'bundleComplete';
        confirmed.onchange = () => { if (editable()) edit().complete = confirmed.checked; };
        group.append(label('已完整登錄此包棟包含的房間', confirmed)); bundlesList.append(group);
      }
      if (!bundles.length) bundlesList.append(node('p', '目前沒有包棟方案。請先在包棟設定建立方案。'));
    }
    function render() {
      roomList.replaceChildren(); complete.checked = draft?.inventoryComplete === true;
      for (const room of draft?.physicalRooms || []) {
        const row = node('fieldset'), name = node('input'), type = node('select');
        name.value = room.publicName; name.maxLength = 160; name.required = true; name.dataset.field = 'publicName';
        name.oninput = () => { if (editable()) { room.publicName = name.value; renderBundles(); } };
        type.required = true; type.dataset.field = 'roomTypeId';
        const choices = [{ id: '', name: '請選擇房型' }, ...types];
        if (room.roomTypeId && !types.some(value => value.id === room.roomTypeId)) choices.push({ id: room.roomTypeId, name: '原房型已不存在，請重新選擇' });
        for (const value of choices) { const option = node('option', value.name); option.value = value.id; type.append(option); }
        type.value = room.roomTypeId;
        type.onchange = () => {
          if (!editable()) return;
          room.roomTypeId = type.value; draft.inventoryComplete = false; complete.checked = false;
          for (const item of draft.bundleCompositions) if (item.memberPhysicalRoomIds.includes(room.physicalRoomId)) item.complete = false;
          renderBundles();
        };
        const remove = button('刪除此房間', 'remove', () => {
          if (!editable()) return;
          draft.physicalRooms = draft.physicalRooms.filter(value => value.physicalRoomId !== room.physicalRoomId);
          draft.inventoryComplete = false;
          for (const item of draft.bundleCompositions) if (item.memberPhysicalRoomIds.includes(room.physicalRoomId)) {
            item.memberPhysicalRoomIds = item.memberPhysicalRoomIds.filter(id => id !== room.physicalRoomId); item.complete = false;
          }
          render();
        });
        row.append(label('實體房間名稱', name), label('所屬房型', type), remove); roomList.append(row);
      }
      if (!draft?.physicalRooms.length) roomList.append(node('p', '尚未登錄實體房間。'));
      if (draft) renderBundles(); else bundlesList.replaceChildren();
      controls();
    }
    function clear() { generation++; scope = null; draft = null; types = []; bundles = []; busy = false; conflict = false; status.textContent = ''; render(); }
    async function load() {
      clear(); const propertyId = getPropertyId(); if (!propertyId) return;
      scope = propertyId; const token = generation; busy = true; controls(); status.textContent = '載入中…';
      try {
        const encoded = encodeURIComponent(propertyId);
        const [data, pricing, offers] = await Promise.all([
          request(`/api/room-composition?propertyId=${encoded}`),
          request(`/api/room-pricing?customerId=${encoded}`), request(`/api/bundles?customerId=${encoded}`)
        ]);
        if (token !== generation || propertyId !== getPropertyId()) return;
        if (data.propertyId !== propertyId) throw new Error('旅宿資料不符，請重新登入');
        draft = data.composition || { schemaVersion: 1, revision: 0, inventoryComplete: false, physicalRooms: [], bundleCompositions: [] };
        types = pricing.rooms; bundles = offers.bundles;
        status.textContent = data.composition ? '已載入已儲存的房間組成。' : '尚未登錄。填寫並儲存後才會建立正式資料。';
      } catch (error) { if (token === generation) status.textContent = `載入失敗：${error.message}`; }
      finally { if (token === generation) { busy = false; render(); } }
    }
    async function submit() {
      if (!editable() || !form.reportValidity()) return;
      const token = generation, propertyId = scope;
      busy = true; controls(); status.textContent = '儲存中…';
      try {
        const data = await request('/api/room-composition', { method: 'PUT', body: JSON.stringify({ propertyId, composition: draft }) });
        if (token !== generation || propertyId !== getPropertyId()) return;
        if (data.propertyId !== propertyId) throw new Error('旅宿資料不符，請重新登入');
        draft = data.composition; status.textContent = '房間組成已儲存。';
      } catch (error) {
        if (token !== generation || propertyId !== getPropertyId()) return;
        conflict = error.code === 'ROOM_COMPOSITION_REVISION_CONFLICT';
        status.textContent = conflict ? '資料已由其他頁面修改。您的輸入仍保留；請先記下需要的修改，再按「重新載入」取得最新資料。'
          : `儲存失敗：${error.message}。輸入內容仍保留，請檢查房型與包棟成員設定。`;
      } finally { if (token === generation) { busy = false; render(); } }
    }
    controls(); return { load, clear };
  }
  return { create };
})();
