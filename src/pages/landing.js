// src/pages/landing.js — D Sculpt Fitness marketing page
// ─────────────────────────────────────────────────────────────────
// Public shopfront.
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
// LAYOUT SOURCE: reference/*.fig (Figma community gym template), decoded
// from its Kiwi binary. Geometry taken from the 1600 frame — 1160px
// measure, 791px hero, 64/48/36/24/18/16/14/12 type scale, 30px pill
// buttons, 20px cards, 10px media — with the reference's yellow accent
// mapped onto D Sculpt blue throughout. The reference's Trainers section
// is deliberately not built.
//
// CONTENT POLICY: facts the client has not supplied render as a muted
// "to be supplied" chip via tbd(), never as invented data. Fill in the
// GYM object below and every one of them disappears.
// ─────────────────────────────────────────────────────────────────

import { escHtml } from './dashboard/helpers.js';
import { getPublicPlans } from '../lib/plans.js';

// ── Brand constants ───────────────────────────────────────────────
const BLUE = '#0A84FF';
const BLUE_LIGHT = '#1E90FF';
const CHROME = '#C8CDD6';
const INK = '#050507';

// Which gym's plans the marketing page advertises. Overridable so a
// white-label deploy points at its own gym without a code change.
const GYM_CODE = import.meta.env.VITE_PUBLIC_GYM_CODE || 'DSCULPT';

// ── Gym details ───────────────────────────────────────────────────
// An empty string means "not supplied yet" and renders as a visible
// to-be-supplied chip. Fill these in and the chips vanish.
//
// PHASE E (2026-08): filled from the client's real details. `phone` is the
// primary contact number and is what the footer's `tel:` link uses;
// `phone2` is a second reachable line — shown as a second link when
// present, but never required (see orTbd / tbd, which only gate on the
// primary fields below). `whatsapp` is deliberately the number the client
// asked WhatsApp traffic to land on, which is not the same as `phone`.
const GYM = {
  addressLine1: 'No.13, 20th Cross, Malagala,',
  addressLine2: 'Nagarbhavi 2nd Stage, Bangalore - 560091',
  phone: '+91 78921 31996',
  phone2: '+91 88678 78946',
  whatsapp: '+91 88678 78946',
  email: 'dsculptfitness5@gmail.com',
  hoursWeekday: '5:00 AM – 10:00 PM',
  hoursWeekend: '7:00 AM – 12:00 PM',
  instagram: 'https://www.instagram.com/d_sculptfitness?igsi=MWZnMmN3eXJmeXdjbA==',
  mapsUrl: 'https://maps.google.com/maps?q=12.974279403686523%2C77.51455688476562&z=17&hl=en',
};

// The classic (non-JS-API) Google Maps embed — appending output=embed to
// the same maps.google.com URL the client gave us renders it inside an
// iframe with no API key required. Built once from GYM.mapsUrl rather than
// hardcoded so the two never drift apart if the address ever changes.
const MAP_EMBED_URL = GYM.mapsUrl ? `${GYM.mapsUrl}&output=embed` : '';

// A single WhatsApp deep link builder so the prefilled message text lives
// in one place. Every "Contact us" CTA on the page uses this — the brief
// is explicit that "Contact us" must fire off a real action immediately,
// not land the visitor on the footer to go find a number themselves.
const waLink = (text) =>
  GYM.whatsapp
    ? `https://wa.me/${GYM.whatsapp.replace(/[^\d]/g, '')}?text=${encodeURIComponent(text)}`
    : '';
const WA_CTA_TEXT = "Hi! I'd like to know more about training at D Sculpt Fitness.";

const PROGRAMMES = [
  {
    name: 'Strength &amp; Conditioning',
    body: 'Free weights, compound lifts and progressive programming. Coached technique from day one.',
    img: '/img/train-1.jpg',
  },
  {
    name: 'Personal Training',
    body: 'One-to-one coaching built around your body, your schedule and your target.',
    img: '/img/train-2.jpg',
  },
  {
    name: 'Group Classes',
    body: 'High-energy sessions that keep you accountable and make the hard days easier.',
    img: '/img/train-3.jpg',
  },
  {
    name: 'Cardio &amp; Conditioning',
    body: 'Treadmills, cycles and circuit work for endurance, fat loss and recovery.',
    img: '/img/train-4.jpg',
  },
];

const USPS = [
  { k: 'Coached, not supervised', v: 'Every member gets their form checked. No one is left to guess.' },
  { k: 'Equipment that works', v: 'Maintained kit, no queues at peak hours, nothing taped up for months.' },
  { k: 'Progress you can see', v: 'Your plan and your numbers, tracked properly — not scribbled in a notebook.' },
  { k: 'A room that lifts you', v: 'Serious training, zero ego. You will not feel out of place on day one.' },
];

// ── Helpers ───────────────────────────────────────────────────────
const tbd = (label) =>
  `<span class="sc-tbd" title="Not supplied yet">${escHtml(label)}</span>`;

/** Renders a supplied value, or a to-be-supplied chip when it is blank. */
const orTbd = (value, label) =>
  value ? escHtml(value) : tbd(label);

const inr = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
};

const duration = (months) => {
  const m = parseInt(months, 10);
  if (!Number.isFinite(m) || m <= 0) return '';
  if (m === 12) return '1 year';
  if (m === 24) return '2 years';
  if (m % 12 === 0) return `${m / 12} years`;
  return `${m} month${m === 1 ? '' : 's'}`;
};

