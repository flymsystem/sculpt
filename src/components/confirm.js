// src/components/confirm.js
// ─────────────────────────────────────────────────────────────────
// In-app confirm dialog to replace native window.confirm().
// Reasons:
//  - Native confirm is jarring in iOS PWA (system chrome)
//  - Blocks the JS thread
//  - Cannot be styled to match the app’s dark theme
//
// Usage:
//   import { showConfirm } from '../../components/confirm.js';
//   const ok = await showConfirm({
//     title: 'Remove photo?',
//     message: 'This will delete the photo from storage.',
//     confirmLabel: 'Remove',
//     confirmVariant: 'danger'   // 'primary' | 'danger'
//   });
//   if (!ok) return;
//
// Awaitable, focus-trapped, escape-to-cancel, safe on mobile.
// ─────────────────────────────────────────────────────────────────

import { openModal, closeModal } from './modal.js';

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @param {object} opts
 * @param {string} opts.title          — dialog title
 * @param {string} [opts.message]      — body message (plain text; safely escaped)
 * @param {string} [opts.confirmLabel] — button label, default 'Confirm'
 * @param {string} [opts.cancelLabel]  — button label, default 'Cancel'
 * @param {'primary'|'danger'|'amber'} [opts.confirmVariant]
 * @returns {Promise<boolean>}
 */
export function showConfirm({
  title = 'Are you sure?',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
} = {}) {
  return new Promise((resolve) => {
    const btnClass =
      confirmVariant === 'danger'
        ? 'btn'
        : confirmVariant === 'amber'
        ? 'btn'
        : 'btn btn-primary';
    const btnStyle =
      confirmVariant === 'danger'
        ? 'background:var(--red);color:#fff;border:none;'
        : confirmVariant === 'amber'
        ? 'background:var(--amber);color:#000;border:none;'
        : '';

    const body = `
      <div style="padding:6px 2px 2px;color:var(--text-secondary);font-size:14px;line-height:1.6;">
        ${message ? esc(message) : ''}
      </div>`;

    const footer = `
      <button class="btn btn-ghost" id="modal-cancel" type="button" style="flex:1;min-width:80px;">${esc(cancelLabel)}</button>
      <button class="${btnClass}" id="confirm-ok" type="button"
        style="flex:2;min-width:120px;${btnStyle}">${esc(confirmLabel)}</button>`;

    let settled = false;
    const settle = (val) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(val);
    };

    openModal({
      title: esc(title),
      body,
      footer,
      size: 'sm',
      onOpen: (root) => {
        root.querySelector('#confirm-ok')?.addEventListener('click', () => settle(true));
        root.querySelector('#modal-cancel')?.addEventListener('click', () => settle(false));
        // Also handle overlay click / Esc / close ✕ — the modal system
        // already removes the DOM node; we listen for that removal via
        // a MutationObserver to resolve false.
        const obs = new MutationObserver(() => {
          if (!document.getElementById('sculpt-modal-overlay')) {
            obs.disconnect();
            settle(false);
          }
        });
        obs.observe(document.body, { childList: true });
      },
    });
  });
}
