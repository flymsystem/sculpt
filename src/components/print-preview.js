// src/components/print-preview.js
// ─────────────────────────────────────────────────────────────────
// Shows a printable HTML document inside the app’s own modal instead of
// window.open(). On iOS, when the app is added to the home screen
// (standalone/PWA mode), window.open() often does NOT give you a real
// second window with its own browser history — there's nothing to
// swipe back to, and no Safari chrome to tap a back/close button on.
// That's what was trapping users on the invoice/PDF screens.
//
// This avoids the problem entirely: nothing ever navigates away from
// the app. "Close" just closes our own modal (always works, same as
// every other modal in the app). "Print" calls print() on a hidden
// iframe scoped to just this document's content — no new window,
// no new tab, no lost history.
// ─────────────────────────────────────────────────────────────────

import { openModal, bindModalCancel } from './modal.js';

export function showPrintPreview(title, html) {
  openModal({
    title,
    size: 'lg',
    mobileCompact: true,
    body: `
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <button class="btn btn-primary" id="pv-print-btn" style="flex:1;padding:10px 16px;font-size:14px;">🖨️ Print / Save as PDF</button>
        <button class="btn btn-ghost" id="modal-cancel" style="padding:10px 16px;">Close</button>
      </div>
      <iframe id="print-preview-frame" title="${title.replace(/"/g, '&quot;')}"
        style="width:100%;height:60vh;border:0;background:#fff;border-radius:8px;display:block;"></iframe>`,
    footer: '',
    onOpen: () => {
      bindModalCancel();

      const frame = document.getElementById('print-preview-frame');
      if (frame) {
        const doc = frame.contentDocument || frame.contentWindow.document;
        doc.open();
        doc.write(html);
        doc.close();
      }

      document.getElementById('pv-print-btn')?.addEventListener('click', () => {
        const fr = document.getElementById('print-preview-frame');
        try {
          fr?.contentWindow?.focus();
          fr?.contentWindow?.print();
        } catch (err) {
          console.warn('[Sculpt] print() failed:', err.message);
        }
      });
    }
  });
}
