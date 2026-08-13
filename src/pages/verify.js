// ════════════════════════════════════════════════════════════
// CERTIFICATE VERIFICATION — src/pages/verify.js
// Public page. Lives at flym.in/verify
// Inherits landing page chrome (nav, footer, dark v6 design).
// ════════════════════════════════════════════════════════════

// ── Certificate registry ──────────────────────────────────
const CERTIFICATES = [
  {
    id: 'FLYM-INT-2026-026',
    altId: 'FLYM/INT/2026/026',
    name: 'Steven Anthony N',
    university: 'Christ University, Bangalore',
    role: 'Full Stack Development Intern',
    department: 'Engineering',
    internshipMode: 'Hybrid (On-site and Remote)',
    startDate: '28 March 2026',
    endDate: '30 May 2026',
    hours: 300,
    issueDate: '04 June 2026',
    issuedBy: 'Srujan VS',
    issuerTitle: 'Co-Founder & COO',
    status: 'valid'
  }
];

const MAILTO_REQUEST = 'https://mail.google.com/mail/?view=cm&to=flym.system@gmail.com&su=Flym%20Access%20Request&body=Hi%20Flym%20team%2C%0A%0AI%27m%20interested%20in%20getting%20access%20to%20the%20Flym%20gym%20management%20platform.%0A%0AGym%20Name%3A%0AOwner%20Name%3A%0APhone%3A%0ACity%3A%0A%0AThanks!';
const APP_BASE = new URL(import.meta.env.BASE_URL || '/', window.location.origin);

