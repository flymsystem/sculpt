// src/pages/landing.js — D Sculpt Fitness marketing page
// ─────────────────────────────────────────────────────────────────
// Public shopfront. Rebuilt from scratch for the white-label handover.
//
// CONTRACT (app.js depends on all three):
//   · export renderLanding(router)
//   · window.__sculptLandingRestoreTheme  — restores the visitor's theme
//   · window.__sculptLandingCleanup       — tears down listeners
//
// The page force-sets data-theme="dark" while mounted. Its colours are
// hardcoded brand values rather than tokens ON PURPOSE: this is a fixed
// marketing composition on a black ground, not a themeable app surface.
//
// PLACEHOLDER POLICY: every fact the client has not supplied is rendered
// as a visible [PLACEHOLDER: …] marker. Nothing invented ships looking
// real — no fake address, no invented class times, no made-up prices,
// no fictional trainers. Search this file for PLACEHOLDER to get the
// full list of what is still owed.
// ─────────────────────────────────────────────────────────────────

import { escHtml } from './dashboard/helpers.js';

// ── Brand constants ───────────────────────────────────────────────
const BLUE = '#0A84FF';
const BLUE_LIGHT = '#1E90FF';
const CHROME = '#C8CDD6';
const INK = '#050507';

// ── Content the client still owes us ──────────────────────────────
// Swap these for real values and the whole page updates. Keeping them
// in one object means the handover checklist is this block.
const GYM = {
  phone: '[PLACEHOLDER: PHONE]',
  whatsapp: '[PLACEHOLDER: WHATSAPP NUMBER]',
  email: '[PLACEHOLDER: EMAIL]',
  addressLine1: '[PLACEHOLDER: STREET ADDRESS]',
  addressLine2: '[PLACEHOLDER: AREA, CITY, PIN]',
  hoursWeekday: '[PLACEHOLDER: WEEKDAY HOURS]',
  hoursWeekend: '[PLACEHOLDER: WEEKEND HOURS]',
  mapsUrl: '',
};

const PROGRAMMES = [
  {
    name: 'Strength &amp; Conditioning',
    body: 'Free weights, compound lifts and progressive programming. Coached technique from day one.',
  },
  {
    name: 'Personal Training',
    body: 'One-to-one coaching built around your body, your schedule and your target.',
  },
  {
    name: 'Group Classes',
    body: 'High-energy sessions that keep you accountable and make the hard days easier.',
  },
  {
    name: 'Cardio &amp; Conditioning',
    body: 'Treadmills, cycles and circuit work for endurance, fat loss and recovery.',
  },
];

const USPS = [
  { k: 'Coached, not supervised', v: 'Every member gets their form checked. No one is left to guess.' },
  { k: 'Equipment that works', v: 'Maintained kit, no queues at peak hours, no broken machines taped up for months.' },
  { k: 'Progress you can see', v: 'Your plan, your numbers, tracked properly — not scribbled in a notebook.' },
  { k: 'A room that lifts you', v: 'Serious training, zero ego. You will not feel out of place on day one.' },
];

