// src/components/modal.js — Production-hardened, mobile-first
// ─────────────────────────────────────────────────────────────────
// Additions over previous version:
//  1. Scroll-lock uses body position:fixed pattern → prevents iOS
//     rubber-band and restores scroll position on close.
//  2. Focus trap while open (Tab / Shift-Tab cycles within modal).
//  3. Focus is returned to the previously-focused element on close.
//  4. aria-modal + role="dialog" + aria-labelledby on modal root.
//  5. First focusable element auto-focused on open (excluding close btn).
// ─────────────────────────────────────────────────────────────────

let _stylesInjected      = false;
let _lastFocusedEl       = null;
let _scrollLockY         = 0;
let _scrollLockActive    = false;

/**
 * WARNING: `title`, `body` and `footer` are inserted as HTML, not text.
 *
 * That is intentional — nearly every caller passes markup. It does mean
 * the CALLER is responsible for running escHtml() over any user-entered
 * value it interpolates, e.g.
 *     title: `Edit — ${escHtml(member.full_name)}`
 *
 * Escaping here instead would double-escape the ~30 call sites that
 * already do it correctly, turning "Ram & Co" into "Ram &amp; Co" on
 * screen. If you add a caller, escape at the call site.
 */
export function openModal({ title, body, footer = '', size = 'md', onOpen, mobileCompact = false }) {
  closeModal(); // always close any existing modal first

  _lastFocusedEl = document.activeElement;

  const isMobile   = window.innerWidth <= 768;
  const titleId    = 'sculpt-modal-title-' + Math.random().toString(36).slice(2, 8);

  _lockScroll();

  if (isMobile && mobileCompact) {
    _injectMobileStyles();
    const panel = document.createElement('div');
    panel.id        = 'sculpt-modal-overlay';
    panel.className = 'sculpt-mobile-fullscreen';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', titleId);
    panel.innerHTML = `
      <div class="sculpt-mobile-inner">
        <div class="sculpt-mobile-header">
          <div class="modal-title" id="${titleId}">${title}</div>
          <button class="modal-close" id="modal-close-btn" type="button" aria-label="Close">✕</button>
        </div>
        <div class="sculpt-mobile-body" id="sculpt-modal-body">${body}</div>
        ${footer ? `<div class="sculpt-mobile-footer">${footer}</div>` : ''}
      </div>`;

    document.body.appendChild(panel);
    panel.querySelector('#modal-close-btn')?.addEventListener('click', closeModal);
    document.addEventListener('keydown', _handleKey);
    panel.addEventListener('keydown', _handleTabTrap);
    requestAnimationFrame(() => {
      panel.querySelector('.sculpt-mobile-body')?.scrollTo({ top: 0 });
      _focusFirst(panel);
    });
    if (onOpen) onOpen(panel);
    return;
  }

  // ── Desktop / tablet: centered overlay ─────────────────────────
  const widths = { sm: '400px', md: '520px', lg: '700px' };
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id        = 'sculpt-modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}"
         style="width:${widths[size] || widths.md}; max-width:calc(100vw - 32px);">
      <div class="modal-header">
        <div class="modal-title" id="${titleId}">${title}</div>
        <button class="modal-close" id="modal-close-btn" type="button" aria-label="Close">✕</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector('#modal-close-btn').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  overlay.addEventListener('keydown', _handleTabTrap);
  document.addEventListener('keydown', _handleKey);

  requestAnimationFrame(() => _focusFirst(overlay));
  if (onOpen) onOpen(overlay);
}

export function closeModal() {
  const el = document.getElementById('sculpt-modal-overlay');
  if (!el) return;
  el.removeEventListener('keydown', _handleTabTrap);
  el.remove();
  _unlockScroll();
  document.removeEventListener('keydown', _handleKey);

  // Restore focus
  if (_lastFocusedEl && typeof _lastFocusedEl.focus === 'function') {
    try { _lastFocusedEl.focus({ preventScroll: true }); } catch (_) {}
  }
  _lastFocusedEl = null;
}

function _handleKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
}

