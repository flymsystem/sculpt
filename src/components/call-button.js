// src/components/call-button.js
// ─────────────────────────────────────────────────────────────────
// One-tap calling, everywhere.
//
// Two mechanisms, both delegated — no window globals, nothing to add
// to the cleanup array in app.js:
//
//  1. callBtn(phone)  — explicit green "Call" button markup you can drop
//     into any action row. Emits <button data-call="+91...">.
//
//  2. linkifyPhones(root) — sweeps a freshly-rendered container and turns
//     any bare phone number in a TEXT NODE into a tel: link. This is what
//     makes numbers tappable on the Members table, Enquiries, Staff and
//     Member Alerts without touching those files.
//
// index.html sets <meta name="format-detection" content="telephone=no">,
// which stops the OS auto-linking numbers — linkifyPhones replaces that
// behaviour with something we control and style.
// ─────────────────────────────────────────────────────────────────

/** Strip everything but digits, then normalise to a dialable Indian number. */
export function normalizePhone(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d;
  d = d.replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10) return '+91' + d;
  if (d.length === 12 && d.startsWith('91')) return '+' + d;
  if (d.length === 11 && d.startsWith('0')) return '+91' + d.slice(1);
  return '+' + d;
}

/** Pretty display form: +91 98765 43210 */
export function formatPhone(raw) {
  const n = normalizePhone(raw);
  const m = n.match(/^\+91(\d{5})(\d{5})$/);
  return m ? `+91 ${m[1]} ${m[2]}` : n;
}

/** Open the native dialer. Works on mobile, desktop apps, and PWAs. */
export function dial(raw) {
  const n = normalizePhone(raw);
  if (!n) return false;
  window.location.href = 'tel:' + n;
  return true;
}

const PHONE_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;

/**
 * Markup for a Call action button.
 * @param {string}  phone
 * @param {object}  opts  { label:boolean, size:'sm'|'md', title:string }
 */
export function callBtn(phone, opts = {}) {
  const n = normalizePhone(phone);
  const disabled = !n;
  const label = opts.label ? '<span style="margin-left:5px;">Call</span>' : '';
  const size = opts.size === 'md' ? 'padding:8px 12px;' : 'padding:5px 8px;';
  return `<button type="button" class="btn btn-sm flym-call-btn"
    ${disabled ? 'disabled' : `data-call="${n}"`}
    title="${disabled ? 'No phone number' : 'Call ' + formatPhone(n)}"
    style="background:var(--green-fade);color:var(--green);border:1px solid var(--green-strong);${size}display:inline-flex;align-items:center;justify-content:center;${disabled ? 'opacity:0.35;cursor:not-allowed;' : ''}">
    ${PHONE_SVG}${label}
  </button>`;
}

// ── 1. Delegated handler for [data-call] ──────────────────────────
let _handlerInstalled = false;

export function initCallHandler() {
  if (_handlerInstalled) return;
  _handlerInstalled = true;
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-call]');
    if (!btn) return;
    if (btn.hasAttribute('disabled')) return;
    ev.preventDefault();
    ev.stopPropagation();
    dial(btn.getAttribute('data-call'));
  });
}

// ── 2. Auto-linkify bare phone numbers ────────────────────────────
// Matches +91 98765 43210 / +919876543210 / 9876543210 / 98765-43210
const PHONE_RE = /(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g;

const SKIP_TAGS = new Set([
  'A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'LABEL',
  'SCRIPT', 'STYLE', 'SVG', 'PATH', 'CODE', 'PRE',
]);

function shouldSkip(node) {
  let el = node.parentElement;
  while (el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.classList?.contains('no-linkify')) return true;
    if (el.isContentEditable) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Walk `root` and wrap bare phone numbers in tappable tel: links.
 * Safe to call repeatedly — already-linked numbers sit inside <a>, which
 * is in SKIP_TAGS, so they're never double-processed.
 *
 * @param {HTMLElement|string} root  element or selector (default #gym-content)
 */
export function linkifyPhones(root) {
  try {
    const el = typeof root === 'string'
      ? document.querySelector(root)
      : (root || document.getElementById('gym-content'));
    if (!el) return;

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || node.nodeValue.length < 10) return NodeFilter.FILTER_REJECT;
        PHONE_RE.lastIndex = 0;
        if (!PHONE_RE.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        if (shouldSkip(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const targets = [];
    let n;
    while ((n = walker.nextNode())) targets.push(n);

    targets.forEach(node => {
      const text = node.nodeValue;
      const frag = document.createDocumentFragment();
      let last = 0;
      PHONE_RE.lastIndex = 0;
      let match;
      while ((match = PHONE_RE.exec(text)) !== null) {
        const raw = match[0];
        const tel = normalizePhone(raw);
        if (!tel) continue;
        if (match.index > last) {
          frag.appendChild(document.createTextNode(text.slice(last, match.index)));
        }
        const a = document.createElement('a');
        a.href = 'tel:' + tel;
        a.className = 'flym-tel';
        a.textContent = raw;
        a.setAttribute('title', 'Call ' + formatPhone(tel));
        // Stop the click bubbling into row handlers (open member modal, etc.)
        a.addEventListener('click', e => e.stopPropagation());
        frag.appendChild(a);
        last = match.index + raw.length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      if (frag.childNodes.length) node.parentNode.replaceChild(frag, node);
    });
  } catch (err) {
    console.warn('[Flym] linkifyPhones:', err.message);
  }
}

// ── 3. Auto-linkify inside modals ─────────────────────────────────
// Modals are injected into <body> by components/modal.js. Rather than
// editing every modal call site (there are a lot, in member-modals.js
// alone), watch for them and linkify on arrival. One observer, installed
// once, for the whole app.
let _observer = null;

export function observeModals() {
  if (_observer || typeof MutationObserver === 'undefined') return;
  _observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType !== 1) continue;
        const isModal = node.id === 'sculpt-modal-overlay'
          || node.classList?.contains('modal-overlay')
          || node.querySelector?.('#sculpt-modal-overlay, .modal-overlay');
        if (isModal) {
          // Let the modal finish its own onOpen wiring first.
          setTimeout(() => linkifyPhones(node), 0);
        }
      }
    }
  });
  _observer.observe(document.body, { childList: true, subtree: false });
}

export function stopObservingModals() {
  if (_observer) { _observer.disconnect(); _observer = null; }
}

// ── Styles ────────────────────────────────────────────────────────
export function injectCallStyles() {
  if (document.getElementById('flym-call-styles')) return;
  const s = document.createElement('style');
  s.id = 'flym-call-styles';
  s.textContent = `
    a.flym-tel {
      color: inherit;
      text-decoration: none;
      border-bottom: 1px dashed var(--green-strong, rgba(52,199,89,.4));
      cursor: pointer;
      white-space: nowrap;
    }
    a.flym-tel:hover, a.flym-tel:active { color: var(--green); border-bottom-color: var(--green); }
    .flym-call-btn:active:not([disabled]) { transform: scale(0.94); }
    /* Give the finger some room on touch devices */
    @media (max-width: 768px) {
      a.flym-tel { padding: 2px 0; }
      .flym-call-btn { min-width: 34px; min-height: 32px; }
    }
  `;
  document.head.appendChild(s);
}