export function renderLanding(router) {
  // ── Force dark while mounted, restore on the way out ────────────
  const prevTheme = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', 'dark');
  window.__sculptLandingRestoreTheme = () => {
    if (prevTheme) document.documentElement.setAttribute('data-theme', prevTheme);
    else document.documentElement.removeAttribute('data-theme');
  };

  const telHref = `tel:${GYM.phone.replace(/[^\d+]/g, '') || '+910000000000'}`;
  const waHref = `https://wa.me/${GYM.whatsapp.replace(/[^\d]/g, '') || '910000000000'}`;
  const mailHref = `mailto:${GYM.email}`;

  document.getElementById('root').innerHTML = `
  <div class="sc-land">

    <!-- ── NAV ─────────────────────────────────────────────── -->
    <header class="sc-nav" role="banner">
      <a class="sc-nav-brand" href="#top" aria-label="D Sculpt Fitness home">
        <img src="/icon-192.png" alt="" width="34" height="34">
        <span>D Sculpt<strong>Fitness</strong></span>
      </a>
      <nav class="sc-nav-links" aria-label="Primary">
        <a href="#programmes">Programmes</a>
        <a href="#why">Why us</a>
        <a href="#visit">Visit</a>
      </nav>
      <button class="sc-btn sc-btn-sm" id="sc-nav-login" type="button">Member Login</button>
    </header>

    <!-- ── HERO ────────────────────────────────────────────── -->
    <section class="sc-hero" id="top">
      <div class="sc-hero-glow" aria-hidden="true"></div>
      <div class="sc-hero-inner">
        <p class="sc-eyebrow">D Sculpt Fitness</p>
        <h1 class="sc-h1">
          STOP<br>
          <span class="sc-h1-hi">STARTING</span><br>
          OVER
        </h1>
        <p class="sc-lede">
          Anyone can sell you a membership. We coach you through the first
          six weeks — the part where most people quit.
        </p>
        <div class="sc-cta-row">
          <button class="sc-btn sc-btn-lg" id="sc-hero-join" type="button">Book a free trial</button>
          <a class="sc-btn sc-btn-lg sc-btn-ghost" href="${escHtml(telHref)}">Call the gym</a>
        </div>
        <p class="sc-hero-note">
          <!-- PLACEHOLDER: replace with a real proof point once the client
               supplies one (member count, years open, trainer count).
               Deliberately NOT invented. -->
          [PLACEHOLDER: add a proof point — e.g. “Training [N] members since [YEAR]”]
        </p>
      </div>
    </section>

    <!-- ── WHY ─────────────────────────────────────────────── -->
    <section class="sc-sec" id="why">
      <h2 class="sc-h2">WHY PEOPLE <span class="sc-h1-hi">STAY</span></h2>
      <div class="sc-grid sc-grid-2">
        ${USPS.map((u, i) => `
          <article class="sc-card">
            <span class="sc-card-n">0${i + 1}</span>
            <h3>${u.k}</h3>
            <p>${u.v}</p>
          </article>`).join('')}
      </div>
    </section>

    <!-- ── PROGRAMMES ──────────────────────────────────────── -->
    <section class="sc-sec sc-sec-alt" id="programmes">
      <h2 class="sc-h2">WHAT WE <span class="sc-h1-hi">TRAIN</span></h2>
      <p class="sc-sec-sub">
        [PLACEHOLDER: confirm this list matches what the gym actually offers,
        and send photos for each]
      </p>
      <div class="sc-grid sc-grid-4">
        ${PROGRAMMES.map(p => `
          <article class="sc-prog">
            <div class="sc-prog-img" aria-hidden="true">
              <span>[PHOTO]</span>
            </div>
            <h3>${p.name}</h3>
            <p>${p.body}</p>
          </article>`).join('')}
      </div>
    </section>

    <!-- ── VISIT ───────────────────────────────────────────── -->
    <section class="sc-sec" id="visit">
      <h2 class="sc-h2">COME <span class="sc-h1-hi">TRAIN</span></h2>
      <div class="sc-visit">
        <div class="sc-visit-block">
          <h3>Where</h3>
          <p>${escHtml(GYM.addressLine1)}<br>${escHtml(GYM.addressLine2)}</p>
          ${GYM.mapsUrl
            ? `<a class="sc-link" href="${escHtml(GYM.mapsUrl)}" target="_blank" rel="noopener">Open in Maps →</a>`
            : `<span class="sc-link sc-link-dead">[PLACEHOLDER: Google Maps link]</span>`}
        </div>
        <div class="sc-visit-block">
          <h3>When</h3>
          <p>Mon–Fri &nbsp;${escHtml(GYM.hoursWeekday)}<br>Sat–Sun &nbsp;${escHtml(GYM.hoursWeekend)}</p>
        </div>
        <div class="sc-visit-block">
          <h3>Talk to us</h3>
          <p class="sc-contact-links">
            <a class="sc-link" href="${escHtml(telHref)}">${escHtml(GYM.phone)}</a>
            <a class="sc-link" href="${escHtml(waHref)}" target="_blank" rel="noopener">WhatsApp us</a>
            <a class="sc-link" href="${escHtml(mailHref)}">${escHtml(GYM.email)}</a>
          </p>
        </div>
      </div>
    </section>

    <!-- ── CLOSING CTA ─────────────────────────────────────── -->
    <section class="sc-final">
      <div class="sc-hero-glow" aria-hidden="true"></div>
      <h2 class="sc-h2 sc-final-h">FIRST SESSION<br><span class="sc-h1-hi">IS ON US</span></h2>
      <p class="sc-lede sc-final-lede">Walk in, train once, decide after.</p>
      <div class="sc-cta-row sc-cta-center">
        <a class="sc-btn sc-btn-lg" href="${escHtml(waHref)}" target="_blank" rel="noopener">WhatsApp us</a>
        <a class="sc-btn sc-btn-lg sc-btn-ghost" href="${escHtml(telHref)}">${escHtml(GYM.phone)}</a>
      </div>
    </section>

    <!-- ── FOOTER ──────────────────────────────────────────── -->
    <footer class="sc-foot">
      <div class="sc-foot-brand">
        <img src="/icon-192.png" alt="" width="30" height="30">
        <span>D Sculpt Fitness</span>
      </div>
      <button class="sc-foot-login" id="sc-foot-login" type="button">Staff &amp; owner login</button>
      <small>© ${new Date().getFullYear()} D Sculpt Fitness</small>
    </footer>
  </div>`;

  injectLandingStyles();

  // ── Wiring ──────────────────────────────────────────────────────
  const toLogin = () => router.go('login');
  document.getElementById('sc-nav-login')?.addEventListener('click', toLogin);
  document.getElementById('sc-foot-login')?.addEventListener('click', toLogin);
  document.getElementById('sc-hero-join')?.addEventListener('click', () => {
    document.getElementById('visit')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Reveal-on-scroll. Guarded by prefers-reduced-motion: when the visitor
  // asks for less motion the elements are simply already visible, rather
  // than animating faster.
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealables = document.querySelectorAll('.sc-card, .sc-prog, .sc-visit-block');
  let obs = null;

  // These elements start at opacity:0, so anything that stops the observer
  // from running would leave half the page permanently blank. Reveal
  // unconditionally unless we are certain the observer can do it.
  if (reduce || typeof IntersectionObserver === 'undefined') {
    revealables.forEach(el => el.classList.add('is-in'));
  } else {
    revealables.forEach(el => el.classList.add('sc-reveal'));
    obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        obs.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    revealables.forEach(el => obs.observe(el));
  }

  // Sticky-nav shade
  const nav = document.querySelector('.sc-nav');
  const onScroll = () => nav?.classList.toggle('is-stuck', window.scrollY > 12);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  window.__sculptLandingCleanup = () => {
    window.removeEventListener('scroll', onScroll);
    if (obs) obs.disconnect();
  };
}

// ── Styles ────────────────────────────────────────────────────────
// Injected once, removed by app.js's cleanup of #sc-land-styles is not
// needed — the node is idempotent and harmless on other routes because
// every selector is scoped under .sc-land.
function injectLandingStyles() {
  if (document.getElementById('sc-land-styles')) return;
  const s = document.createElement('style');
  s.id = 'sc-land-styles';
  s.textContent = `
.sc-land{background:${INK};color:#F2F4F8;font-family:var(--font-sans);overflow-x:hidden;}
.sc-land *{box-sizing:border-box;}
.sc-land h1,.sc-land h2{font-family:var(--font-display);font-weight:700;
  letter-spacing:0.01em;line-height:0.92;margin:0;text-transform:uppercase;}
.sc-h1-hi{color:${BLUE};}

/* NAV */
.sc-nav{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:20px;
  padding:14px clamp(16px,4vw,56px);background:rgba(5,5,7,0);
  border-bottom:1px solid transparent;transition:background .25s ease,border-color .25s ease;}
.sc-nav.is-stuck{background:rgba(5,5,7,0.92);backdrop-filter:blur(10px);
  border-bottom-color:rgba(200,205,214,0.12);}
.sc-nav-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit;
  font-size:15px;letter-spacing:0.02em;}
.sc-nav-brand img{border-radius:7px;}
.sc-nav-brand strong{color:${BLUE};font-weight:700;margin-left:4px;}
.sc-nav-links{display:flex;gap:26px;margin-left:auto;}
.sc-nav-links a{color:${CHROME};text-decoration:none;font-size:14px;font-weight:500;
  padding:6px 0;transition:color .18s ease;}
.sc-nav-links a:hover,.sc-nav-links a:focus-visible{color:#fff;}

/* BUTTONS */
.sc-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;
  background:${BLUE};color:#fff;border:1px solid ${BLUE};border-radius:10px;
  font-family:var(--font-sans);font-weight:700;font-size:15px;
  padding:14px 26px;cursor:pointer;text-decoration:none;line-height:1;
  min-height:48px;transition:background .18s ease,transform .18s ease;}
.sc-btn:hover{background:${BLUE_LIGHT};border-color:${BLUE_LIGHT};}
.sc-btn:active{transform:translateY(1px);}
.sc-btn-sm{padding:10px 18px;font-size:14px;min-height:40px;}
.sc-btn-lg{padding:16px 30px;font-size:16px;}
.sc-btn-ghost{background:transparent;color:#F2F4F8;border-color:rgba(200,205,214,0.32);}
.sc-btn-ghost:hover{background:rgba(200,205,214,0.09);border-color:${CHROME};}
.sc-land :focus-visible{outline:3px solid ${BLUE_LIGHT};outline-offset:3px;border-radius:8px;}

/* HERO */
.sc-hero{position:relative;padding:clamp(48px,9vw,110px) clamp(16px,4vw,56px) clamp(28px,4vw,52px);
  overflow:hidden;}
.sc-hero-glow{position:absolute;top:-28%;left:50%;transform:translateX(-50%);
  width:min(860px,125%);aspect-ratio:1;pointer-events:none;
  background:radial-gradient(circle,rgba(10,132,255,0.30) 0%,rgba(10,132,255,0.07) 42%,transparent 68%);}
.sc-hero-inner{position:relative;}
.sc-eyebrow{font-family:var(--font-display);text-transform:uppercase;letter-spacing:0.28em;
  font-size:13px;font-weight:600;color:${BLUE};margin:0 0 18px;}
.sc-h1{font-size:clamp(58px,13.5vw,168px);}
.sc-lede{max-width:46ch;margin:26px 0 0;font-size:clamp(16px,2vw,19px);
  line-height:1.6;color:${CHROME};}
.sc-cta-row{display:flex;flex-wrap:wrap;gap:12px;margin-top:34px;}
.sc-cta-center{justify-content:center;}
.sc-hero-note{margin:26px 0 0;font-size:13px;color:#8A929F;}

/* SECTIONS
   Every band is full-bleed with the same gutter, and its children share one
   centred measure. Sections must not set their own max-width: doing that
   put the gutter INSIDE the measure on plain sections and OUTSIDE it on
   full-bleed ones, so headings landed on three different left edges. */
.sc-sec{padding:clamp(56px,8vw,104px) clamp(16px,4vw,56px);}
.sc-sec-alt{background:#0A0B0E;}
/* ONE MEASURE FOR EVERY BAND.
   Constraining each child with max-width + margin:auto does not work here:
   the .sc-land h1,h2 rule sets margin:0 at higher specificity, so headings
   snapped to the padding edge while grids stayed centred — three different
   left edges down the page. Putting the measure in the band's own inline
   padding applies it to every child uniformly, whatever its own margins
   say, and keeps section backgrounds full-bleed. */
.sc-nav,.sc-hero,.sc-sec,.sc-final,.sc-foot{
  padding-inline:max(clamp(16px,4vw,56px),calc((100% - 1180px) / 2));
}
.sc-h2{font-size:clamp(36px,6.5vw,76px);margin-bottom:20px;}
.sc-sec-sub{color:#8A929F;font-size:14px;line-height:1.6;margin:-6px 0 34px;max-width:60ch;}
.sc-grid{display:grid;gap:16px;margin-top:34px;}
/* Four cards: 2x2 on desktop. auto-fit gave three columns at this measure,
   leaving a lone orphan on the second row. */
.sc-grid-2{grid-template-columns:1fr;}
.sc-grid-4{grid-template-columns:1fr;}
@media (min-width:640px){
  .sc-grid-2{grid-template-columns:repeat(2,1fr);}
  .sc-grid-4{grid-template-columns:repeat(2,1fr);}
}
@media (min-width:1000px){
  .sc-grid-4{grid-template-columns:repeat(4,1fr);}
}

.sc-card{position:relative;background:#0E0F13;border:1px solid rgba(200,205,214,0.10);
  border-radius:16px;padding:28px 24px;}
.sc-card-n{font-family:var(--font-display);font-size:13px;font-weight:700;
  letter-spacing:0.2em;color:${BLUE};}
.sc-card h3{margin:12px 0 8px;font-size:19px;font-weight:700;line-height:1.25;}
.sc-card p{margin:0;color:${CHROME};font-size:14.5px;line-height:1.62;}

.sc-prog{background:#0E0F13;border:1px solid rgba(200,205,214,0.10);border-radius:16px;
  overflow:hidden;}
.sc-prog-img{aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(140deg,#15171D,#0A0B0E);
  border-bottom:1px solid rgba(200,205,214,0.10);}
.sc-prog-img span{font-family:var(--font-display);letter-spacing:0.18em;font-size:13px;
  color:#5A616D;}
.sc-prog h3{margin:20px 20px 8px;font-size:17px;font-weight:700;line-height:1.3;}
.sc-prog p{margin:0 20px 22px;color:${CHROME};font-size:14px;line-height:1.6;}

/* VISIT */
.sc-visit{display:grid;gap:16px;margin-top:34px;grid-template-columns:1fr;}
@media (min-width:820px){.sc-visit{grid-template-columns:repeat(3,1fr);}}
.sc-visit-block{background:#0E0F13;border:1px solid rgba(200,205,214,0.10);
  border-radius:16px;padding:26px 24px;}
.sc-visit-block h3{font-family:var(--font-display);text-transform:uppercase;
  letter-spacing:0.16em;font-size:13px;font-weight:600;color:${BLUE};margin:0 0 12px;}
.sc-visit-block p{margin:0 0 14px;color:#F2F4F8;font-size:15px;line-height:1.7;}
.sc-link{color:${BLUE};text-decoration:none;font-weight:600;font-size:14.5px;
  border-bottom:1px solid rgba(10,132,255,0.35);padding-bottom:1px;}
.sc-link:hover{color:${BLUE_LIGHT};border-bottom-color:${BLUE_LIGHT};}
.sc-link-dead{color:#8A929F;border-bottom-style:dashed;border-bottom-color:#3A4150;}
.sc-contact-links{display:flex;flex-direction:column;align-items:flex-start;gap:12px;}
.sc-contact-links a{min-height:32px;display:inline-flex;align-items:center;}

/* FINAL CTA */
.sc-final{position:relative;overflow:hidden;text-align:center;
  padding:clamp(64px,10vw,128px) clamp(16px,4vw,56px);
  border-top:1px solid rgba(200,205,214,0.10);}
.sc-final-h{font-size:clamp(38px,7.5vw,92px);}
.sc-final-lede{margin:20px auto 0;}

/* FOOTER */
.sc-foot{display:flex;flex-wrap:wrap;align-items:center;gap:16px;
  padding:26px clamp(16px,4vw,56px);border-top:1px solid rgba(200,205,214,0.10);
  background:#08090B;}
.sc-foot-brand{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:600;}
.sc-foot-brand img{border-radius:6px;}
.sc-foot-login{margin-left:auto;background:none;border:none;color:${CHROME};
  font-family:var(--font-sans);font-size:13.5px;cursor:pointer;padding:8px 4px;
  text-decoration:underline;text-underline-offset:4px;min-height:40px;}
.sc-foot-login:hover{color:#fff;}
.sc-foot small{color:#6B727E;font-size:12.5px;width:100%;}

/* REVEAL */
.sc-reveal{opacity:0;transform:translateY(16px);
  transition:opacity .5s var(--ease-out,ease),transform .5s var(--ease-out,ease);}
.sc-reveal.is-in{opacity:1;transform:none;}

@media (max-width:768px){
  .sc-nav-links{display:none;}
  .sc-nav-brand{margin-right:auto;}
  .sc-cta-row .sc-btn{width:100%;}
  .sc-foot small{order:3;}
}
@media (prefers-reduced-motion:reduce){
  .sc-reveal{opacity:1;transform:none;transition:none;}
}
`;
  document.head.appendChild(s);
}