function _handleTabTrap(e) {
  if (e.key !== 'Tab') return;
  const root = document.getElementById('sculpt-modal-overlay');
  if (!root) return;
  const focusables = _focusableEls(root);
  if (!focusables.length) return;
  const first = focusables[0];
  const last  = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
}

function _focusableEls(root) {
  return Array.from(root.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
}

function _focusFirst(root) {
  const focusables = _focusableEls(root);
  // Prefer the first non-close-button focusable, so keyboard/screen-reader
  // users land on a form input, not the ✕
  const target = focusables.find((el) => el.id !== 'modal-close-btn') || focusables[0];
  if (target) { try { target.focus({ preventScroll: true }); } catch (_) {} }
}

// ── Scroll lock (body position:fixed pattern) ────────────────────
// Prevents iOS rubber-band under modal AND restores scroll position on close.
function _lockScroll() {
  if (_scrollLockActive) return;
  _scrollLockActive = true;
  _scrollLockY = window.scrollY || window.pageYOffset || 0;
  const body = document.body;
  body.style.position   = 'fixed';
  body.style.top        = `-${_scrollLockY}px`;
  body.style.left       = '0';
  body.style.right      = '0';
  body.style.width      = '100%';
  // Legacy fallback so other code detecting body.style.overflow still sees lock
  body.style.overflow   = 'hidden';
}
function _unlockScroll() {
  if (!_scrollLockActive) return;
  _scrollLockActive = false;
  const body = document.body;
  body.style.position = '';
  body.style.top      = '';
  body.style.left     = '';
  body.style.right    = '';
  body.style.width    = '';
  body.style.overflow = '';
  window.scrollTo(0, _scrollLockY);
  _scrollLockY = 0;
}

// ── Public footer helpers ────────────────────────────────────────
export function modalFooter(cancelLabel, submitLabel, submitId, submitClass = 'btn btn-primary') {
  return `
    <button class="btn btn-ghost" id="modal-cancel" type="button" style="flex:1;min-width:80px;">${cancelLabel}</button>
    <button class="${submitClass}" id="${submitId}" type="button" style="flex:2;min-width:120px;">${submitLabel}</button>`;
}

export function bindModalCancel() {
  document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
}

// ── Mobile fullscreen styles ─────────────────────────────────────
function _injectMobileStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;

  const s = document.createElement('style');
  s.id = 'sculpt-mobile-modal-styles';
  s.textContent = `
    .sculpt-mobile-fullscreen {
      position: fixed; inset: 0; z-index: 600;
      background: var(--surface-1, #101218);
      display: flex; flex-direction: column;
    }
    .sculpt-mobile-inner {
      display: flex; flex-direction: column;
      height: 100%; width: 100%; min-height: 0;
    }
    .sculpt-mobile-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 16px 14px;
      padding-top: max(16px, env(safe-area-inset-top, 0px));
      border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
      background: var(--surface-1, #101218);
      flex-shrink: 0; position: relative;
    }
    .sculpt-mobile-header::before {
      content: ''; position: absolute;
      top: 7px; left: 50%; transform: translateX(-50%);
      width: 38px; height: 3px;
      background: rgba(255,255,255,0.12);
      border-radius: 2px;
    }
    .sculpt-mobile-body {
      flex: 1; overflow-y: auto; overflow-x: hidden;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y; overscroll-behavior: contain;
      padding: 16px; min-height: 0;
    }
    .sculpt-mobile-footer {
      display: flex; gap: 8px; flex-wrap: wrap;
      padding: 12px 16px;
      padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
      border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.06));
      background: var(--surface-1, #101218);
      flex-shrink: 0;
    }
    .sculpt-mobile-footer .btn { flex: 1; min-width: 100px; justify-content: center; }
    .sculpt-mobile-body .form-row  { grid-template-columns: 1fr; gap: 0; }
    .sculpt-mobile-body .form-group{ margin-bottom: 14px; }
    .sculpt-mobile-body .form-label{ font-size: 10px; margin-bottom: 5px; }
    .sculpt-mobile-body .form-input{ padding: 10px 12px; font-size: 16px; }
    .sculpt-mobile-body .mtype-btn { font-size: 10px; padding: 8px 4px; }
  `;
  document.head.appendChild(s);
}
