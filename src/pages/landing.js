// src/pages/landing.js — v8 COMPLETE REBUILD
// ─────────────────────────────────────────────────────────────────
// Full redesign inspired by dgymbook reference. Dark theme.
// Outlined E3 logo, floating pills, scroll reveal, 3D tilt,
// premium motion system, new sections, pricing grid.
// ─────────────────────────────────────────────────────────────────

export function renderLanding(router) {
  // Landing is always dark — independent of app theme preference
  const prevTheme = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', 'dark');
  window.__flymLandingRestoreTheme = () => {
    if (prevTheme) document.documentElement.setAttribute('data-theme', prevTheme);
  };

  injectLandingStyles();

  const MAILTO_REQUEST = "https://mail.google.com/mail/?view=cm&to=flym.system@gmail.com&su=Flym%20%E2%80%93%20Book%20a%20Demo&body=Hi%20Flym%20team%2C%0A%0AI%27d%20like%20to%20book%20a%20demo%20of%20the%20platform.%0A%0AGym%20Name%3A%0AOwner%20Name%3A%0APhone%3A%0ACity%3A%0A%0AThanks!";
  const WA_LINK = "https://wa.me/917019946481?text=Hi%2C%20I%27d%20like%20to%20know%20more%20about%20Flym";

  document.getElementById('root').innerHTML = `
  <div id="flym-site-dark">

    <!-- ═══ NAV ═══ -->
    <nav class="l-nav" id="l-nav">
      <div class="l-nav-inner">
        <a href="#" class="l-logo" id="l-logo-link"><svg viewBox="90 128 410 162" width="120" fill="none" xmlns="http://www.w3.org/2000/svg" class="l-logo-svg" aria-label="Flym">
<path opacity="0.4" d="M124 188C221.333 134.667 340 122.667 480 152" stroke="#2A8FFF" stroke-width="3.5" stroke-linecap="round"/>
<path d="M124 188C221.333 134.667 340 122.667 480 152" stroke="#2A8FFF" stroke-width="1.8" stroke-linecap="round"/>
<path d="M480 161C484.971 161 489 156.971 489 152C489 147.029 484.971 143 480 143C475.029 143 471 147.029 471 152C471 156.971 475.029 161 480 161Z" stroke="#2A8FFF" stroke-width="1.8"/>
<path d="M480 155.5C481.933 155.5 483.5 153.933 483.5 152C483.5 150.067 481.933 148.5 480 148.5C478.067 148.5 476.5 150.067 476.5 152C476.5 153.933 478.067 155.5 480 155.5Z" fill="#2A8FFF"/>
<path d="M141.144 254H138.184V148.328H141.144V254ZM100 180.888V177.928H112.876V161.056C112.876 158.096 113.32 155.728 114.208 153.952C115.096 152.324 116.428 151.14 117.908 150.252C119.388 149.364 121.016 148.92 122.792 148.624C124.568 148.476 126.196 148.328 127.824 148.328C129.156 148.328 130.34 148.476 131.376 148.624C132.412 148.772 133.3 148.92 134.188 148.92V151.88C132.708 151.732 131.524 151.584 130.488 151.436C129.304 151.436 128.268 151.288 127.232 151.288C122.496 151.288 119.388 152.176 117.908 153.952C116.428 155.728 115.836 158.392 115.836 162.092V177.928H132.264V180.888H115.836V254H112.876V180.888H100Z" fill="currentColor"/>
<path d="M210.557 178.224L176.961 266.58C174.889 271.76 172.669 275.312 170.005 277.236C167.341 279.012 163.197 280.048 157.425 280.048H155.205V277.236C155.797 277.236 156.389 277.384 156.981 277.384C161.273 277.384 164.677 276.792 167.193 275.608C169.561 274.424 171.485 272.056 172.965 268.356C174.741 264.36 176.517 259.328 178.589 253.26L146.769 178.224H150.025L180.217 250.004L207.597 178.224H210.557Z" fill="currentColor"/>
<path d="M220.803 178.224V196.132C224.799 183.108 233.087 176.596 245.815 176.596C251.735 176.596 256.767 178.076 260.615 181.184C264.463 184.292 266.979 188.584 268.459 194.208C272.603 182.368 280.743 176.448 292.879 176.448C300.871 176.448 306.939 178.668 310.935 183.404C314.783 187.992 316.855 194.356 316.855 202.496V254.148H313.747V201.46C313.747 194.652 311.971 189.176 308.419 185.328C304.867 181.332 299.687 179.408 292.731 179.408C285.627 179.408 279.855 181.628 275.563 186.364C271.271 190.952 269.199 197.02 269.199 204.568V254H266.239V202.644C266.239 195.54 264.463 189.916 261.207 185.624C257.803 181.48 252.475 179.26 245.371 179.26C237.971 179.26 232.051 182.072 227.611 187.696C223.023 193.32 220.803 200.572 220.803 209.748V254H217.843V178.224H220.803Z" fill="currentColor"/>
</svg></a>
        <div class="l-nav-links">
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#contact">Contact</a>
        </div>
        <div class="l-nav-right">
          <button class="l-btn-primary l-btn-sm" id="nav-login-btn">Log in</button>
        </div>
        <div class="l-nav-mobile-right">
          <button class="l-btn-primary l-btn-sm" id="nav-login-btn-mob">Log in</button>
        </div>
      </div>
    </nav>

    <!-- ═══ HERO ═══ -->
    <section class="l-hero">
      <div class="l-hero-glow" aria-hidden="true"></div>
      <div class="l-hero-inner">

        <div class="l-float-pill l-fp-1" aria-hidden="true">
          <span class="l-fp-icon l-fp-green">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          </span>
          <div><strong>12 new members</strong><span>This week</span></div>
        </div>
        <div class="l-float-pill l-fp-2" aria-hidden="true">
          <span class="l-fp-icon l-fp-blue">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </span>
          <div><strong>Revenue +27%</strong><span>vs last month</span></div>
        </div>
        <div class="l-float-pill l-fp-3" aria-hidden="true">
          <span class="l-fp-icon l-fp-amber">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          </span>
          <div><strong>3 reminders sent</strong><span>Just now</span></div>
        </div>

        <div class="l-hero-badge">Trusted by gym owners across India</div>

        <h1 class="l-hero-h1">Run your <span class="l-accent">gym</span> from your phone.</h1>

        <p class="l-hero-sub">Memberships, payments, reminders, reports \u2014 everything you need to manage your gym, right in your pocket.</p>

        <div class="l-hero-ctas">
          <a href="${MAILTO_REQUEST}" target="_blank" rel="noopener" class="l-btn-primary l-btn-lg">Book a Free Demo <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg></a>
          <a href="${WA_LINK}" target="_blank" rel="noopener" class="l-btn-ghost l-btn-lg l-btn-wa">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
            Chat on WhatsApp
          </a>
        </div>
      </div>
    </section>

    <!-- ═══ DASHBOARD SHOWCASE ═══ -->
    <section class="l-showcase">
      <div class="l-showcase-inner" id="l-showcase">
        <div class="l-showcase-frame">
          ${buildDashboardMockup()}
        </div>
        <div class="l-sc-card l-sc-card-1" aria-hidden="true">
          <div class="l-sc-label">Daily Report</div>
          <div class="l-sc-date">Today</div>
          <div class="l-sc-stats">
            <div><span class="l-sc-num" data-count="14">0</span><span class="l-sc-tag">New Members</span></div>
            <div><span class="l-sc-num" data-count="50">0</span><span class="l-sc-tag">Attendance</span></div>
          </div>
          <div class="l-sc-stats">
            <div><span class="l-sc-num l-sc-rupee" data-count="2000" data-prefix="\u20B9">\u20B90</span><span class="l-sc-tag">Earnings</span></div>
            <div><span class="l-sc-num" data-count="2">0</span><span class="l-sc-tag">Renewals</span></div>
          </div>
        </div>
        <div class="l-sc-card l-sc-card-2" aria-hidden="true">
          <div class="l-sc-label">Membership Renewal</div>
          <div class="l-sc-member">
            <div class="l-sc-avatar"><span>RK</span></div>
            <div><strong>Rahul K.</strong><span>#FLY1042</span></div>
            <span class="l-sc-amount">\u20B9999</span>
          </div>
          <div class="l-sc-actions">
            <span class="l-sc-btn l-sc-btn-outline">Settle payment</span>
            <span class="l-sc-btn l-sc-btn-primary">Renew</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ STATS BAR ═══ -->
    <section class="l-stats l-reveal">
      <div class="l-stats-inner">
        <div class="l-stat-item">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          <span class="l-stat-val" data-count="50">0</span><span class="l-stat-suffix">+</span>
          <span class="l-stat-label">Gyms</span>
        </div>
        <div class="l-stat-item">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span class="l-stat-val" data-count="5000">0</span><span class="l-stat-suffix">+</span>
          <span class="l-stat-label">Members</span>
        </div>
        <div class="l-stat-item">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          <span class="l-stat-val">4.8</span>
          <span class="l-stat-label">Rating</span>
        </div>
      </div>
    </section>

    <!-- ═══ PAIN POINTS ═══ -->
    <section class="l-pain l-reveal">
      <div class="l-section-inner">
        <h2 class="l-section-title">Sound familiar?</h2>
        <p class="l-section-sub">These are the problems gym owners deal with every day.</p>
        <div class="l-pain-grid">
          <div class="l-pain-card l-reveal-child">
            <span class="l-pain-icon l-pi-blue"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span>
            <h3>Drowning in paperwork</h3>
            <p>Notebooks, registers, and spreadsheets everywhere. You spend more time on admin than actually running your gym.</p>
          </div>
          <div class="l-pain-card l-reveal-child">
            <span class="l-pain-icon l-pi-amber"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
            <h3>Chasing payments manually</h3>
            <p>Members forget to pay, you forget to follow up, and revenue slips through the cracks every single month.</p>
          </div>
          <div class="l-pain-card l-reveal-child">
            <span class="l-pain-icon l-pi-red"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></span>
            <h3>No clue who\u2019s active</h3>
            <p>You can\u2019t tell which members are showing up, who\u2019s about to expire, or who needs a nudge to come back.</p>
          </div>
          <div class="l-pain-card l-reveal-child">
            <span class="l-pain-icon l-pi-green"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg></span>
            <h3>Can\u2019t manage remotely</h3>
            <p>If you\u2019re not physically at the gym, you have zero visibility into what\u2019s happening with your business.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ FEATURES ═══ -->
    <section class="l-features l-reveal" id="features">
      <div class="l-section-inner">
        <h2 class="l-section-title">Everything you need to run your gym</h2>
        <p class="l-section-sub">Built for real gym owners \u2014 simple, powerful, and mobile-first.</p>
        <div class="l-feat-grid-3">
          <div class="l-feat-card l-reveal-child">
            <span class="l-feat-icon l-fi-blue"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
            <h3>Member Management</h3>
            <p>Add members, track photos, manage details, and find anyone instantly. No paper, no chaos.</p>
            <div class="l-feat-preview">
              <div class="l-fp-row">
                <div class="l-fp-avatar"><span>RK</span></div>
                <div class="l-fp-info"><strong>Rahul K.</strong><span>+91 98765 43210</span></div>
                <div class="l-fp-icons">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72"/></svg>
                </div>
              </div>
              <div class="l-fp-meta">
                <span>1 Month Gold</span>
                <span class="l-fp-expiry">Expires in 10 days</span>
              </div>
            </div>
          </div>
          <div class="l-feat-card l-reveal-child">
            <span class="l-feat-icon l-fi-purple"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span>
            <h3>Automated Reminders</h3>
            <p>WhatsApp reminders go out before memberships expire \u2014 so you collect on time, every time.</p>
            <div class="l-feat-preview">
              <div class="l-fp-plan-row">
                <strong>1 Month Gold</strong>
                <span>\u20B9999</span>
              </div>
              <div class="l-fp-plan-sub">30 days</div>
            </div>
          </div>
          <div class="l-feat-card l-reveal-child">
            <span class="l-feat-icon l-fi-green"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M23 6l-9.5 9.5-5-5L1 18"/><polyline points="17 6 23 6 23 12"/></svg></span>
            <h3>Financial Reports</h3>
            <p>Get a clear view of revenue, outstanding balances, and daily income \u2014 right from your phone.</p>
            <div class="l-feat-preview l-feat-chart">
              <div class="l-fp-legend">
                <span><i class="l-dot l-dot-blue"></i> Membership</span>
                <span><i class="l-dot l-dot-red"></i> Payments</span>
              </div>
              <svg viewBox="0 0 200 60" class="l-mini-chart">
                <polyline points="10,45 35,40 60,35 85,42 110,20 135,30 160,15 185,22" fill="none" stroke="#2A8FFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <polyline points="10,50 35,48 60,52 85,38 110,35 135,42 160,28 185,35" fill="none" stroke="#E8593C" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>
              </svg>
            </div>
          </div>
        </div>
        <div class="l-feat-grid-2">
          <div class="l-feat-card l-feat-card-wide l-reveal-child">
            <span class="l-feat-icon l-fi-orange"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>
            <h3>Attendance Tracking</h3>
            <p>Log and monitor member attendance effortlessly. Know who\u2019s active and who needs a follow-up.</p>
            <div class="l-feat-preview">
              <div class="l-fp-attend-row"><span class="l-fp-date">21 Jun</span><span>104 members</span><span class="l-fp-chevron">&rsaquo;</span></div>
              <div class="l-fp-attend-row"><span class="l-fp-date">22 Jun</span><span>87 members</span><span class="l-fp-chevron">&rsaquo;</span></div>
              <div class="l-fp-attend-row l-fp-today"><span class="l-fp-date">Today</span><span>50 members</span><span class="l-fp-dot-green"></span><span class="l-fp-chevron">&rsaquo;</span></div>
            </div>
          </div>
          <div class="l-feat-card l-feat-card-wide l-reveal-child">
            <span class="l-feat-icon l-fi-red"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg></span>
            <h3>Multi-Branch Support</h3>
            <p>Manage multiple gym locations from a single account. Separate reports for each branch.</p>
            <div class="l-feat-preview">
              <div class="l-fp-branch">
                <strong>Expiring Soon</strong>
                <div class="l-fp-big-num">20</div>
                <span class="l-fp-arr">&rarr;</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ STEPS ═══ -->
    <section class="l-steps-section l-reveal" id="how">
      <div class="l-section-inner">
        <h2 class="l-section-title">Up and running in <span class="l-accent">3 steps</span></h2>
        <p class="l-section-sub">No tech skills required. Most gyms are live within 10 minutes.</p>
        <div class="l-steps-grid">
          <div class="l-step l-reveal-child">
            <div class="l-step-bg" aria-hidden="true">01</div>
            <div class="l-step-num">01</div>
            <h3>Sign up</h3>
            <p>Free to start. No setup fees, no credit card, no contracts.</p>
          </div>
          <div class="l-step-line" aria-hidden="true"></div>
          <div class="l-step l-reveal-child">
            <div class="l-step-bg" aria-hidden="true">02</div>
            <div class="l-step-num">02</div>
            <h3>Add your members</h3>
            <p>Import your existing list or add members one by one. Photos, plans, payment history \u2014 all in one place.</p>
          </div>
          <div class="l-step-line" aria-hidden="true"></div>
          <div class="l-step l-reveal-child">
            <div class="l-step-bg" aria-hidden="true">03</div>
            <div class="l-step-num">03</div>
            <h3>Let it run itself</h3>
            <p>Reminders, reports, renewals \u2014 fully automated. You focus on training, Flym handles the rest.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ PRICING ═══ -->
    <section class="l-pricing l-reveal" id="pricing">
      <div class="l-section-inner">
        <h2 class="l-section-title">One price. <span class="l-accent">Zero headaches.</span></h2>
        <p class="l-section-sub">Stop managing your gym. Start growing it.</p>
        <div class="l-price-grid l-price-grid-2">

          <!-- ── CORE ── -->
          <div class="l-price-card l-reveal-child">
            <h3 class="l-price-tier-name">FLYM CORE</h3>
            <div class="l-price-amount">
              <span class="l-price-val">\u20B96,999</span>
              <span class="l-price-period">/ year</span>
            </div>
            <p class="l-price-tagline">Everything needed to run your gym professionally.</p>
            <div class="l-price-divider"></div>
            <ul class="l-price-list">
              <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00D762" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg> Unlimited Members</li>
              <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00D762" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg> Membership & Renewals</li>
              <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00D762" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg> Attendance Tracking</li>
              <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00D762" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg> GST Billing</li>
              <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00D762" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg> Payment Collection</li>
              <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00D762" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg> Pending Balance Tracking</li>
              <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00D762" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg> Expense Manager</li>
              <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00D762" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg> Finance Dashboard</li>
              <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00D762" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg> Multi Branch</li>
              <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00D762" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg> Cloud Backup</li>
              <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00D762" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg> Mobile App (PWA)</li>
            </ul>
            <div class="l-price-bottom">
              <p class="l-price-bottom-text">Save 1\u20138 hours every week</p>
              <a href="${MAILTO_REQUEST}" target="_blank" rel="noopener" class="l-btn-ghost l-btn-lg l-price-cta">Get Started</a>
            </div>
          </div>

          <!-- ── PRO ── -->
          <div class="l-price-card l-price-pro l-reveal-child">
            <div class="l-price-badge l-pb-amber">\u2B50 MOST POPULAR</div>
            <h3 class="l-price-tier-name">FLYM PRO</h3>
            <div class="l-price-amount">
              <span class="l-price-val">\u20B99,999</span>
              <span class="l-price-period">/ year</span>
            </div>
            <p class="l-price-tagline">Built for gyms that want more renewals and less work.</p>
            <div class="l-price-divider"></div>
            <ul class="l-price-list">
              <li class="l-price-list-header"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00D762" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg> Everything in Core</li>
              <li class="l-price-list-pro">
                <span class="l-price-pro-icon l-ppi-green">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                </span>
                <div><strong>Auto WhatsApp Renewals</strong><span>Members never forget renewals</span></div>
              </li>
              <li class="l-price-list-pro">
                <span class="l-price-pro-icon l-ppi-blue">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </span>
                <div><strong>WhatsApp Broadcasts</strong><span>Promote offers instantly</span></div>
              </li>
              <li class="l-price-list-pro">
                <span class="l-price-pro-icon l-ppi-purple">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                </span>
                <div><strong>Staff Login</strong><span>Reception & trainers</span></div>
              </li>
              <li class="l-price-list-pro">
                <span class="l-price-pro-icon l-ppi-amber">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 6l-9.5 9.5-5-5L1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                </span>
                <div><strong>Growth Analytics</strong><span>Know exactly how your gym performs</span></div>
              </li>
            </ul>
            <div class="l-price-bottom">
              <p class="l-price-bottom-text">Recover more renewals with less manual work</p>
              <a href="${MAILTO_REQUEST}" target="_blank" rel="noopener" class="l-btn-primary l-btn-lg l-price-cta">Upgrade to Pro <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg></a>
            </div>
          </div>
        </div>
        <p class="l-price-trust l-reveal-child">Trusted by growing gyms across India.</p>
      </div>
    </section>

    <!-- ═══ CTA ═══ -->
    <section class="l-cta l-reveal" id="contact">
      <div class="l-section-inner" style="text-align:center;">
        <h2 class="l-section-title">Ready to simplify your gym?</h2>
        <p class="l-section-sub">Join gym owners who\u2019ve already made the switch.</p>
        <div class="l-hero-ctas" style="justify-content:center;">
          <a href="${MAILTO_REQUEST}" target="_blank" rel="noopener" class="l-btn-primary l-btn-lg">Book a Free Demo <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg></a>
          <a href="${WA_LINK}" target="_blank" rel="noopener" class="l-btn-ghost l-btn-lg l-btn-wa">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
            Chat on WhatsApp
          </a>
        </div>
      </div>
    </section>

    <!-- ═══ FOOTER ═══ -->
    <footer class="l-footer">
      <div class="l-footer-inner">
        <div class="l-footer-brand">
          <a href="#" class="l-logo"><svg viewBox="90 128 410 162" width="100" height="auto" fill="none" xmlns="http://www.w3.org/2000/svg" class="l-logo-svg" aria-label="Flym">
<path opacity="0.4" d="M124 188C221.333 134.667 340 122.667 480 152" stroke="#2A8FFF" stroke-width="3.5" stroke-linecap="round"/>
<path d="M124 188C221.333 134.667 340 122.667 480 152" stroke="#2A8FFF" stroke-width="1.8" stroke-linecap="round"/>
<path d="M480 161C484.971 161 489 156.971 489 152C489 147.029 484.971 143 480 143C475.029 143 471 147.029 471 152C471 156.971 475.029 161 480 161Z" stroke="#2A8FFF" stroke-width="1.8"/>
<path d="M480 155.5C481.933 155.5 483.5 153.933 483.5 152C483.5 150.067 481.933 148.5 480 148.5C478.067 148.5 476.5 150.067 476.5 152C476.5 153.933 478.067 155.5 480 155.5Z" fill="#2A8FFF"/>
<path d="M141.144 254H138.184V148.328H141.144V254ZM100 180.888V177.928H112.876V161.056C112.876 158.096 113.32 155.728 114.208 153.952C115.096 152.324 116.428 151.14 117.908 150.252C119.388 149.364 121.016 148.92 122.792 148.624C124.568 148.476 126.196 148.328 127.824 148.328C129.156 148.328 130.34 148.476 131.376 148.624C132.412 148.772 133.3 148.92 134.188 148.92V151.88C132.708 151.732 131.524 151.584 130.488 151.436C129.304 151.436 128.268 151.288 127.232 151.288C122.496 151.288 119.388 152.176 117.908 153.952C116.428 155.728 115.836 158.392 115.836 162.092V177.928H132.264V180.888H115.836V254H112.876V180.888H100Z" fill="currentColor"/>
<path d="M210.557 178.224L176.961 266.58C174.889 271.76 172.669 275.312 170.005 277.236C167.341 279.012 163.197 280.048 157.425 280.048H155.205V277.236C155.797 277.236 156.389 277.384 156.981 277.384C161.273 277.384 164.677 276.792 167.193 275.608C169.561 274.424 171.485 272.056 172.965 268.356C174.741 264.36 176.517 259.328 178.589 253.26L146.769 178.224H150.025L180.217 250.004L207.597 178.224H210.557Z" fill="currentColor"/>
<path d="M220.803 178.224V196.132C224.799 183.108 233.087 176.596 245.815 176.596C251.735 176.596 256.767 178.076 260.615 181.184C264.463 184.292 266.979 188.584 268.459 194.208C272.603 182.368 280.743 176.448 292.879 176.448C300.871 176.448 306.939 178.668 310.935 183.404C314.783 187.992 316.855 194.356 316.855 202.496V254.148H313.747V201.46C313.747 194.652 311.971 189.176 308.419 185.328C304.867 181.332 299.687 179.408 292.731 179.408C285.627 179.408 279.855 181.628 275.563 186.364C271.271 190.952 269.199 197.02 269.199 204.568V254H266.239V202.644C266.239 195.54 264.463 189.916 261.207 185.624C257.803 181.48 252.475 179.26 245.371 179.26C237.971 179.26 232.051 182.072 227.611 187.696C223.023 193.32 220.803 200.572 220.803 209.748V254H217.843V178.224H220.803Z" fill="currentColor"/>
</svg></a>
          <p>Smart gym management, right from your phone.</p>
        </div>
        <div class="l-footer-links">
          <h4>Product</h4>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#how">How it works</a>
        </div>
        <div class="l-footer-links">
          <h4>Company</h4>
          <a href="${MAILTO_REQUEST}" target="_blank" rel="noopener">Book a Demo</a>
          <a href="mailto:flym.system@gmail.com">Support</a>
          <a href="#contact">Contact</a>
        </div>
        <div class="l-footer-links">
          <h4>Connect</h4>
          <a href="https://www.instagram.com/flym.in/" target="_blank" rel="noopener">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg>
            Instagram
          </a>
          <a href="mailto:flym.system@gmail.com">flym.system@gmail.com</a>
          <a href="${WA_LINK}" target="_blank" rel="noopener">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="opacity:0.7"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
            WhatsApp
          </a>
        </div>
      </div>
      <div class="l-footer-bottom">
        <span>\u00A9 ${new Date().getFullYear()} Flym. All rights reserved.</span>
        <span class="l-footer-india">\u{1F1EE}\u{1F1F3} Made in India</span>
      </div>

          <a href="${WA_LINK}" target="_blank" rel="noopener" class="l-wa-float" aria-label="Chat on WhatsApp">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          </a>
    </footer>

  </div>`;

  bindEvents(router);
}