/**
 * `plans.features` is written by the dashboard's Plan Settings as a JSON
 * string, `{"featuresList":"one, two, three"}` (see parsePlanData() in
 * dashboard/helpers.js) — not free text. Unwrap that shape first, falling
 * back to the raw value for any row saved before that format existed.
 * Skipping this step used to split the JSON's own syntax into "features"
 * (`{"featuresList":"Locker room` as one bullet, `Cardio"}` as another) —
 * this is a duplicate of parsePlanData's unwrap, not an import from
 * dashboard/, since pages/dashboard -> pages/landing is not an allowed
 * import direction here.
 */
const featureList = (features) => {
  let raw = features;
  try {
    const parsed = JSON.parse(features || '{}');
    if (parsed && parsed.featuresList !== undefined) raw = parsed.featuresList;
  } catch (_) { /* not JSON — already plain text */ }
  return String(raw || '')
    .split(/[\n,;]+/)
    .map(s => s.trim())
    .filter(Boolean);
};

// Caps how many perks a card shows before collapsing the rest into a
// "+N more" line — one plan with a long feature list must not make the
// whole grid excessively tall, or every other card in the row along
// with it since grid rows stretch to the tallest sibling.
const MAX_PLAN_FEATS = 4;

/**
 * One reusable membership card, driven entirely by a plan row from
 * public_gym_plans() — nothing about a specific plan is hardcoded here.
 * Whatever the owner adds/edits/deletes in Plan Settings shows up here
 * unchanged, in the order the RPC returns it.
 */
function planCardHTML(p, featured) {
  const feats = featureList(p.features);
  const shown = feats.slice(0, MAX_PLAN_FEATS);
  const extra = feats.length - shown.length;
  return `
      <article class="sc-plan${featured ? ' is-featured' : ''}">
        ${featured ? '<span class="sc-plan-tag">Best value</span>' : ''}
        <div class="sc-plan-head">
          <h3>${escHtml(p.name || 'Membership')}</h3>
          <p class="sc-plan-dur">${escHtml(duration(p.duration_months))}</p>
        </div>
        <p class="sc-plan-price">${escHtml(inr(p.price))}</p>
        ${shown.length ? `<ul class="sc-plan-feats">
          ${shown.map(f => `<li>${escHtml(f)}</li>`).join('')}
          ${extra > 0 ? `<li class="sc-plan-feat-more">+ ${extra} more</li>` : ''}
        </ul>` : ''}
      </article>`;
}