function appHref(path) {
  const [pathname, hash = ''] = path.split('#');
  const resolved = new URL(pathname.replace(/^\//, ''), APP_BASE).pathname;
  return hash ? `${resolved}#${hash}` : resolved;
}

export function renderVerify(router) {
  const root = document.getElementById('root');

  // Force dark theme to match landing
  const prevTheme = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', 'dark');

  // Parse cert ID
  const params = new URLSearchParams(window.location.search);
  let certId = (params.get('cert') || '').trim().replace(/\//g, '-');
  const cert = certId ? CERTIFICATES.find(c =>
    c.id === certId ||
    c.altId === certId ||
    c.altId === certId.replace(/-/g, '/')
  ) : null;

  root.innerHTML = `
    <div id="flym-site-dark">
      <!-- NAV -->
      <nav class="l-nav">
        <div class="l-nav-inner">
          <a href="#" class="l-logo" id="l-logo-link">
            <span>flym</span>
          </a>
          <div class="l-nav-links">
            <a href="${appHref('/#features')}">Features</a>
            <a href="${appHref('/#how')}">How it works</a>
            <a href="${appHref('/#pricing')}">Pricing</a>
            <div class="l-nav-mobile-actions">
              <button class="l-btn-ghost" id="nav-login-btn-m">Log in</button>
              <a href="${MAILTO_REQUEST}" target="_blank" class="l-btn-primary">Get access</a>
            </div>
          </div>
          <div class="l-nav-cta">
            <button id="nav-login-btn" class="l-btn-ghost">Log in</button>
            <a href="${MAILTO_REQUEST}" target="_blank" class="l-btn-primary">Get access</a>
          </div>
          <button class="l-nav-mobile" id="l-mobile-toggle" aria-label="Menu">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
          </button>
        </div>
      </nav>

      <!-- HERO + CONTENT -->
      <section class="v-section">
        <div class="v-section-inner">
          <div class="v-eyebrow">CERTIFICATE VERIFICATION</div>
          <h1 class="v-title">
            ${cert ? 'Certificate Details' : (certId ? 'Verification Result' : 'Verify a Certificate')}
          </h1>
          <p class="v-subtitle">
            ${cert ? 'Authenticity confirmed by Flym.'
              : (certId ? 'We could not find a match for your ID.'
              : 'Enter a certificate number issued by Flym to confirm its authenticity.')}
          </p>

          ${cert ? renderResult(cert)
            : (certId ? renderNotFound(certId) + renderSearchForm() : renderSearchForm())}

          <div class="v-help">
            Issues verifying? Email
            <a href="https://mail.google.com/mail/?view=cm&to=flym.system@gmail.com" target="_blank">flym.system@gmail.com</a>
          </div>
        </div>
      </section>

      <!-- FOOTER -->
      <footer class="l-footer">
        <div class="l-footer-inner">
          <div class="l-footer-brand">
            <a href="${appHref('/')}" class="l-logo" style="font-size:18px;"><span>flym</span></a>
            <p>Smart gym management. Made in India.</p>
          </div>
          <div class="l-footer-cols">
            <div>
              <h4>Product</h4>
              <a href="${appHref('/#features')}">Features</a>
              <a href="${appHref('/#how')}">How it works</a>
              <a href="${appHref('/#pricing')}">Pricing</a>
            </div>
            <div>
              <h4>Verify</h4>
              <a href="${appHref('/verify')}">Certificate</a>
            </div>
            <div>
              <h4>Contact</h4>
              <a href="https://mail.google.com/mail/?view=cm&to=flym.system@gmail.com" target="_blank">flym.system@gmail.com</a>
            </div>
          </div>
        </div>
        <div class="l-footer-bottom">
          © ${new Date().getFullYear()} Flym. All rights reserved. · MSME Registered — UDYAM-KR-03-0705005
        </div>
      </footer>
    </div>
  `;

  injectLandingStyles();
  injectVerifyStyles();
  bindNav(router);
  bindVerifyForm();

  // Restore theme if user navigates away
  window.__flymVerifyRestoreTheme = () => {
    if (prevTheme) document.documentElement.setAttribute('data-theme', prevTheme);
    else document.documentElement.removeAttribute('data-theme');
  };
}

// ────────────────────────────────────────────────────────────
// PIECES
// ────────────────────────────────────────────────────────────

function renderResult(cert) {
  const isRevoked = cert.status === 'revoked';
  const cls = isRevoked ? 'revoked' : 'valid';
  const icon = isRevoked
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
    : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const title = isRevoked ? 'Certificate Revoked' : 'Certificate Verified';
  const sub = isRevoked
    ? 'This certificate has been revoked by Flym and is no longer valid.'
    : 'This certificate was issued by Flym and is authentic.';

  const rows = [
    ['Certificate No', cert.altId, true],
    ['Name', cert.name, true],
    ['University', cert.university],
    ['Role', cert.role],
    ['Department', cert.department],
    ...(cert.internshipMode ? [['Internship Mode', cert.internshipMode]] : []),
    ['Duration', `${cert.startDate} — ${cert.endDate}`],
    ['Total Hours', `${cert.hours} hours`],
    ['Date of Issue', cert.issueDate],
    ['Issued By', `${cert.issuedBy}, ${cert.issuerTitle}`],
  ];

  return `
    <div class="v-card">
      <div class="v-status ${cls}">
        <div class="v-status-icon">${icon}</div>
        <div>
          <div class="v-status-title">${title}</div>
          <div class="v-status-sub">${sub}</div>
        </div>
      </div>
      <div class="v-details">
        ${rows.map(([label, value, strong]) => `
          <div class="v-row">
            <span class="v-label">${label}</span>
            <span class="v-value${strong ? ' v-value-strong' : ''}">${escapeHtml(value)}</span>
          </div>`).join('')}
      </div>
      <div class="v-actions">
        <a href="${appHref('/verify')}" class="l-btn-ghost">Verify Another</a>
      </div>
    </div>
  `;
}

function renderNotFound(certId) {
  return `
    <div class="v-card">
      <div class="v-status invalid">
        <div class="v-status-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        </div>
        <div>
          <div class="v-status-title">Not Found</div>
          <div class="v-status-sub">No certificate matches <strong style="color:var(--d-text);">${escapeHtml(certId)}</strong>. Please check the certificate number and try again.</div>
        </div>
      </div>
    </div>
  `;
}

function renderSearchForm() {
  return `
    <div class="v-card">
      <div class="v-tabs">
        <button class="v-tab active" data-tab="enter" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18v10H3z"/><path d="M7 12h10"/></svg>
          Enter ID
        </button>
        <button class="v-tab" data-tab="qr" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><line x1="14" y1="14" x2="14" y2="17"/><line x1="17" y1="14" x2="20" y2="14"/><line x1="14" y1="20" x2="17" y2="20"/><line x1="20" y1="17" x2="20" y2="20"/></svg>
          Scan QR Code
        </button>
      </div>

      <!-- ENTER ID PANEL -->
      <div class="v-panel" id="v-panel-enter">
        <label class="v-input-label" for="v-cert-input">Certificate Number</label>
        <form id="v-form" autocomplete="off">
          <div class="v-input-row">
            <input type="text" id="v-cert-input" class="v-input"
              placeholder="e.g. FLYM-INT-2026-026"
              autocomplete="off" autocapitalize="characters" spellcheck="false">
            <button type="submit" class="l-btn-primary v-submit">
              Verify
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </button>
          </div>
          <div class="v-hint">Format: FLYM-INT-YYYY-XXX or FLYM/INT/YYYY/XXX</div>
        </form>
      </div>

      <!-- QR PANEL -->
      <div class="v-panel" id="v-panel-qr" style="display:none;">
        <div class="v-qr-container">
          <div class="v-qr-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/>
              <line x1="14" y1="14" x2="14" y2="17"/><line x1="17" y1="14" x2="20" y2="14"/>
              <line x1="14" y1="20" x2="17" y2="20"/><line x1="20" y1="17" x2="20" y2="20"/>
            </svg>
          </div>
          <div class="v-qr-title">Use your phone camera</div>
          <div class="v-qr-sub">
            Open the camera app on your phone and point it at the QR code on the certificate. Your phone will recognize the code and open the verification link automatically.
          </div>
          <div class="v-qr-divider"><span>or</span></div>
          <button type="button" class="l-btn-ghost v-qr-fallback" id="v-qr-fallback-btn">
            Type the ID instead
          </button>
        </div>
      </div>
    </div>
  `;
}

// ────────────────────────────────────────────────────────────
// BINDINGS
// ────────────────────────────────────────────────────────────

function bindNav(router) {
  document.getElementById('nav-login-btn')?.addEventListener('click', () => {
    if (router && router.go) router.go('login');
    else window.location.href = '/login';
  });
  document.getElementById('nav-login-btn-m')?.addEventListener('click', () => {
    document.querySelector('.l-nav-links')?.classList.remove('l-nav-links-open');
    if (router && router.go) router.go('login');
    else window.location.href = '/login';
  });
  document.getElementById('l-logo-link')?.addEventListener('click', e => {
    e.preventDefault();
    if (router && router.go) router.go('landing');
    else window.location.href = '/';
  });
  document.getElementById('l-mobile-toggle')?.addEventListener('click', () => {
    document.querySelector('.l-nav-links')?.classList.toggle('l-nav-links-open');
  });
}

function bindVerifyForm() {
  const form = document.getElementById('v-form');
  const input = document.getElementById('v-cert-input');

  // Tab switching
  document.querySelectorAll('.v-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.v-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.getElementById('v-panel-enter').style.display = target === 'enter' ? 'block' : 'none';
      document.getElementById('v-panel-qr').style.display    = target === 'qr'    ? 'block' : 'none';
      if (target === 'enter') setTimeout(() => input?.focus(), 50);
    });
  });

  // QR fallback button → switch to Enter ID tab
  document.getElementById('v-qr-fallback-btn')?.addEventListener('click', () => {
    document.querySelector('.v-tab[data-tab="enter"]')?.click();
  });

  // Form submit → navigate with cert ID
  if (form && input) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const v = input.value.trim().replace(/\s+/g, '');
      if (!v) { input.focus(); return; }
      window.location.href = '/verify?cert=' + encodeURIComponent(v);
    });
    // Autofocus on load (desktop only — avoid keyboard popup on mobile)
    if (window.innerWidth > 768) setTimeout(() => input.focus(), 100);
  }
}