function buildDashboardMockup() {
  return `
    <div class="l-mock-browser">
      <div class="l-mock-dots"><span></span><span></span><span></span></div>
      <div class="l-mock-url">flym.in/dashboard</div>
    </div>
    <div class="l-mock-app">
      <div class="l-mock-side">
        <div class="l-mock-side-logo">flym</div>
        <div class="l-mock-side-img"><span class="l-mock-gym-logo">POWER<strong>FIT</strong></span></div>
        <div class="l-mock-side-gym">PowerFit Gym</div>
        <div class="l-mock-side-code">FLY30EH9N6</div>
        <div class="l-mock-side-badge">GYM OWNER</div>
        <div class="l-mock-side-sep"></div>
        <div class="l-mock-side-label">OVERVIEW</div>
        <div class="l-mock-side-item l-mock-active"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> Dashboard</div>
        <div class="l-mock-side-label">MEMBERS</div>
        <div class="l-mock-side-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg> All Members</div>
        <div class="l-mock-side-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/></svg> Alerts</div>
        <div class="l-mock-side-label">FINANCE</div>
        <div class="l-mock-side-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Finance</div>
        <div class="l-mock-side-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> Expenses</div>
      </div>
      <div class="l-mock-main">
        <div class="l-mock-topbar">
          <div><span class="l-mock-topbar-title">Dashboard</span></div>
          <div class="l-mock-topbar-right">
            <span class="l-mock-topbar-date">Sunday, 28 June 2026</span>
            <span class="l-mock-topbar-avatar">RK</span>
          </div>
        </div>
        <div class="l-mock-overview-title">Overview</div>
        <div class="l-mock-overview-sub">Your gym at a glance</div>
        <div class="l-mock-alert">
          <span class="l-mock-alert-icon">⚠</span>
          <span><strong>0 members expiring today</strong>, 1 expired in last 3 days</span>
          <span class="l-mock-alert-btn">View Alerts</span>
        </div>
        <div class="l-mock-stat-row">
          <div class="l-mock-stat l-mock-stat-blue"><div class="l-mock-stat-top"></div><span class="l-mock-stat-dot" style="background:var(--brand)"></span><span class="l-mock-stat-label">Total Members</span><span class="l-mock-stat-val">176</span><span class="l-mock-stat-meta">+49 this month</span></div>
          <div class="l-mock-stat l-mock-stat-green"><div class="l-mock-stat-top"></div><span class="l-mock-stat-dot" style="background:var(--green)"></span><span class="l-mock-stat-label">Active</span><span class="l-mock-stat-val">167</span><span class="l-mock-stat-meta">95% active rate</span></div>
          <div class="l-mock-stat l-mock-stat-red"><div class="l-mock-stat-top"></div><span class="l-mock-stat-dot" style="background:var(--red)"></span><span class="l-mock-stat-label">Payment Due</span><span class="l-mock-stat-val">9</span><span class="l-mock-stat-meta" style="color:var(--red)">Needs attention</span></div>
          <div class="l-mock-stat l-mock-stat-amber"><div class="l-mock-stat-top"></div><span class="l-mock-stat-dot" style="background:var(--amber)"></span><span class="l-mock-stat-label">Expiring Soon</span><span class="l-mock-stat-val">0</span><span class="l-mock-stat-meta">Next 7 days</span></div>
        </div>
        <div class="l-mock-renewal">
          <span class="l-mock-renewal-icon">📊</span>
          <div><strong style="color:var(--brand)">Expected Renewals (Next 30 Days)</strong><br><span style="color:var(--text-tertiary);font-size:11px">3 members due for renewal</span></div>
          <span class="l-mock-renewal-amount">₹7,000</span>
        </div>
      </div>
    </div>`;
}