export function renderLanding(router) {
  // ── Force dark while mounted, restore on the way out ────────────
  const prevTheme = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', 'dark');
  window.__sculptLandingRestoreTheme = () => {
    if (prevTheme) document.documentElement.setAttribute('data-theme', prevTheme);
    else document.documentElement.removeAttribute('data-theme');
  };

  const telHref = GYM.phone ? `tel:${GYM.phone.replace(/[^\d+]/g, '')}` : '';
  const tel2Href = GYM.phone2 ? `tel:${GYM.phone2.replace(/[^\d+]/g, '')}` : '';
  const waHref = waLink(WA_CTA_TEXT);
  const mailHref = GYM.email ? `mailto:${GYM.email}` : '';
  // The "Contact us" CTAs (hero + closing band) fire the WhatsApp deep
  // link directly when we have a number, per the brief: those buttons must
  // do something immediately, not drop the visitor on the footer to hunt
  // for a number themselves. Falls back to the in-page #contact anchor
  // only in the no-WhatsApp-number-yet state, so the button is never dead.
  const ctaHref = waHref || '#contact';
  const ctaTarget = waHref ? ' target="_blank" rel="noopener"' : '';

  document.getElementById('root').innerHTML = `
  <div class="sc-land">

    <!-- ── NAV ─────────────────────────────────────────────── -->
    <header class="sc-nav" role="banner">
      <a class="sc-nav-brand" href="#top" aria-label="D Sculpt Fitness home">
        <img src="/logo-128.png" alt="D Sculpt Fitness" width="56" height="56" decoding="async">
      </a>
      <nav class="sc-nav-links" id="sc-nav-links" aria-label="Primary">
        <a href="#why" class="sc-navlink">Why us</a>
        <a href="#programmes" class="sc-navlink">Training</a>
        <a href="#membership" class="sc-navlink sc-nav-membership" hidden>Membership</a>
        <a href="#about" class="sc-navlink">About</a>
        <a href="#contact" class="sc-navlink">Contact</a>
        <div class="sc-nav-divider" role="separator" aria-hidden="true"></div>
        <button class="sc-nav-login-member" id="sc-nav-member-login" type="button">Member Login</button>
        <button class="sc-nav-login-staff" id="sc-nav-staff-login" type="button">Staff &amp; Owner Login</button>
      </nav>
      <button class="sc-burger" id="sc-burger" type="button"
        aria-label="Open menu" aria-expanded="false" aria-controls="sc-nav-links">
        <span></span><span></span><span></span>
      </button>
    </header>

    <!-- ── HERO ────────────────────────────────────────────────
         Composition from the reference: the photograph bleeds off the
         right edge at full height and is dissolved into the black ground
         by gradient scrims, rather than sitting in a box beside the text. -->
    <section class="sc-hero" id="top">
      <div class="sc-hero-media" aria-hidden="true">
        <img src="/img/hero.jpg" width="1400" height="1034" alt="" fetchpriority="high" decoding="async">
        <div class="sc-hero-scrim"></div>
      </div>
      <div class="sc-hero-inner">
        <p class="sc-eyebrow">D Sculpt Fitness · Malagala, Bangalore</p>
        <h1 class="sc-h1">
          <span class="sc-h1-hi">SCULPT</span> THE BODY.<br>
          BUILD THE DISCIPLINE.
        </h1>
        <p class="sc-lede">
          Coached strength training for people who are done starting over.
          Real programming, equipment that works, and someone who actually
          watches your form.
        </p>
        <div class="sc-cta-row">
          <a class="sc-btn sc-btn-lg" href="${escHtml(ctaHref)}"${ctaTarget}>Contact us</a>
          <a class="sc-btn sc-btn-lg sc-btn-ghost" href="#membership" id="sc-hero-plans">View memberships</a>
        </div>
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
      <div class="sc-grid sc-grid-4">
        ${PROGRAMMES.map(p => `
          <article class="sc-prog">
            <figure class="sc-duo sc-prog-img">
              <img src="${p.img}" width="900" height="675" alt="" loading="lazy" decoding="async">
            </figure>
            <h3>${p.name}</h3>
            <p>${p.body}</p>
          </article>`).join('')}
      </div>
    </section>

    <!-- ── MEMBERSHIP ──────────────────────────────────────────
         Populated from Plan Settings via the public_gym_plans RPC.
         Stays hidden unless the gym actually has active plans, so the
         page never shows invented or empty pricing. -->
    <section class="sc-sec sc-sec-tight" id="membership" hidden>
      <h2 class="sc-h2">MEMBER<span class="sc-h1-hi">SHIPS</span></h2>
      <p class="sc-sec-sub">Simple plans. No lock-in.</p>
      <div class="sc-grid sc-plans" id="sc-plans"></div>
    </section>

    <!-- ── ABOUT ───────────────────────────────────────────── -->
    <section class="sc-sec sc-about" id="about">
      <div class="sc-about-text">
        <h2 class="sc-h2">ABOUT <span class="sc-h1-hi">D SCULPT</span></h2>
        <p>
          D Sculpt Fitness is a strength-first gym in Malagala, Bangalore.
          We built it around the thing most gyms skip: coaching. Every
          member gets a programme that fits their body and their schedule,
          and a trainer who corrects the lift instead of counting reps.
        </p>
        <p>
          The floor is kept maintained and uncrowded, the equipment is
          chosen for serious training, and the room stays welcoming enough
          that a first-timer and a seasoned lifter can train side by side.
        </p>
        <a class="sc-btn sc-btn-lg" href="${escHtml(ctaHref)}"${ctaTarget}>Come and see the floor</a>
      </div>
      <figure class="sc-duo sc-about-img">
        <img src="/img/about.jpg" width="1190" height="1322" alt="The D Sculpt Fitness training floor" loading="lazy" decoding="async">
      </figure>
    </section>

    <!-- ── CLOSING CTA ─────────────────────────────────────── -->
    <section class="sc-final">
      <h2 class="sc-h2 sc-final-h">READY TO <span class="sc-h1-hi">START?</span></h2>
      <p class="sc-lede sc-final-lede">
        Train with purpose. Build the discipline.
      </p>
      <div class="sc-cta-row sc-cta-center">
        <a class="sc-btn sc-btn-lg" href="${escHtml(ctaHref)}"${ctaTarget}>Contact us</a>
      </div>
    </section>

    <!-- ── FOOTER ──────────────────────────────────────────── -->
    <footer class="sc-foot" id="contact">
      <div class="sc-foot-grid">

        <div class="sc-foot-brand">
          <img src="/logo-128.png" alt="D Sculpt Fitness" width="56" height="56" decoding="async">
          <p>Strength training, personal coaching and group classes in Malagala, Bangalore.</p>
        </div>

        <div class="sc-foot-col">
          <h3>Visit</h3>
          <p>${escHtml(GYM.addressLine1)}<br>${escHtml(GYM.addressLine2)}</p>
          ${GYM.mapsUrl
            ? `<a class="sc-link" href="${escHtml(GYM.mapsUrl)}" target="_blank" rel="noopener">Open in Maps</a>`
            : tbd('Maps link')}
        </div>

        <div class="sc-foot-col">
          <h3>Talk to us</h3>
          <p class="sc-contact-links">
            ${telHref
              ? `<a class="sc-link" href="${escHtml(telHref)}">${escHtml(GYM.phone)}</a>`
              : tbd('Phone number')}
            ${tel2Href
              ? `<a class="sc-link" href="${escHtml(tel2Href)}">${escHtml(GYM.phone2)}</a>`
              : ''}
            ${waHref
              ? `<a class="sc-link" href="${escHtml(waHref)}" target="_blank" rel="noopener">WhatsApp us</a>`
              : tbd('WhatsApp number')}
            ${mailHref
              ? `<a class="sc-link" href="${escHtml(mailHref)}">${escHtml(GYM.email)}</a>`
              : tbd('Email address')}
            ${GYM.instagram
              ? `<a class="sc-link" href="${escHtml(GYM.instagram)}" target="_blank" rel="noopener">Instagram</a>`
              : tbd('Instagram')}
          </p>
        </div>

        <div class="sc-foot-col">
          <h3>Opening hours</h3>
          <p class="sc-hours">
            <span>Mon–Sat</span> ${orTbd(GYM.hoursWeekday, 'Weekday hours')}<br>
            <span>Sunday</span> ${orTbd(GYM.hoursWeekend, 'Weekend hours')}
          </p>
        </div>

      </div>

      <!-- MAP — the iframe src is deliberately NOT set here. It is loaded
           by an IntersectionObserver in the wiring below, the first time
           this box actually scrolls into view. The footer sits at the very
           bottom of a long page, so an eager iframe here would still cost
           the Maps handshake on every visit even though almost nobody
           scrolls this far before deciding to leave — and an unconditional
           embed would compete with the hero photo for the same loading
           budget on a slow connection. loading="lazy" is kept on the
           <iframe> too as defense in depth for browsers that honour it
           before JS finishes booting. -->
      ${MAP_EMBED_URL ? `
      <div class="sc-map" id="sc-map" data-src="${escHtml(MAP_EMBED_URL)}">
        <a class="sc-map-fallback" href="${escHtml(GYM.mapsUrl)}" target="_blank" rel="noopener">
          Open location in Google Maps
        </a>
      </div>` : ''}

      <div class="sc-foot-bar">
        <small>© ${new Date().getFullYear()} D Sculpt Fitness</small>
        <button class="sc-foot-login" id="sc-foot-login" type="button">Staff &amp; owner login</button>
      </div>
    </footer>
  </div>`;

  injectLandingStyles();

  // ── Wiring ──────────────────────────────────────────────────────
  const toLogin = () => router.go('login');
  const toMemberLogin = () => router.go('member-login');
  document.getElementById('sc-nav-member-login')?.addEventListener('click', toMemberLogin);
  document.getElementById('sc-nav-staff-login')?.addEventListener('click', toLogin);
  document.getElementById('sc-foot-login')?.addEventListener('click', toLogin);

  playIntro();

  // Burger menu — the single navigation entry point at every width now
  // (see the comment on .sc-burger below for why). Section links AND
  // both logins live in the same drawer, closing on any link/button tap.
  const burger = document.getElementById('sc-burger');
  const links = document.getElementById('sc-nav-links');
  const closeMenu = () => {
    links?.classList.remove('is-open');
    burger?.setAttribute('aria-expanded', 'false');
    burger?.setAttribute('aria-label', 'Open menu');
  };
  burger?.addEventListener('click', () => {
    const open = links?.classList.toggle('is-open');
    burger.setAttribute('aria-expanded', String(!!open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });
  links?.querySelectorAll('a, button').forEach(el => el.addEventListener('click', closeMenu));

  // Sticky-nav shade
  const nav = document.querySelector('.sc-nav');
  const onScroll = () => nav?.classList.toggle('is-stuck', window.scrollY > 12);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // Active nav state (scrollspy). Tracks which section is currently
  // crossing a horizontal band roughly a third of the way down the
  // viewport and marks the matching drawer link — the only "visible active
  // state" a burger-drawer nav can meaningfully show, since the links
  // themselves are not on screen at the same time as the content unless
  // the drawer is open. rootMargin biases the trigger line up from centre
  // so a short section (Membership, before any plans load) still gets a
  // turn as "current" instead of being skipped between its taller
  // neighbours.
  const navLinks = [...document.querySelectorAll('.sc-navlink')];
  const sectionEls = navLinks
    .map(a => document.getElementById(a.getAttribute('href').slice(1)))
    .filter(Boolean);
  let spyObs = null;
  if (sectionEls.length && typeof IntersectionObserver !== 'undefined') {
    spyObs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = entry.target.id;
        navLinks.forEach((a) => {
          const match = a.getAttribute('href') === `#${id}`;
          a.classList.toggle('is-active', match);
          if (match) a.setAttribute('aria-current', 'true');
          else a.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
    sectionEls.forEach(el => spyObs.observe(el));
  }

  // Contact map — loaded only once the footer box actually enters the
  // viewport (see the HTML comment above .sc-map for why). A one-shot
  // observer: once the iframe is created it disconnects itself, there is
  // nothing left to watch.
  const mapBox = document.getElementById('sc-map');
  let mapObs = null;
  const loadMap = () => {
    if (!mapBox || mapBox.querySelector('iframe')) return;
    const src = mapBox.getAttribute('data-src');
    if (!src) return;
    const iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.loading = 'lazy';
    iframe.title = 'D Sculpt Fitness location';
    iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    mapBox.prepend(iframe);
  };
  if (mapBox) {
    if (typeof IntersectionObserver === 'undefined') {
      // No lazy-load signal available in this browser — load immediately
      // rather than never show the map at all.
      loadMap();
    } else {
      mapObs = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          loadMap();
          mapObs.disconnect();
        });
      }, { rootMargin: '200px 0px' });
      mapObs.observe(mapBox);
    }
  }

  // Reveal-on-scroll. Guarded by prefers-reduced-motion: when the visitor
  // asks for less motion the elements are simply already visible, rather
  // than animating faster.
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let obs = null;
  const observe = (nodes) => {
    if (reduce || typeof IntersectionObserver === 'undefined') {
      nodes.forEach(el => el.classList.add('is-in'));
      return;
    }
    nodes.forEach(el => el.classList.add('sc-reveal'));
    if (!obs) {
      obs = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add('is-in');
          obs.unobserve(e.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    }
    nodes.forEach(el => obs.observe(el));
  };
  observe([...document.querySelectorAll('.sc-card, .sc-prog, .sc-about-img, .sc-about-text')]);

  // ── Live membership plans ───────────────────────────────────────
  // Fire-and-forget: the rest of the page is already interactive, and a
  // failure here must leave no trace rather than block the shopfront.
  let cancelled = false;
  getPublicPlans(GYM_CODE).then((plans) => {
    if (cancelled || !plans.length) return;
    const section = document.getElementById('membership');
    const grid = document.getElementById('sc-plans');
    if (!section || !grid) return;

    // Highlight the best-value plan — the longest duration on offer.
    const featuredIdx = plans.reduce(
      (best, p, i) => (Number(p.duration_months) > Number(plans[best].duration_months) ? i : best), 0
    );

    grid.innerHTML = plans
      .map((p, i) => planCardHTML(p, i === featuredIdx && plans.length > 1))
      .join('');

    section.hidden = false;
    document.querySelector('.sc-nav-membership')?.removeAttribute('hidden');
    observe([...grid.querySelectorAll('.sc-plan')]);
  });

  window.__sculptLandingCleanup = () => {
    cancelled = true;
    window.removeEventListener('scroll', onScroll);
    if (obs) obs.disconnect();
    if (spyObs) spyObs.disconnect();
    if (mapObs) mapObs.disconnect();
    // Leaving mid-fade must not strand the plate over the next route.
    document.getElementById('sc-intro')?.remove();
  };
}

// ── Intro ─────────────────────────────────────────────────────────
// A black plate over the page while the badge fades up in the middle,
// then the plate dissolves to reveal the landing.
//
// It is mounted on <body>, not inside #root, so navigating away mid-fade
// cannot strip the node out from under its own timers, and it is removed
// on completion rather than left as a transparent sheet over the page —
// an invisible full-screen overlay still swallows the first click.
//
// Skipped entirely under prefers-reduced-motion: a visitor who asked for
// less motion should get the page, not a slower version of the animation.
function playIntro() {
  document.getElementById('sc-intro')?.remove();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const el = document.createElement('div');
  el.id = 'sc-intro';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<img src="/logo-512.png" alt="" decoding="async">`;
  document.body.appendChild(el);

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.classList.add('is-out');
    // Outlast the fade, then take the node out of the document entirely.
    setTimeout(() => el.remove(), 700);
  };

  // Kick the fade on the next frame so the starting state actually renders.
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
  const timer = setTimeout(finish, 1850);
  // Let an impatient visitor cut it short.
  el.addEventListener('click', () => { clearTimeout(timer); finish(); });
}

// ── Styles ────────────────────────────────────────────────────────
// Injected once. Every selector is scoped under .sc-land, so the node is
// idempotent and harmless on other routes.
function injectLandingStyles() {
  if (document.getElementById('sc-land-styles')) return;
  const s = document.createElement('style');
  s.id = 'sc-land-styles';
  s.textContent = `
.sc-land{--sc-measure:1160px;--sc-gut:clamp(16px,4vw,56px);
  --sc-card:20px;--sc-media:12px;
  background:${INK};color:#F2F4F8;font-family:var(--font-sans);overflow-x:hidden;}
.sc-land *{box-sizing:border-box;}
/* margin:0 here is deliberately NOT set — it out-specifies .sc-h2 and
   collapsed the gap under every section heading. Spacing is owned by the
   .sc-h1 / .sc-h2 classes below. */
.sc-land h1,.sc-land h2{font-family:var(--font-display);font-weight:700;
  letter-spacing:0.01em;line-height:0.94;text-transform:uppercase;}
.sc-h1-hi{color:${BLUE};}
.sc-land img{max-width:100%;}

/* ONE MEASURE FOR EVERY BAND.
   The measure lives in each band's own inline padding rather than on a
   child wrapper: the .sc-land h1,h2 rule sets margin:0 at higher
   specificity, so max-width+margin:auto on headings loses to it and
   headings snap to the padding edge while grids stay centred — three
   different left edges down the page. Padding applies uniformly to every
   child whatever its own margins say, and keeps backgrounds full-bleed. */
.sc-nav,.sc-sec,.sc-final,.sc-foot,.sc-hero-inner{
  padding-inline:max(var(--sc-gut),calc((100% - var(--sc-measure)) / 2));
}

/* NAV */
/* z-index sits ABOVE #sc-intro (9999) on purpose: the intro plate is a
   decorative overlay, not a modal, and it used to swallow a visitor's
   first tap — someone landing on the page and immediately tapping a menu
   link got nothing but the logo animation, because the plate ate the
   click instead of forwarding it to the nav underneath. The nav stays
   interactive through the intro so that first tap actually navigates. */
.sc-nav{position:sticky;top:0;z-index:10000;display:flex;align-items:center;gap:20px;
  padding-block:12px;background:rgba(5,5,7,0);
  border-bottom:1px solid transparent;transition:background .25s ease,border-color .25s ease;}
.sc-nav.is-stuck{background:rgba(5,5,7,0.92);backdrop-filter:blur(10px);
  border-bottom-color:rgba(200,205,214,0.12);}
/* The badge carries the wordmark itself, so it is shown at a size where
   the arced SCULPT FITNESS lettering is actually legible, with no
   duplicate HTML text beside it. */
.sc-nav-brand{display:flex;align-items:center;text-decoration:none;line-height:0;}
.sc-nav-brand img{width:76px;height:76px;display:block;}
/* The drawer, not an inline bar — see the .sc-burger comment for why
   this changed from an always-inline nav to a burger-triggered one at
   every width. */
.sc-nav-links{position:absolute;top:100%;left:0;right:0;display:none;
  flex-direction:column;gap:0;background:rgba(5,5,7,0.98);backdrop-filter:blur(10px);
  border-bottom:1px solid rgba(200,205,214,0.12);padding:8px var(--sc-gut) 16px;}
.sc-nav-links.is-open{display:flex;}
.sc-nav-links a{position:relative;color:${CHROME};text-decoration:none;font-size:16px;font-weight:500;
  padding:14px 0 14px 14px;border-bottom:1px solid rgba(200,205,214,0.07);transition:color .18s ease;}
.sc-nav-links a:hover,.sc-nav-links a:focus-visible{color:#fff;}
/* Active-section indicator (scrollspy, wired in renderLanding). A left
   bar rather than a colour-only change — colour alone fails a glance test
   for anyone with reduced colour vision, and this nav already reserves
   ${BLUE_LIGHT} for the member-login CTA, so reusing it here plus a shape
   cue keeps the two visually distinct rather than both just "blue text". */
.sc-navlink.is-active{color:#fff;}
.sc-navlink.is-active::before{content:'';position:absolute;left:0;top:18px;bottom:18px;
  width:3px;border-radius:2px;background:${BLUE};}
/* Visual separation between "browse the site" and "sign in" — a member
   must never land on the staff/owner login by accident. The divider
   plus two deliberately different button treatments (filled brand pill
   vs. plain muted text) are the two cues that do that. */
.sc-nav-divider{height:1px;background:rgba(200,205,214,0.12);margin:10px 0;}
.sc-nav-login-member,.sc-nav-login-staff{display:block;width:100%;text-align:left;
  background:none;border:none;font-family:var(--font-sans);cursor:pointer;padding:12px 0;}
.sc-nav-login-member{color:${BLUE_LIGHT};font-size:16px;font-weight:700;}
.sc-nav-login-member:hover,.sc-nav-login-member:focus-visible{color:#fff;}
.sc-nav-login-staff{color:#6B727E;font-size:13.5px;font-weight:500;
  text-decoration:underline;text-underline-offset:4px;}
.sc-nav-login-staff:hover,.sc-nav-login-staff:focus-visible{color:${CHROME};}
/* Always visible, at every width — the top bar's only job now is the
   logo and this one entry point. See the .sc-nav-links comment. */
.sc-burger{display:flex;margin-left:auto;background:none;border:0;cursor:pointer;
  width:44px;height:44px;padding:10px;flex-direction:column;justify-content:space-between;}
.sc-burger span{display:block;height:2px;background:#F2F4F8;border-radius:2px;}

/* BUTTONS — 30px pill from the reference */
.sc-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;
  background:${BLUE};color:#fff;border:1px solid ${BLUE};border-radius:999px;
  font-family:var(--font-sans);font-weight:700;font-size:15px;
  padding:14px 28px;cursor:pointer;text-decoration:none;line-height:1;
  min-height:48px;transition:background .18s ease,transform .18s ease;}
.sc-btn:hover{background:${BLUE_LIGHT};border-color:${BLUE_LIGHT};}
.sc-btn:active{transform:translateY(1px);}
.sc-btn-sm{padding:10px 20px;font-size:14px;min-height:40px;}
.sc-btn-lg{padding:13px 26px;font-size:14.5px;min-height:44px;}
.sc-btn-ghost{background:transparent;color:#F2F4F8;border-color:rgba(200,205,214,0.32);}
.sc-btn-ghost:hover{background:rgba(200,205,214,0.09);border-color:${CHROME};}
/* 2026-08 REVERSAL, recorded rather than deleted per this codebase's own
   convention: this used to keep a "Member Login" pill inline in the bar
   at every width, deliberately out of the burger drawer, on the reasoning
   that "signed-up members arrive looking for exactly it." That was correct
   when there was one login for everyone. Now there are two — member and
   staff/owner — and a member landing on the wrong one by habit is worse
   than one extra tap, so the client asked for both to move into the
   drawer and the top bar to go back to just the logo. See .sc-nav-links /
   .sc-nav-login-member / .sc-nav-login-staff below for where they live now. */
.sc-land :focus-visible{outline:3px solid ${BLUE_LIGHT};outline-offset:3px;border-radius:8px;}

/* HERO — reference geometry: 791px tall, text low-left, photo bleeding
   off the right edge and dissolved into black by gradient scrims. */
.sc-hero{position:relative;display:flex;align-items:flex-end;
  min-height:clamp(480px,78vh,791px);padding-block:clamp(56px,9vw,88px);overflow:hidden;}
.sc-hero-media{position:absolute;inset:0;z-index:0;}
.sc-hero-media img{width:100%;height:100%;object-fit:cover;object-position:72% center;}
/* Three scrims: a hard left wash so the headline always has its own
   ground, a right-edge fade, and a bottom fade into the next section. */
.sc-hero-scrim{position:absolute;inset:0;
  background:
    linear-gradient(90deg,${INK} 0%,rgba(5,5,7,0.92) 34%,rgba(5,5,7,0.45) 62%,rgba(5,5,7,0.25) 100%),
    linear-gradient(180deg,rgba(5,5,7,0.85) 0%,transparent 26%,transparent 62%,${INK} 100%);}
.sc-hero-inner{position:relative;z-index:1;width:100%;}
.sc-eyebrow{font-family:var(--font-display);text-transform:uppercase;letter-spacing:0.26em;
  font-size:13px;font-weight:600;color:${BLUE};margin:0 0 18px;}
.sc-h1{font-size:clamp(40px,7.4vw,72px);max-width:15ch;margin:0;}
.sc-lede{max-width:46ch;margin:24px 0 0;font-size:clamp(15px,1.6vw,18px);
  line-height:1.62;color:${CHROME};}
.sc-cta-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px;}
.sc-cta-center{justify-content:center;}

/* SECTIONS */
/* 2026-08: trimmed from clamp(48px,7vw,88px). Two adjacent sections each
   paying the full block padding stacked into ~176px of empty black between,
   say, the last "why" card and the first programme heading — enough that a
   visitor scrolling past it on a laptop could plausibly think the page had
   ended. The hero keeps its own much taller min-height, so it stays the
   dominant band regardless of how tight the sections below it run. */
.sc-sec{padding-block:clamp(40px,5.5vw,64px);}
.sc-sec-alt{background:#0A0B0E;}
/* Membership specifically runs tighter still — a pricing grid reads best
   compact, and the hero stays the tallest, most visually dominant band
   on the page precisely because every section below it is this measured. */
.sc-sec-tight{padding-block:clamp(28px,4vw,44px);}
.sc-h2{font-size:clamp(28px,5vw,48px);margin:0 0 16px;}
.sc-sec-sub{color:#8A929F;font-size:14px;line-height:1.6;margin:0 0 20px;max-width:60ch;}
.sc-grid{display:grid;gap:16px;margin-top:8px;}
.sc-grid-2{grid-template-columns:1fr;}
.sc-grid-4{grid-template-columns:1fr;}
@media (min-width:640px){
  .sc-grid-2{grid-template-columns:repeat(2,1fr);}
  .sc-grid-4{grid-template-columns:repeat(2,1fr);}
}
@media (min-width:1000px){
  .sc-grid-4{grid-template-columns:repeat(4,1fr);}
}

/* DUOTONE
   The reference's interior photography is shot in a yellow-branded gym.
   grayscale(1) removes that hue entirely, then a blue layer blended in
   colour mode re-tints the luminance, giving a black/chrome/blue image
   that matches the logo's own palette. isolation:isolate keeps the blend
   inside the figure instead of picking up the page ground. */
.sc-duo{position:relative;isolation:isolate;overflow:hidden;margin:0;
  background:${INK};border-radius:var(--sc-media);}
.sc-duo img{display:block;width:100%;height:100%;object-fit:cover;
  filter:grayscale(1) contrast(1.06) brightness(0.92);}
.sc-duo::before{content:'';position:absolute;inset:0;background:${BLUE};
  mix-blend-mode:color;opacity:0.55;pointer-events:none;}
.sc-duo::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(180deg,rgba(5,5,7,0.10) 0%,rgba(5,5,7,0.55) 100%);}

/* WHY cards */
.sc-card{position:relative;background:#141519;border:1px solid rgba(200,205,214,0.10);
  border-radius:var(--sc-card);padding:30px 26px;transition:border-color .2s ease,background .2s ease;}
.sc-card:hover{border-color:rgba(10,132,255,0.38);background:#16181E;}
.sc-card-n{font-family:var(--font-display);font-size:13px;font-weight:700;
  letter-spacing:0.2em;color:${BLUE};}
.sc-card h3{margin:12px 0 8px;font-size:19px;font-weight:700;line-height:1.25;}
.sc-card p{margin:0;color:${CHROME};font-size:14.5px;line-height:1.62;}

/* PROGRAMMES */
.sc-prog{background:#141519;border:1px solid rgba(200,205,214,0.10);
  border-radius:var(--sc-card);overflow:hidden;transition:border-color .2s ease;}
.sc-prog:hover{border-color:rgba(10,132,255,0.38);}
.sc-prog-img{aspect-ratio:4/3;border-radius:0;}
.sc-prog h3{margin:20px 20px 8px;font-size:17px;font-weight:700;line-height:1.3;}
.sc-prog p{margin:0 20px 22px;color:${CHROME};font-size:14px;line-height:1.6;}

/* MEMBERSHIP */
.sc-plans{grid-template-columns:1fr;}
@media (min-width:640px){.sc-plans{grid-template-columns:repeat(2,1fr);}}
@media (min-width:1000px){.sc-plans{grid-template-columns:repeat(3,1fr);}}
.sc-plan{position:relative;display:flex;flex-direction:column;
  background:#141519;border:1px solid rgba(200,205,214,0.10);
  border-radius:var(--sc-card);padding:22px 20px;}
.sc-plan.is-featured{border-color:${BLUE};background:#12161D;
  box-shadow:0 0 0 1px rgba(10,132,255,0.25),0 12px 28px -12px rgba(10,132,255,0.35);}
.sc-plan-tag{position:absolute;top:-11px;left:20px;background:${BLUE};color:#fff;
  font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;
  padding:5px 12px;border-radius:999px;}
.sc-plan-head h3{margin:0;font-size:18px;font-weight:700;}
.sc-plan-dur{margin:3px 0 0;color:#8A929F;font-size:12.5px;font-weight:500;
  text-transform:uppercase;letter-spacing:0.08em;}
.sc-plan-price{margin:12px 0 0;font-size:34px;font-weight:800;line-height:1;
  letter-spacing:-0.02em;font-variant-numeric:tabular-nums;}
.sc-plan-feats{list-style:none;margin:14px 0 0;padding:0;display:grid;gap:8px;}
.sc-plan-feats li{position:relative;padding-left:24px;color:${CHROME};
  font-size:13.5px;line-height:1.45;}
.sc-plan-feats li::before{content:'';position:absolute;left:0;top:3px;width:15px;height:15px;
  border-radius:50%;border:1.5px solid ${BLUE};
  background:no-repeat center/8px 6px
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 9 7'%3E%3Cpath d='M1 3.6L3.3 6 8 1' fill='none' stroke='%230A84FF' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");}
.sc-plan-feat-more{color:#6B727E;font-style:italic;}
.sc-plan-feat-more::before{display:none;}
.sc-plan-feat-more{padding-left:0;}

/* ABOUT — reference pairs a text column with a 570x454 image */
.sc-about{display:grid;gap:36px;align-items:center;grid-template-columns:1fr;}
@media (min-width:900px){.sc-about{grid-template-columns:1fr 1.05fr;gap:64px;}}
.sc-about-text p{color:${CHROME};font-size:15.5px;line-height:1.7;margin:0 0 18px;max-width:52ch;}
.sc-about-text .sc-btn{margin-top:10px;}
.sc-about-img{aspect-ratio:5/4;border-radius:var(--sc-card);}

/* FINAL CTA */
.sc-final{position:relative;text-align:center;
  padding-block:clamp(40px,6vw,64px);
  border-top:1px solid rgba(200,205,214,0.10);
  background:radial-gradient(120% 100% at 50% 0%,rgba(10,132,255,0.10) 0%,transparent 62%);}
.sc-final-h{font-size:clamp(34px,6vw,64px);}
.sc-final-lede{margin:12px auto 0;}

/* FOOTER */
.sc-foot{border-top:1px solid rgba(200,205,214,0.10);background:#08090B;
  padding-block:52px 24px;}
.sc-foot-grid{display:grid;gap:36px;grid-template-columns:1fr;}
@media (min-width:700px){.sc-foot-grid{grid-template-columns:repeat(2,1fr);}}
@media (min-width:1000px){.sc-foot-grid{grid-template-columns:1.4fr 1fr 1fr 1fr;gap:40px;}}
.sc-foot-brand img{width:56px;height:56px;display:block;}
.sc-foot-brand p{margin:16px 0 0;color:#8A929F;font-size:13.5px;line-height:1.6;max-width:34ch;}
.sc-foot-col h3{font-family:var(--font-display);text-transform:uppercase;
  letter-spacing:0.16em;font-size:12px;font-weight:600;color:${BLUE};margin:0 0 14px;}
.sc-foot-col p{margin:0 0 12px;color:#F2F4F8;font-size:14.5px;line-height:1.7;}
.sc-hours span{display:inline-block;min-width:70px;color:#8A929F;}
.sc-link{color:${BLUE};text-decoration:none;font-weight:600;font-size:14.5px;
  border-bottom:1px solid rgba(10,132,255,0.35);padding-bottom:1px;}
.sc-link:hover{color:${BLUE_LIGHT};border-bottom-color:${BLUE_LIGHT};}
.sc-contact-links{display:flex;flex-direction:column;align-items:flex-start;gap:12px;}
.sc-contact-links a{min-height:32px;display:inline-flex;align-items:center;}
/* Unsupplied facts read as an obvious to-do, never as real content. */
.sc-tbd{display:inline-block;color:#6B727E;font-size:12.5px;font-weight:500;
  background:rgba(200,205,214,0.05);border:1px dashed rgba(200,205,214,0.20);
  border-radius:6px;padding:3px 9px;}
/* MAP — an aspect-ratio box so the layout does not jump by the iframe's
   height the moment the IntersectionObserver in renderLanding fills it in;
   the fallback link sits underneath the box the whole time (not just while
   the iframe is absent) since Google's own "Open in Maps" affordance
   inside the embed is small and easy to miss on a touch screen. */
.sc-map{position:relative;margin-top:36px;border-radius:var(--sc-card);overflow:hidden;
  aspect-ratio:16/7;background:#0E1013;border:1px solid rgba(200,205,214,0.10);}
.sc-map iframe{position:absolute;inset:0;width:100%;height:100%;border:0;filter:grayscale(0.25) contrast(1.05);}
.sc-map-fallback{position:absolute;left:14px;bottom:14px;z-index:1;
  background:rgba(5,5,7,0.82);backdrop-filter:blur(6px);color:#F2F4F8;
  font-size:13px;font-weight:600;text-decoration:none;padding:9px 14px;
  border-radius:999px;border:1px solid rgba(200,205,214,0.22);}
.sc-map-fallback:hover{border-color:${BLUE};color:#fff;}
@media (max-width:560px){.sc-map{aspect-ratio:4/3;}}
.sc-foot-bar{display:flex;flex-wrap:wrap;align-items:center;gap:16px;
  margin-top:44px;padding-top:22px;border-top:1px solid rgba(200,205,214,0.08);}
.sc-foot-bar small{color:#6B727E;font-size:12.5px;}
.sc-foot-login{margin-left:auto;background:none;border:none;color:${CHROME};
  font-family:var(--font-sans);font-size:13.5px;cursor:pointer;padding:8px 4px;
  text-decoration:underline;text-underline-offset:4px;min-height:40px;}
.sc-foot-login:hover{color:#fff;}

/* REVEAL */
.sc-reveal{opacity:0;transform:translateY(16px);
  transition:opacity .5s var(--ease-out,ease),transform .5s var(--ease-out,ease);}
.sc-reveal.is-in{opacity:1;transform:none;}

@media (max-width:860px){
  /* Nav bar/drawer rules used to live here, gated to this width — since
     the 2026-08 reversal above they're universal (see .sc-nav-links /
     .sc-burger), so only the logo shrink stays width-specific. */
  .sc-nav{gap:10px;}
  .sc-nav-brand img{width:60px;height:60px;}
  .sc-burger{margin-left:0;width:40px;height:40px;padding:9px;}
  /* STACKED, NOT OVERLAID.
     On a phone there is no room to run the headline beside the subject,
     and laying it over him either buries the photo under a scrim or
     leaves the copy unreadable — both of which happened. So the hero
     stacks the way the reference's own 393 frame does: photo on top,
     dissolving into the ground, copy on solid black beneath it. */
  .sc-hero{display:block;min-height:0;
    padding-top:min(46vh,380px);padding-bottom:clamp(40px,8vw,56px);}
  .sc-hero-media{inset:0 0 auto 0;height:min(53vh,440px);}
  .sc-hero-media img{object-position:44% 28%;}
  .sc-hero-scrim{background:
    linear-gradient(180deg,rgba(5,5,7,0.34) 0%,rgba(5,5,7,0.10) 40%,rgba(5,5,7,0.72) 80%,${INK} 100%);}
}
@media (max-width:560px){
  .sc-cta-row .sc-btn{width:100%;}
  .sc-plan{padding:18px 16px;}
  .sc-plan-price{font-size:28px;}
}
/* INTRO — mounted on <body>, so these selectors are deliberately not
   scoped under .sc-land. */
#sc-intro{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;
  background:${INK};opacity:1;transition:opacity .6s ease;cursor:pointer;}
#sc-intro img{width:clamp(200px,34vw,320px);height:auto;display:block;
  opacity:0;transform:scale(.86);
  transition:opacity 1.1s ease,transform 1.5s cubic-bezier(.16,.84,.34,1);}
#sc-intro.is-in img{opacity:1;transform:scale(1);}
#sc-intro.is-out{opacity:0;pointer-events:none;}

@media (prefers-reduced-motion:reduce){
  .sc-reveal{opacity:1;transform:none;transition:none;}
}
`;
  document.head.appendChild(s);
}
