// src/components/photo-lightbox.js
// ─────────────────────────────────────────────────────────────────
// Click any member photo thumbnail to view it full-size. A lightweight,
// purpose-built overlay — not the app's modal system, since a photo
// viewer wants minimal chrome and an edge-to-edge dark backdrop rather
// than a titled card. Tap the image area background, the ✕, or press
// Escape to close.
// ─────────────────────────────────────────────────────────────────

export function openPhotoLightbox(url) {
  if (!url) return;
  closePhotoLightbox(); // guard against stacking if triggered twice quickly

  const overlay = document.createElement('div');
  overlay.id = 'sculpt-photo-lightbox';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999;
    display:flex;align-items:center;justify-content:center;
    padding:24px;cursor:zoom-out;
  `;

  overlay.innerHTML = `
    <button id="sculpt-lightbox-close" aria-label="Close"
      style="position:absolute;top:16px;right:16px;width:40px;height:40px;border-radius:50%;
        background:rgba(255,255,255,0.12);border:none;color:#fff;font-size:18px;cursor:pointer;
        display:flex;align-items:center;justify-content:center;z-index:1;">✕</button>
    <img src="${url}" style="max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;
      box-shadow:0 20px 60px rgba(0,0,0,0.5);cursor:default;">
  `;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden'; // prevent background scroll while open

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePhotoLightbox();
  });
  document.getElementById('sculpt-lightbox-close')?.addEventListener('click', closePhotoLightbox);

  function onKey(e) { if (e.key === 'Escape') closePhotoLightbox(); }
  document.addEventListener('keydown', onKey);
  overlay._onKey = onKey;
}

export function closePhotoLightbox() {
  const el = document.getElementById('sculpt-photo-lightbox');
  if (!el) return;
  if (el._onKey) document.removeEventListener('keydown', el._onKey);
  el.remove();
  document.body.style.overflow = '';
}