// ────────────────────────────────────────────────────────────
// STYLES
// ────────────────────────────────────────────────────────────

function injectVerifyStyles() {
  if (document.getElementById('verify-page-styles')) return;
  const s = document.createElement('style');
  s.id = 'verify-page-styles';
  s.textContent = `
    /* Verify section — inherits landing tokens */
    #flym-site-dark .v-section{
      padding:80px 24px 100px;
      background:var(--d-bg);
      min-height:calc(100vh - 200px);
      display:flex;align-items:flex-start;justify-content:center;
    }
    #flym-site-dark .v-section-inner{
      max-width:680px;width:100%;text-align:center;
    }
    #flym-site-dark .v-eyebrow{
      font-size:11px;color:var(--d-brand);
      letter-spacing:0.18em;font-weight:600;margin-bottom:14px;
      text-transform:uppercase;
    }
    #flym-site-dark .v-title{
      font-size:clamp(28px, 4vw, 42px);
      font-weight:200;color:var(--d-text);
      letter-spacing:-1.5px;line-height:1.15;margin-bottom:12px;
    }
    #flym-site-dark .v-subtitle{
      font-size:15px;color:var(--d-muted);
      line-height:1.6;margin-bottom:36px;
      max-width:480px;margin-left:auto;margin-right:auto;
    }
    #flym-site-dark .v-card{
      background:var(--d-surface);
      border:1px solid var(--d-border);
      border-radius:14px;padding:28px;
      text-align:left;
      box-shadow:0 8px 32px rgba(0,0,0,0.3);
    }

    /* Tabs */
    #flym-site-dark .v-tabs{
      display:flex;gap:8px;margin-bottom:20px;
      border-bottom:1px solid var(--d-border);padding-bottom:0;
    }
    #flym-site-dark .v-tab{
      background:none;border:none;color:var(--d-muted);
      padding:10px 14px;cursor:pointer;font-size:13px;font-weight:500;
      display:inline-flex;align-items:center;gap:7px;
      border-bottom:2px solid transparent;margin-bottom:-1px;
      font-family:inherit;transition:color 0.15s;
    }
    #flym-site-dark .v-tab:hover{color:var(--d-text);}
    #flym-site-dark .v-tab.active{
      color:var(--d-brand);border-bottom-color:var(--d-brand);
    }

    /* Input form */
    #flym-site-dark .v-input-label{
      display:block;font-size:12px;color:var(--d-muted);
      letter-spacing:0.05em;font-weight:500;margin-bottom:8px;
      text-transform:uppercase;
    }
    #flym-site-dark .v-input-row{
      display:flex;gap:10px;
    }
    #flym-site-dark .v-input{
      flex:1;background:var(--d-bg2);border:1px solid var(--d-border);
      color:var(--d-text);padding:13px 14px;border-radius:8px;
      font-size:15px;font-family:inherit;
      font-variant-numeric:tabular-nums;letter-spacing:0.02em;
      transition:border-color 0.15s, background 0.15s;
    }
    #flym-site-dark .v-input::placeholder{color:var(--d-muted2);}
    #flym-site-dark .v-input:focus{
      outline:none;border-color:var(--d-brand);
      background:rgba(42,143,255,0.05);
    }
    #flym-site-dark .v-submit{
      padding:13px 22px !important;font-size:14px !important;
      display:inline-flex;align-items:center;gap:8px;white-space:nowrap;
    }
    #flym-site-dark .v-hint{
      font-size:12px;color:var(--d-muted2);
      margin-top:10px;font-style:italic;
    }

    /* QR panel */
    #flym-site-dark .v-qr-container{
      text-align:center;padding:8px 0;
    }
    #flym-site-dark .v-qr-icon{
      width:88px;height:88px;border-radius:14px;
      background:rgba(42,143,255,0.08);
      border:1px solid rgba(42,143,255,0.2);
      display:inline-flex;align-items:center;justify-content:center;
      color:var(--d-brand);margin-bottom:16px;
    }
    #flym-site-dark .v-qr-title{
      font-size:18px;font-weight:600;color:var(--d-text);margin-bottom:8px;
    }
    #flym-site-dark .v-qr-sub{
      font-size:13.5px;color:var(--d-muted);
      line-height:1.6;max-width:380px;margin:0 auto 24px;
    }
    #flym-site-dark .v-qr-divider{
      display:flex;align-items:center;gap:12px;margin:20px 0 16px;
    }
    #flym-site-dark .v-qr-divider::before,
    #flym-site-dark .v-qr-divider::after{
      content:'';flex:1;height:1px;background:var(--d-border);
    }
    #flym-site-dark .v-qr-divider span{
      font-size:11px;color:var(--d-muted2);
      text-transform:uppercase;letter-spacing:0.15em;
    }
    #flym-site-dark .v-qr-fallback{font-size:13px !important;padding:9px 18px !important;}

    /* Result status */
    #flym-site-dark .v-status{
      display:flex;align-items:flex-start;gap:14px;
      padding:18px 20px;border-radius:10px;margin-bottom:20px;
    }
    #flym-site-dark .v-status-icon{
      width:42px;height:42px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      flex-shrink:0;
    }
    #flym-site-dark .v-status-title{font-size:16px;font-weight:600;line-height:1.3;}
    #flym-site-dark .v-status-sub{font-size:13px;line-height:1.55;margin-top:4px;}
    #flym-site-dark .v-status.valid{
      background:rgba(0,215,98,0.08);border:1px solid rgba(0,215,98,0.25);
    }
    #flym-site-dark .v-status.valid .v-status-icon{
      background:rgba(0,215,98,0.18);color:#00D762;
    }
    #flym-site-dark .v-status.valid .v-status-title{color:#00D762;}
    #flym-site-dark .v-status.valid .v-status-sub{color:var(--d-muted);}
    #flym-site-dark .v-status.revoked{
      background:rgba(255,184,0,0.08);border:1px solid rgba(255,184,0,0.25);
    }
    #flym-site-dark .v-status.revoked .v-status-icon{
      background:rgba(255,184,0,0.18);color:#FFB800;
    }
    #flym-site-dark .v-status.revoked .v-status-title{color:#FFB800;}
    #flym-site-dark .v-status.revoked .v-status-sub{color:var(--d-muted);}
    #flym-site-dark .v-status.invalid{
      background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);
    }
    #flym-site-dark .v-status.invalid .v-status-icon{
      background:rgba(239,68,68,0.18);color:#EF4444;
    }
    #flym-site-dark .v-status.invalid .v-status-title{color:#EF4444;}
    #flym-site-dark .v-status.invalid .v-status-sub{color:var(--d-muted);}

    /* Details */
    #flym-site-dark .v-details{
      background:var(--d-bg2);border:1px solid var(--d-border);
      border-radius:10px;overflow:hidden;
    }
    #flym-site-dark .v-row{
      display:flex;justify-content:space-between;align-items:flex-start;
      gap:16px;padding:13px 16px;
      border-bottom:1px solid var(--d-border);
    }
    #flym-site-dark .v-row:last-child{border-bottom:none;}
    #flym-site-dark .v-label{
      font-size:11px;color:var(--d-muted2);
      text-transform:uppercase;letter-spacing:0.08em;font-weight:500;flex-shrink:0;
    }
    #flym-site-dark .v-value{
      font-size:13.5px;color:var(--d-text);font-weight:500;
      text-align:right;max-width:65%;word-break:break-word;
      font-variant-numeric:tabular-nums;
    }
    #flym-site-dark .v-value-strong{font-size:14.5px;font-weight:600;}

    #flym-site-dark .v-actions{
      display:flex;justify-content:flex-end;margin-top:18px;
    }

    /* Help text */
    #flym-site-dark .v-help{
      margin-top:24px;font-size:13px;color:var(--d-muted2);
    }
    #flym-site-dark .v-help a{
      color:var(--d-brand);text-decoration:none;
    }
    #flym-site-dark .v-help a:hover{text-decoration:underline;}

    /* Mobile */
    @media(max-width:640px){
      #flym-site-dark .v-section{padding:48px 16px 64px;}
      #flym-site-dark .v-card{padding:20px;}
      #flym-site-dark .v-input-row{flex-direction:column;}
      #flym-site-dark .v-submit{width:100%;justify-content:center;}
      #flym-site-dark .v-tab{padding:9px 10px;font-size:12px;}
      #flym-site-dark .v-row{padding:11px 14px;}
      #flym-site-dark .v-value{font-size:12.5px;max-width:60%;}
    }
  `;
  document.head.appendChild(s);
}