function bindEvents(router) {
  const login = document.getElementById('nav-login-btn');
  if (login) login.addEventListener('click', () => router.go('login'));

  const loginMob = document.getElementById('nav-login-btn-mob');
  if (loginMob) loginMob.addEventListener('click', () => router.go('login'));

  const logo = document.getElementById('l-logo-link');
  if (logo) logo.addEventListener('click', (e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const target = a.getAttribute('href');
      if (target === '#' || target.length < 2) return;
      const el = document.querySelector(target);
      if (el) {
        e.preventDefault();
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // ── prefers-reduced-motion ──
  const noMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Scroll Reveal ──
  if (!noMotion) {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('l-visible');
          const kids = entry.target.querySelectorAll('.l-reveal-child');
          kids.forEach((k, i) => {
            k.style.transitionDelay = `${i * 120}ms`;
            requestAnimationFrame(() => k.classList.add('l-visible'));
          });
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.l-reveal').forEach(el => obs.observe(el));
  } else {
    document.querySelectorAll('.l-reveal, .l-reveal-child').forEach(el => el.classList.add('l-visible'));
  }

  // ── 3D Tilt on Showcase ──
  const showcase = document.getElementById('l-showcase');
  if (showcase && !noMotion) {
    const frame = showcase.querySelector('.l-showcase-frame');
    if (frame) {
      const onMove = (e) => {
        const r = showcase.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        frame.style.transform = `perspective(1200px) rotateX(${y * -6}deg) rotateY(${x * 8}deg) scale3d(1.02,1.02,1.02)`;
      };
      const onLeave = () => {
        frame.style.transform = 'perspective(1200px) rotateX(0) rotateY(0) scale3d(1,1,1)';
      };
      showcase.addEventListener('mousemove', onMove);
      showcase.addEventListener('mouseleave', onLeave);
      window.__flymLandingCleanup = () => {
        showcase.removeEventListener('mousemove', onMove);
        showcase.removeEventListener('mouseleave', onLeave);
      };
    }
  }

  // ── Nav scroll shadow ──
  const nav = document.getElementById('l-nav');
  if (nav) {
    const onScroll = () => {
      if (window.scrollY > 20) nav.classList.add('l-nav-scrolled');
      else nav.classList.remove('l-nav-scrolled');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    const prevClean = window.__flymLandingCleanup;
    window.__flymLandingCleanup = () => {
      window.removeEventListener('scroll', onScroll);
      if (prevClean) prevClean();
    };
  }

  // ── Scroll spy for nav active section ──
  const navLinks = document.querySelectorAll('#flym-site-dark .l-nav-links a[href^="#"]');
  const sections = [];
  navLinks.forEach(a => {
    const id = a.getAttribute('href').slice(1);
    const el = document.getElementById(id);
    if (el) sections.push({ el, link: a });
  });
  if (sections.length && !noMotion) {
    const spyScroll = () => {
      const scrollY = window.scrollY + 120;
      let active = null;
      sections.forEach(s => { if (s.el.offsetTop <= scrollY) active = s; });
      navLinks.forEach(a => a.classList.remove('l-nav-active'));
      if (active) active.link.classList.add('l-nav-active');
    };
    window.addEventListener('scroll', spyScroll, { passive: true });
    spyScroll();
    const prevClean2 = window.__flymLandingCleanup;
    window.__flymLandingCleanup = () => {
      window.removeEventListener('scroll', spyScroll);
      if (prevClean2) prevClean2();
    };
  }

  // ── Counter Animation ──
  if (!noMotion) {
    const counterObs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const els = entry.target.querySelectorAll('[data-count]');
        els.forEach(el => {
          const target = parseInt(el.dataset.count, 10);
          const prefix = el.dataset.prefix || '';
          const dur = 1400;
          const start = performance.now();
          const tick = (now) => {
            const p = Math.min((now - start) / dur, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            el.textContent = prefix + Math.round(eased * target).toLocaleString('en-IN');
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        counterObs.unobserve(entry.target);
      });
    }, { threshold: 0.4 });
    document.querySelectorAll('.l-stats, .l-sc-card').forEach(el => counterObs.observe(el));
  } else {
    document.querySelectorAll('[data-count]').forEach(el => {
      el.textContent = (el.dataset.prefix || '') + parseInt(el.dataset.count, 10).toLocaleString('en-IN');
    });
  }
}

function injectLandingStyles() {
  if (document.getElementById('landing-css')) return;
  const s = document.createElement('style');
  s.id = 'landing-css';
  s.textContent = `
    /* ═══ v8 Landing — uses tokens.css design system ═══ */

    /* ═══ BASE ═══ */
    #flym-site-dark {
      background: var(--surface-bg); color: var(--text-primary);
      font-family: var(--font-sans); font-size: 16px; line-height: 1.6;
      -webkit-font-smoothing: antialiased; overflow-x: hidden;
    }
    #flym-site-dark *, #flym-site-dark *::before, #flym-site-dark *::after {
      box-sizing: border-box;
    }
    #flym-site-dark a { color: inherit; text-decoration: none; }
    #flym-site-dark ul, #flym-site-dark li { list-style: none; margin: 0; padding: 0; }
    #flym-site-dark h1, #flym-site-dark h2, #flym-site-dark h3, #flym-site-dark h4, #flym-site-dark p { margin: 0; }

    #flym-site-dark .l-section-inner { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
    #flym-site-dark [id] { scroll-margin-top: 80px; }
    #flym-site-dark .l-section-title {
      font-size: clamp(32px, 5vw, 52px); font-weight: 700;
      letter-spacing: -0.03em; line-height: 1.15;
      text-align: center; margin-bottom: 16px;
    }
    #flym-site-dark .l-section-sub { text-align: center; font-size: 17px; color: var(--text-secondary); margin-bottom: 64px; }
    .l-accent {
      background: linear-gradient(135deg, #2A8FFF, #5CB8FF);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    /* ═══ BUTTONS ═══ */
    .l-btn-primary, .l-btn-ghost {
      display: inline-flex; align-items: center; gap: 8px;
      font-family: var(--font-sans); font-weight: 600; font-size: 15px;
      border-radius: var(--radius-lg); cursor: pointer; border: none;
      transition: all 0.3s var(--ease-out);
    }
    .l-btn-primary {
      background: var(--brand); color: #fff; padding: 12px 24px;
      box-shadow: 0 2px 8px var(--brand-fade);
    }
    .l-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 24px var(--brand-fade-strong); }
    .l-btn-primary:active { transform: translateY(0) scale(0.97); transition-duration: 0.1s; }
    .l-btn-ghost {
      background: transparent; color: var(--text-primary);
      border: 1px solid var(--border-strong); padding: 12px 24px;
    }
    .l-btn-ghost:hover { transform: translateY(-2px); border-color: rgba(255,255,255,0.18); box-shadow: 0 4px 20px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.06) inset; }
    .l-btn-ghost:active { transform: translateY(0) scale(0.97); transition-duration: 0.1s; }
    .l-btn-sm { padding: 8px 16px; font-size: 13px; border-radius: var(--radius-sm); }
    .l-btn-lg { padding: 14px 28px; font-size: 16px; border-radius: var(--radius-lg); }

    /* ═══ NAV ═══ */
    #flym-site-dark .l-nav {
      position: sticky; top: 0; z-index: 999;
      background: rgba(10, 11, 15, 0.85); backdrop-filter: saturate(180%) blur(20px);
      border-bottom: 1px solid var(--border-subtle);
      transition: background 0.3s, box-shadow 0.3s, border-color 0.3s;
    }
    #flym-site-dark .l-nav.l-nav-scrolled {
      background: rgba(10, 11, 15, 0.96);
      box-shadow: 0 1px 0 rgba(255,255,255,0.04), 0 8px 32px rgba(0,0,0,0.4);
      border-color: transparent;
    }
    #flym-site-dark .l-nav-inner {
      max-width: 1200px; margin: 0 auto; padding: 0 24px;
      display: flex; align-items: center; justify-content: space-between; height: 64px;
    }
    .l-logo { display: inline-flex; align-items: center; flex-shrink: 0; }
    .l-logo-svg { display: block; color: var(--text-primary); }
    .l-nav-links { display: flex; gap: 32px; }
    .l-nav-links a {
      font-size: 14px; font-weight: 500; color: var(--text-secondary);
      position: relative; transition: color 0.25s;
    }
    .l-nav-links a:hover { color: var(--text-primary); }
    .l-nav-links a::after {
      content: ''; position: absolute; bottom: -4px; left: 0; right: 0;
      height: 2px; background: linear-gradient(90deg, var(--brand), #5CB8FF); border-radius: 1px;
      transform: scaleX(0); transition: transform 0.25s var(--ease-out);
    }
    .l-nav-links a:hover::after { transform: scaleX(1); }
    .l-nav-right { display: flex; gap: 10px; align-items: center; }
    .l-nav-mobile-right { display: none; align-items: center; gap: 8px; }
    .l-nav-mobile-actions { display: none; }

    /* ═══ HERO ═══ */
    #flym-site-dark .l-hero { position: relative; text-align: center; padding: 100px 24px 60px; overflow: visible; }
    #flym-site-dark .l-hero-badge { animation: l-hero-el 0.8s cubic-bezier(.16,1,.3,1) 0.1s both; }
    #flym-site-dark .l-hero-h1 { animation: l-hero-el 0.9s cubic-bezier(.16,1,.3,1) 0.2s both; }
    #flym-site-dark .l-hero-sub { animation: l-hero-el 0.8s cubic-bezier(.16,1,.3,1) 0.35s both; }
    #flym-site-dark .l-hero-ctas { animation: l-hero-el 0.8s cubic-bezier(.16,1,.3,1) 0.5s both; }
    @keyframes l-hero-el { from { opacity:0; transform:translateY(24px); filter:blur(4px); } to { opacity:1; transform:translateY(0); filter:blur(0); } }
    #flym-site-dark .l-hero-glow {
      position: absolute; inset: -20%; z-index: 0; pointer-events: none;
      background:
        radial-gradient(ellipse 60% 50% at 35% 40%, rgba(42,143,255,0.12) 0%, transparent 100%),
        radial-gradient(ellipse 40% 40% at 70% 55%, rgba(0,215,98,0.06) 0%, transparent 100%),
        radial-gradient(ellipse 50% 40% at 50% 25%, rgba(139,92,246,0.06) 0%, transparent 100%);
      animation: l-glow-pulse 8s ease-in-out infinite;
    }
    @keyframes l-glow-pulse { 0%,100%{opacity:1} 50%{opacity:0.7} }
    #flym-site-dark .l-hero::before {
      content: ""; position: absolute; inset: 0;
      background-image: radial-gradient(rgba(255,255,255,0.018) 1px, transparent 1px);
      background-size: 32px 32px;
      pointer-events: none; z-index: 0; opacity: 0.6;
    }
    #flym-site-dark .l-hero-inner { position: relative; z-index: 1; max-width: 900px; margin: 0 auto; }
    #flym-site-dark .l-hero-badge {
      display: inline-block; padding: 8px 20px;
      background: var(--surface-2); border: 1px solid var(--border-strong);
      border-radius: var(--radius-pill); font-size: 13px; font-weight: 500;
      color: var(--text-secondary); margin-bottom: 32px;
    }
    #flym-site-dark .l-hero-h1 {
      font-size: clamp(36px, 6vw, 68px); font-weight: 700;
      line-height: 1.08; letter-spacing: -0.04em;
      margin-bottom: 24px; color: var(--text-primary);
    }
    #flym-site-dark .l-hero-sub {
      font-size: 18px; color: var(--text-secondary); max-width: 560px;
      margin: 0 auto 40px; line-height: 1.6;
    }
    #flym-site-dark .l-hero-ctas { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }

    /* ═══ FLOATING PILLS ═══ */
    .l-float-pill {
      position: absolute; display: flex; align-items: center; gap: 10px;
      padding: 10px 16px 10px 12px;
      background: rgba(15,18,25,0.85); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.08);
      border-radius: var(--radius-lg);
      box-shadow: 0 8px 32px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.04) inset;
      z-index: 2; pointer-events: none; opacity: 0;
      white-space: nowrap;
    }
    .l-float-pill strong { font-size: 13px; font-weight: 600; color: var(--text-primary); display: block; }
    .l-float-pill span { font-size: 11px; color: var(--text-tertiary); }
    .l-fp-icon {
      width: 34px; height: 34px; border-radius: var(--radius-md);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .l-fp-green  { background: var(--green-fade); color: var(--green); }
    .l-fp-blue   { background: var(--brand-fade); color: var(--brand); }
    .l-fp-amber  { background: var(--amber-fade); color: var(--amber); }

    .l-fp-1 { left: -10%; top: 30%; }
    .l-fp-2 { right: -10%; top: 10%; }
    .l-fp-3 { right: -6%; bottom: 10%; }
    .l-fp-1 { animation: l-pin 0.5s cubic-bezier(.23,1,.32,1) 0.3s forwards, l-fa 5s ease-in-out 0.8s infinite; }
    .l-fp-2 { animation: l-pin 0.5s cubic-bezier(.23,1,.32,1) 0.6s forwards, l-fb 6s ease-in-out 1.1s infinite; }
    .l-fp-3 { animation: l-pin 0.5s cubic-bezier(.23,1,.32,1) 0.9s forwards, l-fc 5.5s ease-in-out 1.4s infinite; }

    @keyframes l-sc-in-left { from{opacity:0;transform:translateX(-30px) translateY(10px) scale(.92)} to{opacity:1;transform:translateX(0) translateY(0) scale(1)} }
    @keyframes l-sc-in-right { from{opacity:0;transform:translateX(30px) translateY(10px) scale(.92)} to{opacity:1;transform:translateX(0) translateY(0) scale(1)} }
    @keyframes l-pin { from{opacity:0;transform:translateY(20px) scale(.9)} to{opacity:1;transform:translateY(0) scale(1)} }
    @keyframes l-fa { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
    @keyframes l-fb { 0%,100%{transform:translateY(0)} 50%{transform:translateY(4px)} }
    @keyframes l-fc { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }

    /* ═══ SHOWCASE ═══ */
    #flym-site-dark .l-showcase { padding: 0 24px 80px; position: relative; }
    #flym-site-dark .l-showcase-inner { position: relative; max-width: 900px; margin: 0 auto; }
    #flym-site-dark .l-showcase::before {
      content: ""; position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%); width: 80%; height: 90%;
      background: radial-gradient(ellipse, rgba(42,143,255,0.06) 0%, transparent 65%);
      pointer-events: none; z-index: 0;
    }
    #flym-site-dark .l-showcase-frame {
      width: 100%; position: relative; z-index: 1;
      transition: transform 0.5s cubic-bezier(.16,1,.3,1), box-shadow 0.5s ease;
      will-change: transform;
      animation: l-sc-entrance 1s cubic-bezier(.16,1,.3,1) 0.6s both, l-sf 8s ease-in-out 1.6s infinite;
    }
    @keyframes l-sc-entrance { from{opacity:0;transform:translateY(40px) scale(0.95)} to{opacity:1;transform:translateY(0) scale(1)} }
    @keyframes l-sf { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }

    #flym-site-dark .l-showcase-frame {
      box-shadow:
        0 0 0 1px rgba(255,255,255,0.05) inset,
        0 2px 4px rgba(0,0,0,0.1),
        0 12px 24px -4px rgba(0,0,0,0.3),
        0 40px 80px -12px rgba(0,0,0,0.55),
        0 0 160px -40px rgba(42,143,255,0.25);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }
    .l-showcase-frame:hover {
      box-shadow:
        0 0 0 1px rgba(255,255,255,0.08) inset,
        0 2px 4px rgba(0,0,0,0.1),
        0 16px 32px -4px rgba(0,0,0,0.35),
        0 56px 100px -12px rgba(0,0,0,0.6),
        0 0 200px -30px rgba(42,143,255,0.35);
    }
    .l-mock-app { border-bottom: 1px solid rgba(255,255,255,0.03); }
    .l-mock-browser {
      background: var(--surface-1); border: 1px solid var(--border-strong);
      border-radius: var(--radius-lg) var(--radius-lg) 0 0; padding: 12px 16px;
      display: flex; align-items: center; gap: 10px;
    }
    .l-mock-dots { display: flex; gap: 6px; }
    .l-mock-dots span { width: 10px; height: 10px; border-radius: 50%; }
    .l-mock-dots span:nth-child(1) { background: #FF5F57; }
    .l-mock-dots span:nth-child(2) { background: #FFBD2E; }
    .l-mock-dots span:nth-child(3) { background: #28CA41; }
    .l-mock-url {
      flex: 1; background: var(--surface-bg); border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm); padding: 4px 12px; font-size: 12px;
      color: var(--text-tertiary); font-family: var(--font-mono);
    }
    .l-mock-app {
      display: grid; grid-template-columns: 160px 1fr;
      background: var(--surface-bg); border: 1px solid var(--border-strong);
      border-top: none; border-radius: 0 0 var(--radius-lg) var(--radius-lg);
      min-height: 280px; overflow: hidden;
    }
    .l-mock-side {
      background: var(--surface-1); border-right: 1px solid var(--border-subtle); padding: 16px 0;
    }
    .l-mock-side-logo { padding: 0 16px 16px; font-size: 18px; font-weight: 200; letter-spacing: -0.03em; }
    .l-mock-side-item { padding: 8px 16px; font-size: 13px; color: var(--text-tertiary); }
    .l-mock-active { color: var(--brand); font-weight: 500; background: var(--brand-fade); }
    .l-mock-main { padding: 20px; }
    .l-mock-topbar { display: flex; justify-content: space-between; margin-bottom: 16px; }
    .l-mock-greeting { font-size: 14px; font-weight: 600; }
    .l-mock-gym { font-size: 12px; color: var(--text-tertiary); }
    .l-mock-stat-row { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-bottom: 16px; }
    .l-mock-stat {
      background: var(--surface-1); border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md); padding: 12px; text-align: center;
    }
    .l-mock-stat-val { display: block; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .l-mock-stat-label { font-size: 11px; color: var(--text-tertiary); }
    .l-mock-chart {
      background: var(--surface-1); border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md); padding: 12px;
    }


    /* Enhanced mockup */
    .l-mock-side-img { width: 80%; margin: 0 auto 8px; height: 48px; background: var(--surface-2); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
    .l-mock-side-gym { padding: 0 16px; font-size: 12px; font-weight: 600; }
    .l-mock-side-code { padding: 0 16px; font-size: 10px; color: var(--text-tertiary); margin-bottom: 4px; }
    .l-mock-side-badge { margin: 0 16px 12px; display: inline-block; padding: 2px 8px; background: var(--brand-fade); color: var(--brand); font-size: 9px; font-weight: 700; border-radius: 4px; letter-spacing: 0.05em; }
    .l-mock-side-sep { height: 1px; background: var(--border-subtle); margin: 4px 16px 8px; }
    .l-mock-side-label { padding: 8px 16px 4px; font-size: 9px; font-weight: 600; color: var(--text-tertiary); letter-spacing: 0.08em; text-transform: uppercase; }
    .l-mock-side-item { display: flex; align-items: center; gap: 8px; }
    .l-mock-topbar-title { font-size: 15px; font-weight: 600; }
    .l-mock-topbar-right { display: flex; align-items: center; gap: 10px; }
    .l-mock-topbar-date { font-size: 11px; color: var(--text-tertiary); }
    .l-mock-topbar-avatar { width: 28px; height: 28px; border-radius: 50%; background: var(--amber); color: #000; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
    .l-mock-overview-title { font-size: 16px; font-weight: 700; margin-bottom: 2px; }
    .l-mock-overview-sub { font-size: 12px; color: var(--text-tertiary); margin-bottom: 14px; }
    .l-mock-alert {
      display: flex; align-items: center; gap: 10px;
      background: var(--amber-fade); border: 1px solid rgba(255,176,32,0.15);
      border-radius: var(--radius-md); padding: 10px 14px; margin-bottom: 14px; font-size: 12px;
    }
    .l-mock-alert-icon { font-size: 16px; }
    .l-mock-alert-btn { margin-left: auto; padding: 4px 10px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); font-size: 10px; font-weight: 600; white-space: nowrap; }
    .l-mock-stat-top { height: 3px; border-radius: 2px 2px 0 0; position: absolute; top: 0; left: 0; right: 0; }
    .l-mock-stat { position: relative; display: flex; flex-direction: column; gap: 2px; }
    .l-mock-stat-blue .l-mock-stat-top { background: var(--brand); }
    .l-mock-stat-green .l-mock-stat-top { background: var(--green); }
    .l-mock-stat-red .l-mock-stat-top { background: var(--red); }
    .l-mock-stat-amber .l-mock-stat-top { background: var(--amber); }
    .l-mock-stat-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; margin-bottom: 2px; }
    .l-mock-stat-meta { font-size: 10px; color: var(--text-tertiary); }
    .l-mock-renewal {
      display: flex; align-items: center; gap: 10px;
      background: var(--brand-fade); border: 1px solid rgba(42,143,255,0.12);
      border-radius: var(--radius-md); padding: 10px 14px; margin-top: 10px; font-size: 12px;
    }
    .l-mock-renewal-icon { font-size: 18px; }
    .l-mock-renewal-amount { margin-left: auto; font-size: 18px; font-weight: 700; color: var(--green); }


    /* Gym logo text in mockup */
    .l-mock-gym-logo {
      display: flex; align-items: center; justify-content: center;
      width: 100%; height: 100%; font-size: 11px; font-weight: 300;
      letter-spacing: 0.15em; color: var(--text-secondary); text-transform: uppercase;
    }
    .l-mock-gym-logo strong { font-weight: 700; color: var(--text-primary); margin-left: 2px; }
    .l-mock-side-img {
      width: 80%; margin: 0 auto 8px; height: 48px;
      background: linear-gradient(135deg, var(--surface-2) 0%, rgba(42,143,255,0.08) 100%);
      border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: hidden;
    }
    /* Avatar initials */
    .l-sc-avatar span, .l-fp-avatar span {
      display: flex; align-items: center; justify-content: center;
      width: 100%; height: 100%; font-size: 11px; font-weight: 700;
      color: var(--text-primary); background: linear-gradient(135deg, var(--brand), #5CB8FF);
      border-radius: 50%; color: #fff;
    }

    /* Floating showcase cards */
    .l-sc-card {
      position: absolute; background: rgba(15,18,25,0.88); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.07);
      border-radius: var(--radius-lg); padding: 16px 20px; z-index: 2;
      box-shadow: var(--shadow-lg); opacity: 0; pointer-events: none;
    }
    .l-sc-card-1 {
      left: -22%; top: 8%;
      animation: l-sc-in-left 0.7s cubic-bezier(.23,1,.32,1) 0.8s forwards, l-fa 6s ease-in-out 1.5s infinite;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04) inset;
    }
    .l-sc-card-2 {
      right: -22%; top: 38%;
      animation: l-sc-in-right 0.7s cubic-bezier(.23,1,.32,1) 1.1s forwards, l-fb 5.5s ease-in-out 1.8s infinite;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04) inset;
    }
    .l-sc-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 2px; }
    .l-sc-date { font-size: 11px; color: var(--text-tertiary); margin-bottom: 12px; }
    .l-sc-stats { display: flex; gap: 20px; margin-bottom: 8px; }
    .l-sc-num { font-size: 18px; font-weight: 700; display: block; }
    .l-sc-tag { font-size: 10px; color: var(--text-tertiary); }
    .l-sc-member { display: flex; align-items: center; gap: 10px; margin: 10px 0; }
    .l-sc-avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--surface-2); border: 1px solid var(--border-strong); flex-shrink: 0; }
    .l-sc-member strong { font-size: 13px; display: block; }
    .l-sc-member span { font-size: 11px; color: var(--text-tertiary); }
    .l-sc-amount { margin-left: auto; font-weight: 700; font-size: 15px; color: var(--green); }
    .l-sc-actions { display: flex; gap: 8px; }
    .l-sc-btn { padding: 6px 14px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 600; }
    .l-sc-btn-outline { background: transparent; border: 1px solid var(--border-strong); color: var(--text-secondary); }
    .l-sc-btn-primary { background: var(--brand); color: #fff; border: none; }

    /* ═══ STATS BAR ═══ */
    #flym-site-dark .l-stats {
      padding: 60px 24px;
      border-top: 1px solid var(--border-subtle); border-bottom: 1px solid var(--border-subtle);
      background: linear-gradient(180deg, rgba(42,143,255,0.02) 0%, transparent 50%, rgba(42,143,255,0.02) 100%);
    }
    #flym-site-dark .l-stats-inner { max-width: 800px; margin: 0 auto; display: flex; justify-content: center; gap: 48px; flex-wrap: wrap; }
    .l-stat-item { display: flex; align-items: center; gap: 10px; transition: transform 0.3s var(--ease-out); }
    .l-stat-item:hover {
      transform: translateY(-4px) scale(1.03);
      transition-duration: 0.25s;
    }
    .l-stat-item { cursor: default; }
    .l-stat-item svg { color: var(--brand); opacity: 0.7; }
    .l-stat-val { font-size: 32px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .l-stat-suffix { font-size: 24px; font-weight: 600; color: var(--text-secondary); }
    .l-stat-label { font-size: 14px; color: var(--text-tertiary); margin-left: -4px; }

    /* ═══ PAIN POINTS ═══ */
    #flym-site-dark .l-pain { padding: 120px 0; position: relative; }
    #flym-site-dark .l-pain::after {
      content: ""; position: absolute; top: 50%; right: 0;
      width: 300px; height: 300px; transform: translateY(-50%);
      background: radial-gradient(circle, rgba(42,143,255,0.04) 0%, transparent 70%);
      pointer-events: none;
    }
    #flym-site-dark .l-pain-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 20px; }
    .l-pain-card:nth-child(1).l-visible { animation: l-card-in-left 0.6s cubic-bezier(.16,1,.3,1) both; }
    .l-pain-card:nth-child(2).l-visible { animation: l-card-in-right 0.6s cubic-bezier(.16,1,.3,1) 0.1s both; }
    .l-pain-card:nth-child(3).l-visible { animation: l-card-in-left 0.6s cubic-bezier(.16,1,.3,1) 0.2s both; }
    .l-pain-card:nth-child(4).l-visible { animation: l-card-in-right 0.6s cubic-bezier(.16,1,.3,1) 0.3s both; }
    @keyframes l-card-in-left { from{opacity:0;transform:translateX(-20px) translateY(16px)} to{opacity:1;transform:translateX(0) translateY(0)} }
    @keyframes l-card-in-right { from{opacity:0;transform:translateX(20px) translateY(16px)} to{opacity:1;transform:translateX(0) translateY(0)} }
    .l-pain-card {
      background: var(--surface-1); border: 1px solid var(--border-subtle);
      border-radius: var(--radius-xl); padding: 32px 28px;
      transition: transform 0.35s var(--ease-out), box-shadow 0.35s ease, border-color 0.3s;
    }
    .l-pain-card:hover {
      transform: translateY(-5px) translateX(2px);
      border-color: rgba(255,255,255,0.1);
      box-shadow: 0 16px 40px -8px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05) inset;
      transition-duration: 0.3s;
    }
    .l-pain-icon {
      width: 48px; height: 48px; border-radius: var(--radius-lg);
      display: flex; align-items: center; justify-content: center; margin-bottom: 20px;
    }
    .l-pi-blue  { background: var(--brand-fade); color: var(--brand); }
    .l-pi-amber { background: var(--amber-fade); color: var(--amber); }
    .l-pi-red   { background: var(--red-fade); color: var(--red); }
    .l-pi-green { background: var(--green-fade); color: var(--green); }
    .l-pain-card h3 { font-size: 18px; font-weight: 700; margin-bottom: 10px; }
    .l-pain-card p  { font-size: 14px; color: var(--text-secondary); line-height: 1.6; }

    /* ═══ FEATURES ═══ */
    #flym-site-dark .l-features { padding: 120px 0; position: relative; }
    #flym-site-dark .l-features::after {
      content: ""; position: absolute; top: 30%; left: 0;
      width: 300px; height: 400px;
      background: radial-gradient(circle, rgba(139,92,246,0.03) 0%, transparent 70%);
      pointer-events: none;
    }
    #flym-site-dark .l-feat-grid-3 { display: grid; grid-template-columns: repeat(3,1fr); gap: 20px; margin-bottom: 20px; }
    #flym-site-dark .l-feat-grid-2 { display: grid; grid-template-columns: repeat(2,1fr); gap: 20px; }
    .l-feat-card {
      background: var(--surface-1); border: 1px solid var(--border-subtle);
      border-radius: var(--radius-xl); padding: 32px 28px;
      transition: transform 0.35s var(--ease-out), box-shadow 0.35s ease, border-color 0.3s;
    }
    .l-feat-card:hover {
      transform: translateY(-6px) scale(1.01);
      border-color: rgba(255,255,255,0.12);
      box-shadow: 0 4px 8px rgba(0,0,0,0.1), 0 20px 48px -8px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06) inset;
    }
    .l-feat-card:nth-child(1):hover { box-shadow: 0 4px 8px rgba(0,0,0,0.1), 0 24px 56px -8px rgba(42,143,255,0.2), 0 0 0 1px rgba(42,143,255,0.08); }
    .l-feat-card:nth-child(2):hover { box-shadow: 0 4px 8px rgba(0,0,0,0.1), 0 24px 56px -8px rgba(139,92,246,0.2), 0 0 0 1px rgba(139,92,246,0.08); }
    .l-feat-card:nth-child(3):hover { box-shadow: 0 4px 8px rgba(0,0,0,0.1), 0 24px 56px -8px rgba(0,215,98,0.2), 0 0 0 1px rgba(0,215,98,0.08); }
    .l-feat-card:hover .l-feat-icon { transform: scale(1.08) rotate(-4deg); }
    .l-feat-card-wide:nth-child(1):hover { box-shadow: 0 4px 8px rgba(0,0,0,0.1), 0 24px 56px -8px rgba(255,176,32,0.15), 0 0 0 1px rgba(255,176,32,0.06); }
    .l-feat-card-wide:nth-child(2):hover { box-shadow: 0 4px 8px rgba(0,0,0,0.1), 0 24px 56px -8px rgba(255,85,85,0.15), 0 0 0 1px rgba(255,85,85,0.06); }
    .l-feat-icon {
      width: 48px; height: 48px; border-radius: var(--radius-lg);
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 20px; transition: transform 0.3s var(--ease-out);
    }
    .l-fi-blue   { background: var(--brand-fade); color: var(--brand); }
    .l-fi-purple { background: var(--purple-fade); color: var(--purple); }
    .l-fi-green  { background: var(--green-fade); color: var(--green); }
    .l-fi-orange { background: var(--amber-fade); color: var(--amber); }
    .l-fi-red    { background: var(--red-fade); color: var(--red); }
    .l-feat-card h3 { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
    .l-feat-card p  { font-size: 14px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 20px; }

    /* Feature mini-previews */
    .l-feat-preview { background: var(--surface-bg); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 14px; }
    .l-fp-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .l-fp-avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--surface-2); border: 1px solid var(--border-strong); flex-shrink: 0; }
    .l-fp-info strong { font-size: 13px; display: block; }
    .l-fp-info span { font-size: 11px; color: var(--text-tertiary); }
    .l-fp-icons { margin-left: auto; display: flex; gap: 8px; color: var(--text-tertiary); }
    .l-fp-meta { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-secondary); }
    .l-fp-expiry { color: var(--amber); }
    .l-fp-plan-row { display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: 600; }
    .l-fp-plan-sub { font-size: 12px; color: var(--text-tertiary); margin-top: 4px; }
    .l-fp-legend { display: flex; gap: 14px; font-size: 11px; color: var(--text-secondary); margin-bottom: 8px; }
    .l-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; margin-right: 4px; vertical-align: middle; }
    .l-dot-blue { background: var(--brand); }
    .l-dot-red  { background: var(--red); }
    .l-mini-chart { width: 100%; height: auto; }
    .l-fp-attend-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border-subtle); font-size: 13px; color: var(--text-secondary); }
    .l-fp-attend-row:last-child { border-bottom: none; }
    .l-fp-date { font-size: 12px; font-weight: 600; padding: 3px 8px; background: var(--surface-2); border-radius: var(--radius-sm); color: var(--text-primary); }
    .l-fp-today .l-fp-date { background: var(--brand-fade); color: var(--brand); }
    .l-fp-chevron { margin-left: auto; color: var(--text-tertiary); font-size: 18px; }
    .l-fp-dot-green { width: 8px; height: 8px; border-radius: 50%; background: var(--green); }
    .l-fp-branch { text-align: center; padding: 8px 0; }
    .l-fp-branch strong { font-size: 14px; display: block; margin-bottom: 4px; }
    .l-fp-big-num { font-size: 48px; font-weight: 700; margin: 4px 0; }
    .l-fp-arr { font-size: 24px; color: var(--text-tertiary); }

    /* ═══ STEPS ═══ */
    #flym-site-dark .l-steps-section { padding: 120px 0; }
    #flym-site-dark .l-steps-grid { display: flex; align-items: flex-start; justify-content: center; gap: 0; max-width: 1000px; margin: 0 auto; }
    .l-step {
      flex: 1; max-width: 320px; text-align: center;
      background: var(--surface-1); border: 1px solid var(--border-subtle);
      border-radius: var(--radius-xl); padding: 40px 28px 32px;
      position: relative; overflow: hidden;
      transition: transform 0.35s var(--ease-out), box-shadow 0.35s ease;
    }
    .l-step:hover {
      transform: translateY(-6px) rotate(-0.5deg);
      box-shadow: 0 20px 48px -8px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05) inset;
    }
    .l-step:hover .l-step-num { transform: scale(1.12) translateY(-2px); box-shadow: 0 8px 20px rgba(42,143,255,0.35); }
    .l-step-num { transition: transform 0.35s cubic-bezier(.16,1,.3,1), box-shadow 0.35s ease; }
    .l-step-bg {
      position: absolute; top: -10px; left: 50%; transform: translateX(-50%);
      font-size: 120px; font-weight: 800; color: var(--surface-2); opacity: 0.5;
      line-height: 1; pointer-events: none;
    }
    .l-step-num {
      width: 52px; height: 52px; border-radius: var(--radius-lg);
      background: var(--brand); color: #fff; font-size: 18px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 20px; position: relative; z-index: 1;
      transition: transform 0.3s var(--ease-out);
    }
    .l-step h3 { font-size: 18px; font-weight: 700; margin-bottom: 10px; position: relative; z-index: 1; }
    .l-step p  { font-size: 14px; color: var(--text-secondary); line-height: 1.5; position: relative; z-index: 1; }
    .l-step-line { width: 40px; height: 1px; background: var(--border-strong); align-self: center; flex-shrink: 0; }

    /* ═══ PRICING ═══ */
    #flym-site-dark .l-pricing { padding: 60px 0 80px; }
    #flym-site-dark .l-pricing::before { margin-bottom: 32px !important; }
    #flym-site-dark .l-pricing .l-section-sub { margin-bottom: 32px; }
    #flym-site-dark .l-price-grid { display: grid; gap: 20px; max-width: 820px; margin: 0 auto; }
    #flym-site-dark .l-price-grid-2 { grid-template-columns: repeat(2, 1fr); }
    .l-pb-amber { background: var(--amber-fade); color: var(--amber); }
    .l-price-card {
      background: var(--surface-1); border: 1px solid var(--border-subtle);
      border-radius: var(--radius-xl); padding: 32px 28px;
      display: flex; flex-direction: column; position: relative; overflow: hidden;
      transition: transform 0.35s var(--ease-out), box-shadow 0.35s ease, border-color 0.3s;
    }
    .l-price-card::before {
      content: ""; position: absolute; top: 0; left: 0; right: 0; height: 3px;
      background: linear-gradient(90deg, var(--border-strong), var(--border-subtle));
      opacity: 0.5;
    }
    .l-price-card:hover {
      transform: translateY(-6px);
      border-color: rgba(255,255,255,0.1);
      box-shadow: 0 4px 8px rgba(0,0,0,0.08), 0 20px 48px -8px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05) inset;
    }
    .l-price-card:hover .l-price-cta {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(42,143,255,0.25);
      transition: all 0.25s cubic-bezier(.23,1,.32,1);
    }
    .l-price-cta { transition: all 0.3s cubic-bezier(.23,1,.32,1); }

    /* Pro card highlight */
    .l-price-pro {
      border-color: rgba(255,176,32,0.4);
      box-shadow: 0 0 0 1px rgba(255,176,32,0.25), 0 0 60px -20px rgba(255,176,32,0.1);
      background: linear-gradient(180deg, rgba(255,176,32,0.04) 0%, var(--surface-1) 40%, var(--surface-1) 100%);
    }
    .l-price-pro::before {
      background: linear-gradient(90deg, var(--amber), #FFD700, var(--amber)) !important;
      opacity: 1 !important; height: 3px;
    }
    .l-price-pro:hover {
      border-color: rgba(255,176,32,0.5);
      box-shadow: 0 0 0 1px rgba(255,176,32,0.3), 0 4px 8px rgba(0,0,0,0.08), 0 24px 56px -10px rgba(255,176,32,0.18), 0 0 80px -20px rgba(255,176,32,0.1);
      transform: translateY(-8px);
    }

    .l-price-badge { display: inline-block; padding: 4px 12px; border-radius: var(--radius-sm); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; margin-bottom: 12px; width: fit-content; }
    .l-price-tier-name { font-size: 18px; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 10px; color: var(--text-primary); }
    .l-price-amount { display: flex; align-items: baseline; gap: 5px; margin-bottom: 8px; }
    .l-price-val { font-size: 34px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
    .l-price-period { font-size: 14px; color: var(--text-tertiary); font-weight: 500; }
    .l-price-tagline { font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 16px; }
    .l-price-divider { height: 1px; background: linear-gradient(90deg, transparent, var(--border-subtle), transparent); margin-bottom: 16px; }
    .l-price-list { list-style: none; display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; flex: 1; }
    .l-price-list li { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); }
    .l-price-list li svg { flex-shrink: 0; }
    .l-price-list-header { font-weight: 600; color: var(--text-primary) !important; margin-bottom: 2px; }

    /* Pro feature rows */
    .l-price-list-pro {
      display: flex !important; align-items: flex-start !important; gap: 10px !important;
      padding: 8px 0; border-bottom: 1px solid var(--border-subtle);
    }
    .l-price-list-pro:last-child { border-bottom: none; padding-bottom: 0; }
    .l-price-list-pro div { display: flex; flex-direction: column; gap: 1px; }
    .l-price-list-pro strong { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .l-price-list-pro span { font-size: 11px; color: var(--text-tertiary); }
    .l-price-pro-icon {
      width: 30px; height: 30px; border-radius: var(--radius-md); flex-shrink: 0;
      display: flex; align-items: center; justify-content: center; margin-top: 1px;
    }
    .l-ppi-green  { background: var(--green-fade); color: var(--green); }
    .l-ppi-blue   { background: var(--brand-fade); color: var(--brand); }
    .l-ppi-purple { background: var(--purple-fade); color: var(--purple); }
    .l-ppi-amber  { background: var(--amber-fade); color: var(--amber); }

    .l-price-bottom { margin-top: auto; padding-top: 4px; }
    .l-price-bottom-text { font-size: 12px; color: var(--text-tertiary); text-align: center; margin-bottom: 12px; font-weight: 500; font-style: italic; }
    .l-price-cta { width: 100%; justify-content: center; text-align: center; padding: 12px 24px !important; font-size: 14px !important; border-radius: var(--radius-md) !important; }
    .l-price-trust { text-align: center; font-size: 13px; color: var(--text-tertiary); margin-top: 28px; font-weight: 500; }

    /* ═══ CTA ═══ */
    #flym-site-dark .l-cta { padding: 80px 0 120px; }
    .l-cta-card {
      background: var(--brand); border-radius: 24px; padding: 80px 48px; box-shadow: 0 24px 80px -16px rgba(42,143,255,0.4), 0 0 0 1px rgba(255,255,255,0.08) inset;
      text-align: center; position: relative; overflow: hidden;
    }
    .l-cta-glow {
      position: absolute; top: -50%; left: -20%; width: 140%; height: 200%;
      background: radial-gradient(circle at 30% 50%, rgba(255,255,255,0.1) 0%, transparent 50%),
                  radial-gradient(circle at 80% 30%, rgba(0,215,98,0.12) 0%, transparent 40%);
      pointer-events: none;
    }
    .l-cta-card::after {
      content: ""; position: absolute; top: 0; left: 0; width: 40%; height: 100%; transform: translateX(-200%);
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent);
      animation: l-shimmer 6s ease-in-out infinite;
      pointer-events: none;
    }
    @keyframes l-shimmer { 0%,30%{transform:translateX(-200%)} 70%,100%{transform:translateX(300%)} }
    .l-cta-title {
      font-size: clamp(28px, 4vw, 44px); font-weight: 700; color: #fff;
      letter-spacing: -0.03em; line-height: 1.15; margin-bottom: 16px; position: relative;
    }
    .l-cta-sub { font-size: 16px; color: rgba(255,255,255,0.8); margin-bottom: 36px; position: relative; }
    .l-cta-btn-white { background: #fff !important; color: #07090F !important; border-color: #fff !important; }
    .l-cta-btn-white:hover { background: #f0f0f0 !important; }
    .l-cta-btn-outline { border-color: rgba(255,255,255,0.3) !important; color: #fff !important; }
    .l-cta-btn-outline:hover { border-color: rgba(255,255,255,0.6) !important; background: rgba(255,255,255,0.08) !important; }
    .l-cta-stars { margin-top: auto; padding-top: 24px; font-size: 14px; color: rgba(255,255,255,0.7); position: relative; }
    .l-cta-stars span { margin-left: 6px; }

    /* ═══ FOOTER ═══ */
    #flym-site-dark .l-footer {
      border-top: 1px solid var(--border-subtle); padding: 60px 0 0;
      background: linear-gradient(180deg, rgba(42,143,255,0.015) 0%, transparent 30%);
    }
    #flym-site-dark .l-footer-inner { max-width: 1200px; margin: 0 auto; padding: 0 24px; display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 40px; }
    .l-footer-brand p { font-size: 14px; color: var(--text-tertiary); margin-top: 12px; }
    .l-footer-links { display: flex; flex-direction: column; gap: 10px; }
    .l-footer-links h4 { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
    .l-footer-links a { font-size: 14px; color: var(--text-tertiary); transition: color 0.2s; }
    .l-footer-links a:hover { color: var(--text-primary); }
    #flym-site-dark .l-footer-bottom {
      max-width: 1200px; margin: 40px auto 0; padding: 20px 24px;
      border-top: 1px solid var(--border-subtle); font-size: 13px; color: var(--text-tertiary);
      display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;
    }
    .l-footer-india { font-size: 12px; }
    .l-footer-links a { display: flex; align-items: center; gap: 6px; }
    .l-footer-links a svg { flex-shrink: 0; }

    /* ═══ SCROLL REVEAL ═══ */
    .l-reveal { opacity: 0; transform: translateY(40px) scale(0.98); transition: opacity 0.8s cubic-bezier(.23,1,.32,1), transform 0.8s cubic-bezier(.23,1,.32,1); }
    .l-reveal.l-visible { opacity: 1; transform: translateY(0) scale(1); }
    .l-reveal-child { opacity: 0; transform: translateY(28px) scale(0.97); transition: opacity 0.65s cubic-bezier(.23,1,.32,1), transform 0.65s cubic-bezier(.23,1,.32,1); }
    .l-reveal-child.l-visible { opacity: 1; transform: translateY(0) scale(1); }



    /* WhatsApp floating button */
    .l-wa-float {
      position: fixed; bottom: 24px; right: 24px; z-index: 998;
      width: 56px; height: 56px; border-radius: 50%;
      background: #25D366; color: #fff;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 16px rgba(37,211,102,0.35), 0 2px 4px rgba(0,0,0,0.15);
      transition: transform 0.3s var(--ease-out), box-shadow 0.3s;
      animation: l-wa-in 0.6s cubic-bezier(.23,1,.32,1) 2s both;
    }
    .l-wa-float:hover { transform: scale(1.08) translateY(-2px); box-shadow: 0 8px 28px rgba(37,211,102,0.45); }
    .l-wa-float:active { transform: scale(0.95); }
    @keyframes l-wa-in { from{opacity:0;transform:scale(0.5) translateY(20px)} to{opacity:1;transform:scale(1) translateY(0)} }

    #flym-site-dark .l-nav-links a.l-nav-active { color: var(--text-primary); }
    #flym-site-dark .l-nav-links a.l-nav-active::after { transform: scaleX(1); }

    /* Idle floating on cards */
    .l-pain-card:nth-child(1) { animation: l-idle-a 7s ease-in-out infinite; }
    .l-pain-card:nth-child(2) { animation: l-idle-b 8s ease-in-out 0.5s infinite; }
    .l-pain-card:nth-child(3) { animation: l-idle-a 9s ease-in-out 1s infinite; }
    .l-pain-card:nth-child(4) { animation: l-idle-b 7.5s ease-in-out 1.5s infinite; }
    .l-feat-card:nth-child(1) { animation: l-idle-a 8s ease-in-out infinite; }
    .l-feat-card:nth-child(2) { animation: l-idle-b 7s ease-in-out 0.3s infinite; }
    .l-feat-card:nth-child(3) { animation: l-idle-a 9s ease-in-out 0.7s infinite; }
    .l-step:nth-child(1) { animation: l-idle-b 8s ease-in-out infinite; }
    .l-step:nth-child(3) { animation: l-idle-a 7s ease-in-out 0.4s infinite; }
    .l-step:nth-child(5) { animation: l-idle-b 9s ease-in-out 0.8s infinite; }
    /* pricing cards — no float, static */
    @keyframes l-idle-a { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
    @keyframes l-idle-b { 0%,100%{transform:translateY(0)} 50%{transform:translateY(4px)} }

    /* Section dividers */
    #flym-site-dark .l-pain::before,
    #flym-site-dark .l-features::before,
    #flym-site-dark .l-steps-section::before,
    #flym-site-dark .l-pricing::before {
      content: ""; display: block; height: 1px; max-width: 200px; margin: 0 auto 60px;
      background: linear-gradient(90deg, transparent, var(--border-strong), transparent);
    }

    /* ═══ REDUCED MOTION ═══ */
    @media (prefers-reduced-motion: reduce) {
      .l-float-pill, .l-sc-card, .l-showcase-frame,
      .l-feat-card, .l-pain-card, .l-step, .l-price-card { animation: none !important; }
      .l-float-pill, .l-sc-card { opacity: 1 !important; transform: none !important; }
      .l-reveal, .l-reveal-child { opacity: 1 !important; transform: none !important; transition: none !important; }
      * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
    }

    /* ═══ RESPONSIVE ═══ */
    @media (max-width:1300px) {
      .l-fp-1 { left: -4%; top: 22%; }
      .l-fp-2 { right: -4%; top: 8%; }
      .l-fp-3 { right: 0%; bottom: 5%; }
      .l-sc-card-1 { left: -14%; }
      .l-sc-card-2 { right: -14%; }
    }
    @media (max-width:1100px) {
      #flym-site-dark .l-feat-grid-3 { grid-template-columns: repeat(2,1fr); }
      #flym-site-dark .l-price-grid, #flym-site-dark .l-price-grid-2 { grid-template-columns: repeat(2,1fr); }
      #flym-site-dark .l-sc-card { display: none; }
      #flym-site-dark .l-fp-1, #flym-site-dark .l-fp-2, #flym-site-dark .l-fp-3 { display: none; }
    }
    @media (max-width:900px) {
      #flym-site-dark .l-feat-grid-3,
      #flym-site-dark .l-feat-grid-2,
      #flym-site-dark .l-pain-grid { grid-template-columns: 1fr; }
      #flym-site-dark .l-price-grid,
      #flym-site-dark .l-price-grid-2 {
        grid-template-columns: 1fr;
        max-width: 400px;
        margin: 0 auto;
        gap: 16px;
      }
      #flym-site-dark .l-price-grid .l-price-card,
      #flym-site-dark .l-price-grid-2 .l-price-card {
        max-width: none !important;
        grid-column: auto !important;
        margin: 0 !important;
        width: 100% !important;
      }
      #flym-site-dark .l-steps-grid { flex-direction: column; align-items: center; }
      #flym-site-dark .l-step-line { width: 1px; height: 32px; background: none; position: relative; }
      #flym-site-dark .l-step-line::before { content: ""; position: absolute; left: 50%; top: 0; bottom: 8px; width: 1px; background: var(--border-strong); transform: translateX(-50%); }
      #flym-site-dark .l-step-line::after { content: ""; position: absolute; left: 50%; bottom: 0; transform: translateX(-50%); border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 6px solid var(--border-strong); }
      #flym-site-dark .l-mock-app { grid-template-columns: 1fr; }
      #flym-site-dark .l-mock-side { display: none; }
      #flym-site-dark .l-mock-stat-row { grid-template-columns: repeat(2,1fr); }
      #flym-site-dark .l-footer-inner { grid-template-columns: 1fr 1fr; gap: 32px; }
    }
    @media (max-width:768px) {
      #flym-site-dark .l-hero { padding: 48px 20px 32px; }
      #flym-site-dark .l-hero-h1 { font-size: 46px; line-height: 1.08; letter-spacing: -0.03em; }
      #flym-site-dark .l-hero-sub { font-size: 15px; margin-bottom: 28px; }
      #flym-site-dark .l-section-title { font-size: 26px; }
      #flym-site-dark .l-section-sub { font-size: 14px; margin-bottom: 32px; }
      #flym-site-dark .l-showcase { padding: 0 20px 40px; }
      #flym-site-dark .l-mock-main { padding: 14px; }
      #flym-site-dark .l-mock-stat-val { font-size: 16px; }
      #flym-site-dark .l-mock-stat-label { font-size: 9px; }
      #flym-site-dark .l-mock-topbar-date { display: none; }
      #flym-site-dark .l-mock-overview-sub { display: none; }
      #flym-site-dark .l-mock-alert { font-size: 10px; padding: 8px 10px; }
      #flym-site-dark .l-mock-renewal { font-size: 10px; padding: 8px 10px; }
      #flym-site-dark .l-mock-renewal-amount { font-size: 14px; }
      #flym-site-dark .l-pain-card { padding: 24px 22px; }
      #flym-site-dark .l-feat-card { padding: 24px 22px; }
      #flym-site-dark .l-step { padding: 28px 22px 24px; }
      #flym-site-dark .l-price-card { padding: 24px 20px; }
      #flym-site-dark .l-price-tier-name { font-size: 17px; }
      #flym-site-dark .l-price-val { font-size: 28px; }
      #flym-site-dark .l-price-list li { font-size: 12.5px; }
      #flym-site-dark .l-footer-inner { grid-template-columns: 1fr 1fr; }
      #flym-site-dark .l-cta-card { padding: 48px 24px; border-radius: 16px; }
      #flym-site-dark .l-cta-title { font-size: 24px; }
    }
    @media (max-width:600px) {
      /* ═══ NAV ═══ */
      #flym-site-dark .l-nav-links { display: none; }
      #flym-site-dark .l-nav-right { display: none; }
      #flym-site-dark .l-nav-mobile-right { display: flex; }
      #flym-site-dark .l-logo-svg { width: 90px !important; }

      /* ═══ HERO ═══ */
      #flym-site-dark .l-hero { padding: 32px 20px 24px; }
      #flym-site-dark .l-hero-h1 { font-size: 40px; letter-spacing: -0.03em; line-height: 1.05; }
      #flym-site-dark .l-hero-sub { font-size: 15px; margin-bottom: 28px; line-height: 1.55; }
      #flym-site-dark .l-hero-badge { font-size: 11px; padding: 6px 14px; margin-bottom: 20px; }
      #flym-site-dark .l-hero-ctas { flex-direction: column; align-items: stretch; gap: 10px; }
      #flym-site-dark .l-hero-ctas .l-btn-primary, #flym-site-dark .l-hero-ctas .l-btn-ghost {
        justify-content: center; width: auto; max-width: 260px; margin: 0 auto; padding: 11px 22px; font-size: 13px; min-height: 42px;
      }
      #flym-site-dark .l-hero-ctas { align-items: center !important; }

      /* ═══ SHOWCASE ═══ */
      #flym-site-dark .l-showcase { padding: 0 16px 32px; }
      #flym-site-dark .l-mock-stat-row { grid-template-columns: repeat(2,1fr); gap: 6px; }
      #flym-site-dark .l-mock-stat { padding: 10px 8px; }
      #flym-site-dark .l-mock-stat-val { font-size: 16px; }
      #flym-site-dark .l-mock-stat-label { font-size: 9px; }
      #flym-site-dark .l-mock-side { display: none; }
      #flym-site-dark .l-mock-app { grid-template-columns: 1fr; }
      #flym-site-dark .l-mock-main { padding: 12px; }
      #flym-site-dark .l-mock-topbar-date { display: none; }
      #flym-site-dark .l-mock-overview-title { font-size: 13px; }
      #flym-site-dark .l-mock-overview-sub { display: none; }
      #flym-site-dark .l-mock-alert { font-size: 10px; padding: 8px 10px; gap: 6px; }
      #flym-site-dark .l-mock-alert-btn { font-size: 9px; padding: 3px 8px; }
      #flym-site-dark .l-mock-renewal { font-size: 10px; padding: 8px 10px; }
      #flym-site-dark .l-mock-renewal-amount { font-size: 14px; }
      #flym-site-dark .l-mock-topbar-title { font-size: 13px; }
      #flym-site-dark .l-mock-topbar-avatar { width: 24px; height: 24px; font-size: 9px; }

      /* ═══ STATS ═══ */
      #flym-site-dark .l-stats { padding: 40px 20px; }
      #flym-site-dark .l-stats-inner { gap: 20px; flex-direction: row; justify-content: space-around; flex-wrap: wrap; }
      #flym-site-dark .l-stat-item { flex-direction: column; text-align: center; gap: 4px; }
      #flym-site-dark .l-stat-val { font-size: 22px; }
      #flym-site-dark .l-stat-suffix { font-size: 16px; }
      #flym-site-dark .l-stat-label { font-size: 11px; margin-left: 0; }
      #flym-site-dark .l-stat-item svg { width: 18px; height: 18px; }

      /* ═══ SECTIONS ═══ */
      #flym-site-dark .l-pain,
      #flym-site-dark .l-features,
      #flym-site-dark .l-steps-section,
      #flym-site-dark .l-pricing { padding: 48px 0; }
      #flym-site-dark .l-section-title { font-size: 24px; }
      #flym-site-dark .l-section-sub { font-size: 13px; margin-bottom: 28px; }
      #flym-site-dark .l-section-inner { padding: 0 16px; }

      /* ═══ PAIN CARDS ═══ */
      #flym-site-dark .l-pain-grid { gap: 12px; }
      #flym-site-dark .l-pain-card { padding: 20px 18px; border-radius: 16px; }
      #flym-site-dark .l-pain-card h3 { font-size: 15px; margin-bottom: 6px; }
      #flym-site-dark .l-pain-card p { font-size: 12.5px; line-height: 1.55; }
      #flym-site-dark .l-pain-icon { width: 40px; height: 40px; margin-bottom: 14px; border-radius: 12px; }

      /* ═══ FEATURE CARDS ═══ */
      #flym-site-dark .l-feat-grid-3, #flym-site-dark .l-feat-grid-2 { gap: 12px; }
      #flym-site-dark .l-feat-card { padding: 20px 18px; border-radius: 16px; }
      #flym-site-dark .l-feat-card h3 { font-size: 15px; margin-bottom: 6px; }
      #flym-site-dark .l-feat-card p { font-size: 12.5px; line-height: 1.55; margin-bottom: 14px; }
      #flym-site-dark .l-feat-icon { width: 40px; height: 40px; margin-bottom: 14px; border-radius: 12px; }
      #flym-site-dark .l-feat-preview { display: none; }

      /* ═══ STEPS ═══ */
      #flym-site-dark .l-step { padding: 24px 20px 20px; border-radius: 16px; }
      #flym-site-dark .l-step h3 { font-size: 15px; margin-bottom: 6px; }
      #flym-site-dark .l-step p { font-size: 12.5px; line-height: 1.55; }
      #flym-site-dark .l-step-bg { font-size: 68px; top: -6px; }
      #flym-site-dark .l-step-num { width: 44px; height: 44px; font-size: 15px; margin-bottom: 16px; }

      /* ═══ PRICING — MOBILE ═══ */
      #flym-site-dark .l-price-grid,
      #flym-site-dark .l-price-grid-2 {
        gap: 16px !important;
        padding: 0 !important;
        max-width: 100% !important;
        grid-template-columns: 1fr !important;
        margin: 0 auto !important;
      }
      #flym-site-dark .l-price-grid .l-price-card,
      #flym-site-dark .l-price-grid-2 .l-price-card {
        max-width: none !important;
        grid-column: auto !important;
        margin: 0 !important;
        width: 100% !important;
      }
      #flym-site-dark .l-price-card { padding: 24px 20px !important; border-radius: 16px !important; }
      #flym-site-dark .l-price-badge { font-size: 10px !important; padding: 3px 10px !important; margin-bottom: 12px !important; }
      #flym-site-dark .l-price-tier-name { font-size: 18px !important; margin-bottom: 12px !important; }
      #flym-site-dark .l-price-amount { gap: 6px !important; margin-bottom: 8px !important; }
      #flym-site-dark .l-price-val { font-size: 28px !important; }
      #flym-site-dark .l-price-period { font-size: 14px !important; }
      #flym-site-dark .l-price-tagline { font-size: 12.5px !important; margin-bottom: 16px !important; }
      #flym-site-dark .l-price-list { gap: 8px !important; margin-bottom: 18px !important; }
      #flym-site-dark .l-price-list li { font-size: 12.5px !important; gap: 8px !important; line-height: 1.4 !important; }
      #flym-site-dark .l-price-list li svg { width: 14px !important; height: 14px !important; flex-shrink: 0; }
      #flym-site-dark .l-price-list-pro { padding: 8px 0 !important; }
      #flym-site-dark .l-price-pro-icon { width: 28px !important; height: 28px !important; }
      #flym-site-dark .l-price-pro-icon svg { width: 12px !important; height: 12px !important; }
      #flym-site-dark .l-price-list-pro strong { font-size: 13px !important; }
      #flym-site-dark .l-price-list-pro span { font-size: 11px !important; }
      #flym-site-dark .l-price-bottom-text { font-size: 12px !important; }
      #flym-site-dark .l-price-cta {
        padding: 12px 20px !important; font-size: 13px !important;
        border-radius: 12px !important; min-height: 44px !important;
      }
      #flym-site-dark .l-price-trust { font-size: 12px !important; margin-top: 20px !important; }

      /* ═══ CTA ═══ */
      #flym-site-dark .l-cta { padding: 32px 0 48px; }
      #flym-site-dark .l-cta-card { padding: 36px 20px !important; border-radius: 20px !important; }
      #flym-site-dark .l-cta-title { font-size: 22px !important; }
      #flym-site-dark .l-cta-sub { font-size: 13px !important; margin-bottom: 24px !important; }
      #flym-site-dark .l-cta-stars { font-size: 12px !important; }
      #flym-site-dark .l-cta-card .l-btn-primary, #flym-site-dark .l-cta-card .l-btn-ghost {
        padding: 13px 20px !important; font-size: 14px !important; min-height: 48px !important;
      }

      /* ═══ FOOTER ═══ */
      #flym-site-dark .l-footer-inner { grid-template-columns: 1fr; gap: 24px; padding: 0 20px; }
      #flym-site-dark .l-footer-bottom { flex-direction: column; text-align: center; padding: 16px 20px; gap: 10px; }

      /* ═══ WHATSAPP FLOAT ═══ */
      #flym-site-dark .l-wa-float { bottom: 16px; right: 16px; width: 48px; height: 48px; }
      #flym-site-dark .l-wa-float svg { width: 22px; height: 22px; }
    }
  `
  document.head.appendChild(s);
}