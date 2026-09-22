"use strict";

const AdminRoomGallery = (() => {
  const MAX_PHOTOS = 10, MAX_BYTES = 8 * 1024 * 1024;
  function node(tag, className, text) {
    const value = document.createElement(tag);
    if (className) value.className = className;
    if (text) value.textContent = text;
    return value;
  }
  function create(roomId, propertyId, getPropertyId) {
    const root = node("section", "room-gallery room-gallery-admin");
    root.setAttribute("aria-label", "房間照片");
    const heading = node("div", "room-gallery-heading"), count = node("span", "room-gallery-count", "0/10");
    heading.append(node("h4", "", "房間照片"), count);
    const hint = node("p", "room-gallery-hint", "最多 10 張，每張 8 MB 以內，支援 JPG、PNG。第一張為主照片，變更會立即儲存。");
    const list = node("div", "room-gallery-admin-list"), status = node("p", "room-gallery-status");
    status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const file = node("input"); file.type = "file"; file.accept = "image/jpeg,image/png"; file.multiple = true; file.hidden = true;
    file.setAttribute("aria-label", "選擇房型照片");
    const upload = node("button", "room-gallery-upload", "上傳房型照片"); upload.type = "button";
    upload.onclick = () => { if (!busy && available && checkScope()) file.click(); };
    root.append(heading, hint, list, file, upload, status);
    let items = [], busy = true, available = false;
    const current = () => propertyId && getPropertyId() === propertyId;
    function checkScope() {
      if (current() && root.isConnected) return true;
      status.textContent = "旅宿已切換，請重新開啟房型照片。";
      return false;
    }
    function controls() {
      upload.disabled = busy || !available || items.length >= MAX_PHOTOS;
      file.disabled = upload.disabled;
      for (const button of list.querySelectorAll("button")) button.disabled = busy || button.dataset.edge === "true";
      root.setAttribute("aria-busy", String(busy));
    }
    function render() {
      count.textContent = `${items.length}/10`;
      list.replaceChildren(...items.map((item, index) => {
        const tile = node("div", "room-gallery-tile"); tile.dataset.photoId = item.id;
        if (item.ready !== false && item.previewUrl) {
          const image = node("img", "room-gallery-preview"); image.src = item.previewUrl; image.alt = `房型照片 ${index + 1}`; image.loading = "lazy";
          image.onerror = () => { image.replaceWith(node("span", "room-gallery-incomplete", "照片無法顯示")); };
          tile.append(image);
        } else tile.append(node("span", "room-gallery-incomplete", "上傳未完成"));
        tile.append(node("span", "room-gallery-position", index === 0 ? "1 · 主照片" : String(index + 1)));
        const actions = node("div", "room-gallery-actions");
        for (const [label, text, delta] of [[`將第 ${index + 1} 張照片往前移`, "往前", -1], [`將第 ${index + 1} 張照片往後移`, "往後", 1]]) {
          const button = node("button", "", text); button.type = "button"; button.setAttribute("aria-label", label);
          button.dataset.edge = String(index + delta < 0 || index + delta >= items.length);
          button.onclick = () => mutate(async () => {
            const ids = items.map(photo => photo.id); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
            return request("/order", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photoIds: ids }) });
          }, "照片順序已儲存"); actions.append(button);
        }
        const remove = node("button", "room-gallery-delete", "刪除"); remove.type = "button"; remove.setAttribute("aria-label", `刪除第 ${index + 1} 張照片`);
        remove.onclick = () => mutate(() => request("/" + encodeURIComponent(item.id), { method: "DELETE" }), "照片已刪除");
        actions.append(remove); tile.append(actions); return tile;
      })); controls();
    }
    async function request(suffix = "", options = {}) {
      if (!current()) throw Error("旅宿已切換，請重新開啟房型照片。");
      const response = await fetch(`/api/room-gallery/${encodeURIComponent(roomId)}${suffix}?propertyId=${encodeURIComponent(propertyId)}`, { credentials: "same-origin", ...options });
      const result = await response.json();
      if (!current()) throw Error("旅宿已切換，請重新開啟房型照片。");
      if (!response.ok) throw Error(result.error?.message || "照片操作失敗，請稍後再試。");
      if (!Array.isArray(result.data?.items)) throw Error("照片資料無法讀取，請稍後再試。");
      return result.data.items;
    }
    async function mutate(operation, success) {
      if (busy || !checkScope()) return;
      busy = true; controls(); status.textContent = "儲存中…";
      try { items = await operation(); if (checkScope()) { render(); status.textContent = success; } }
      catch (error) { status.textContent = error.message; }
      finally { busy = false; controls(); }
    }
    file.onchange = async () => {
      const files = Array.from(file.files || []); file.value = "";
      if (!files.length || busy || !available || !checkScope()) return;
      if (files.length + items.length > MAX_PHOTOS) { status.textContent = `最多 10 張照片，目前還可上傳 ${MAX_PHOTOS - items.length} 張。`; return; }
      if (files.some(value => !["image/jpeg", "image/png"].includes(value.type))) { status.textContent = "僅支援 JPG、PNG 照片。"; return; }
      if (files.some(value => value.size > MAX_BYTES || value.size === 0)) { status.textContent = "每張照片須大於 0 且不超過 8 MB。"; return; }
      busy = true; controls();
      try {
        for (let index = 0; index < files.length; index++) {
          if (!checkScope()) return;
          status.textContent = `上傳中 ${index + 1}/${files.length}…`;
          items = await request("", { method: "POST", headers: { "Content-Type": files[index].type }, body: files[index] });
          if (!checkScope()) return;
          render();
        }
        status.textContent = "照片已儲存";
      } catch (error) {
        if (current() && root.isConnected) {
          try { items = await request(); render(); } catch { /* Keep the last confirmed list and original upload error. */ }
        }
        status.textContent = error.message;
      } finally { busy = false; controls(); }
    };
    controls(); status.textContent = "載入照片中…";
    request().then(values => { if (!current()) return; items = values; available = true; render(); status.textContent = ""; }).catch(error => { status.textContent = error.message; }).finally(() => { busy = false; controls(); });
    return root;
  }
  return { create };
})();