// We need access to landing's injectLandingStyles. Since it's not exported,
// we inline a minimal copy here that just ensures the styles exist if missing.
function injectLandingStyles() {
  if (document.getElementById('landing-dark-styles')) return;
  // Style not yet on page (user landed directly on /verify) — load landing first
  // by dynamically importing it just for the style injection.
  // Easier: inline the critical landing tokens here.
  const s = document.createElement('style');
  s.id = 'landing-dark-styles';
  s.textContent = `
    #flym-site-dark {
      --d-bg:        #07090F;
      --d-bg2:       #0B0E16;
      --d-surface:   #0F1320;
      --d-border:    rgba(255,255,255,0.07);
      --d-border-strong: rgba(255,255,255,0.12);
      --d-text:      #F4F5F7;
      --d-text2:     #C2C7D0;
      --d-muted:     #9CA3AF;
      --d-muted2:    #6B7280;
      --d-brand:     #2A8FFF;
      --d-brand-hover: #4DA1FF;
      background:var(--d-bg);
      color:var(--d-text);
      font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height:100vh;
    }
    #flym-site-dark *, #flym-site-dark *::before, #flym-site-dark *::after { box-sizing: border-box; }
    #flym-site-dark a { color: inherit; text-decoration: none; }
    #flym-site-dark .l-nav {
      position:sticky;top:0;z-index:50;
      background:rgba(7,9,15,0.85);
      backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
      border-bottom:1px solid var(--d-border);
    }
    #flym-site-dark .l-nav-inner {
      max-width:1200px;margin:0 auto;padding:0 24px;height:64px;
      display:flex;align-items:center;justify-content:space-between;
    }
    #flym-site-dark .l-logo span {
      font-size:22px;font-weight:200;color:var(--d-text);
      letter-spacing:-0.5px;line-height:1;
    }
    #flym-site-dark .l-nav-links { display:flex;gap:28px;font-size:14px; }
    #flym-site-dark .l-nav-links a { color:var(--d-muted);transition:color 0.15s; }
    #flym-site-dark .l-nav-links a:hover { color:var(--d-text); }
    #flym-site-dark .l-nav-cta { display:flex;gap:10px;align-items:center; }
    #flym-site-dark .l-nav-mobile {
      display:none;background:none;border:none;color:var(--d-text);cursor:pointer;padding:6px;
    }
    #flym-site-dark .l-nav-mobile-actions { display:none; }
    #flym-site-dark .l-btn-ghost {
      background:transparent;border:1px solid var(--d-border-strong);color:var(--d-text);
      padding:9px 18px;border-radius:8px;font-size:13.5px;font-weight:500;
      cursor:pointer;font-family:inherit;transition:all 0.15s;
      display:inline-flex;align-items:center;gap:6px;
    }
    #flym-site-dark .l-btn-ghost:hover { background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.2); }
    #flym-site-dark .l-btn-primary {
      background:var(--d-brand);color:#fff;border:none;
      padding:9px 18px;border-radius:8px;font-size:13.5px;font-weight:600;
      cursor:pointer;font-family:inherit;transition:background 0.15s;
      display:inline-flex;align-items:center;gap:6px;
    }
    #flym-site-dark .l-btn-primary:hover { background:var(--d-brand-hover); }
    #flym-site-dark .l-footer {
      background:var(--d-bg2);border-top:1px solid var(--d-border);
      padding:48px 24px 24px;
    }
    #flym-site-dark .l-footer-inner {
      max-width:1200px;margin:0 auto;
      display:flex;justify-content:space-between;gap:40px;flex-wrap:wrap;
      padding-bottom:32px;border-bottom:1px solid var(--d-border);
    }
    #flym-site-dark .l-footer-brand p { color:var(--d-muted);font-size:13.5px;margin:8px 0 0; }
    #flym-site-dark .l-footer-cols { display:flex;gap:48px;flex-wrap:wrap; }
    #flym-site-dark .l-footer-cols h4 {
      font-size:11px;color:var(--d-muted2);text-transform:uppercase;
      letter-spacing:0.1em;font-weight:600;margin:0 0 10px;
    }
    #flym-site-dark .l-footer-cols a {
      display:block;color:var(--d-muted);font-size:13.5px;padding:3px 0;transition:color 0.15s;
    }
    #flym-site-dark .l-footer-cols a:hover { color:var(--d-text); }
    #flym-site-dark .l-footer-bottom {
      max-width:1200px;margin:0 auto;padding-top:20px;
      font-size:12px;color:var(--d-muted2);text-align:center;
    }
    @media(max-width:768px){
      #flym-site-dark .l-nav-links { display:none;position:absolute;top:64px;left:0;right:0;background:var(--d-bg);flex-direction:column;padding:16px 24px;border-bottom:1px solid var(--d-border);gap:0; }
      #flym-site-dark .l-nav-links.l-nav-links-open { display:flex; }
      #flym-site-dark .l-nav-links a { padding:10px 0; }
      #flym-site-dark .l-nav-mobile { display:block; }
      #flym-site-dark .l-nav-cta { display:none; }
      #flym-site-dark .l-nav-links.l-nav-links-open .l-nav-mobile-actions {
        display:flex;flex-direction:column;gap:10px;
        padding-top:12px;margin-top:4px;
        border-top:1px solid var(--d-border);
      }
      #flym-site-dark .l-nav-links.l-nav-links-open .l-nav-mobile-actions .l-btn-ghost,
      #flym-site-dark .l-nav-links.l-nav-links-open .l-nav-mobile-actions .l-btn-primary {
        width:100%;justify-content:center;min-height:44px;font-size:14px;
      }
      #flym-site-dark .l-footer-inner { flex-direction:column;gap:28px; }
      #flym-site-dark .l-footer-cols { gap:32px; }
    }
  `;
  document.head.appendChild(s);
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}