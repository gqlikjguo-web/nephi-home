"use strict";

const GuestRoomGallery = (() => {
  async function attach(card, { roomId, slug, name }) {
    if (!roomId || !slug) return;
    try {
      const response = await fetch(`/api/public/room-gallery?${new URLSearchParams({ slug, roomId })}`);
      if (!response.ok) return;
      const result = await response.json(), items = (result.data?.items || []).filter(item => item.ready !== false && item.previewUrl && item.originalUrl).slice(0, 10);
      if (!items.length || !card.isConnected) return;
      const gallery = document.createElement("div"); gallery.className = "room-gallery room-gallery-guest"; gallery.setAttribute("aria-label", `${name}照片`);
      const main = document.createElement("img"); main.className = "room-gallery-main"; main.alt = `${name}照片 1`; main.src = items[0].originalUrl;
      // An unavailable first photo leaves the original room card intact.
      await main.decode();
      if (!card.isConnected) return;
      main.onerror = () => gallery.remove();
      gallery.append(main);
      let selected = 0, touch = null;
      const thumbs = document.createElement("div"); thumbs.className = "room-gallery-thumbs"; thumbs.setAttribute("aria-label", "選擇照片");
      const count = document.createElement("span"); count.className = "room-gallery-slide-count"; count.setAttribute("aria-live", "polite");
      function select(index) {
        selected = (index + items.length) % items.length;
        main.src = items[selected].originalUrl; main.alt = `${name}照片 ${selected + 1}`;
        count.textContent = `${selected + 1}/${items.length}`;
        Array.from(thumbs.children).forEach((button, position) => button.setAttribute("aria-pressed", String(position === selected)));
      }
      items.forEach((item, index) => {
        const button = document.createElement("button"); button.type = "button"; button.className = "room-gallery-thumb"; button.setAttribute("aria-label", `查看${name}第 ${index + 1} 張照片`);
        const preview = document.createElement("img"); preview.src = item.previewUrl; preview.alt = ""; preview.loading = "lazy"; button.append(preview);
        button.onclick = () => select(index);
        button.onkeydown = event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); select(selected + (event.key === "ArrowRight" ? 1 : -1)); thumbs.children[selected].focus(); } };
        thumbs.append(button);
      });
      main.addEventListener("touchstart", event => { const point = event.touches[0]; touch = point ? { x: point.clientX, y: point.clientY } : null; }, { passive: true });
      main.addEventListener("touchend", event => { const point = event.changedTouches[0]; if (touch && point) { const dx = point.clientX - touch.x, dy = point.clientY - touch.y; if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) select(selected + (dx < 0 ? 1 : -1)); } touch = null; }, { passive: true });
      main.addEventListener("touchcancel", () => { touch = null; }, { passive: true });
      gallery.append(count); if (items.length > 1) gallery.append(thumbs);
      select(0); card.prepend(gallery);
    } catch { /* Photos are optional; retain the complete original room card. */ }
  }
  return { attach };
})();
