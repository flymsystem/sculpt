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
const GYM_CODE = import.meta.env.VITE_PUBLIC_GYM_CODE || 'SCULPT01';

// ── Gym details ───────────────────────────────────────────────────
// An empty string means "not supplied yet" and renders as a visible
// to-be-supplied chip. Fill these in and the chips vanish.
const GYM = {
  addressLine1: 'Malagala',
  addressLine2: 'Bangalore',
  phone: '',
  whatsapp: '',
  email: '',
  hoursWeekday: '',
  hoursWeekend: '',
  instagram: '',
  mapsUrl: '',
};

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

/** features is free text — one perk per line, or comma separated. */
const featureList = (features) =>
  String(features || '')
    .split(/[\n,;]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 5);

export function renderLanding(router) {
  // ── Force dark while mounted, restore on the way out ────────────
  const prevTheme = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', 'dark');
  window.__sculptLandingRestoreTheme = () => {
    if (prevTheme) document.documentElement.setAttribute('data-theme', prevTheme);
    else document.documentElement.removeAttribute('data-theme');
  };

  const telHref = GYM.phone ? `tel:${GYM.phone.replace(/[^\d+]/g, '')}` : '';
  const waHref = GYM.whatsapp ? `https://wa.me/${GYM.whatsapp.replace(/[^\d]/g, '')}` : '';
  const mailHref = GYM.email ? `mailto:${GYM.email}` : '';

  document.getElementById('root').innerHTML = `
  <div class="sc-land">

    <!-- ── NAV ─────────────────────────────────────────────── -->
    <header class="sc-nav" role="banner">
      <a class="sc-nav-brand" href="#top" aria-label="D Sculpt Fitness home">
        <img src="/logo-128.png" alt="D Sculpt Fitness" width="56" height="56" decoding="async">
      </a>
      <nav class="sc-nav-links" id="sc-nav-links" aria-label="Primary">
        <a href="#why">Why us</a>
        <a href="#programmes">Training</a>
        <a href="#membership" class="sc-nav-membership" hidden>Membership</a>
        <a href="#about">About</a>
        <a href="#contact">Contact</a>
      </nav>
      <button class="sc-btn sc-nav-cta" id="sc-nav-login" type="button">Member Login</button>
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
        <img src="/img/hero.jpg" alt="" fetchpriority="high" decoding="async">
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
          <a class="sc-btn sc-btn-lg" href="#contact">Contact us</a>
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
              <img src="${p.img}" alt="" loading="lazy" decoding="async">
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
    <section class="sc-sec" id="membership" hidden>
      <h2 class="sc-h2">MEMBER<span class="sc-h1-hi">SHIP</span></h2>
      <p class="sc-sec-sub">Straightforward pricing. No joining fee, no lock-in contract.</p>
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
        <a class="sc-btn sc-btn-lg" href="#contact">Come and see the floor</a>
      </div>
      <figure class="sc-duo sc-about-img">
        <img src="/img/about.jpg" alt="The D Sculpt Fitness training floor" loading="lazy" decoding="async">
      </figure>
    </section>

    <!-- ── CLOSING CTA ─────────────────────────────────────── -->
    <section class="sc-final">
      <h2 class="sc-h2 sc-final-h">READY TO <span class="sc-h1-hi">START?</span></h2>
      <p class="sc-lede sc-final-lede">
        Come in, look around, and talk to a trainer before you commit to anything.
      </p>
      <div class="sc-cta-row sc-cta-center">
        <a class="sc-btn sc-btn-lg" href="#contact">Contact us</a>
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
            <span>Mon–Fri</span> ${orTbd(GYM.hoursWeekday, 'Weekday hours')}<br>
            <span>Sat–Sun</span> ${orTbd(GYM.hoursWeekend, 'Weekend hours')}
          </p>
        </div>

      </div>
      <div class="sc-foot-bar">
        <small>© ${new Date().getFullYear()} D Sculpt Fitness</small>
        <button class="sc-foot-login" id="sc-foot-login" type="button">Staff &amp; owner login</button>
      </div>
    </footer>
  </div>`;

  injectLandingStyles();

  // ── Wiring ──────────────────────────────────────────────────────
  const toLogin = () => router.go('login');
  document.getElementById('sc-nav-login')?.addEventListener('click', toLogin);
  document.getElementById('sc-foot-login')?.addEventListener('click', toLogin);

  playIntro();

  // Mobile menu
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
  links?.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));

  // Sticky-nav shade
  const nav = document.querySelector('.sc-nav');
  const onScroll = () => nav?.classList.toggle('is-stuck', window.scrollY > 12);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

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

    grid.innerHTML = plans.map((p, i) => {
      const feats = featureList(p.features);
      return `
      <article class="sc-plan${i === featuredIdx && plans.length > 1 ? ' is-featured' : ''}">
        ${i === featuredIdx && plans.length > 1 ? '<span class="sc-plan-tag">Best value</span>' : ''}
        <div class="sc-plan-head">
          <h3>${escHtml(p.name || 'Membership')}</h3>
          <p class="sc-plan-dur">${escHtml(duration(p.duration_months))}</p>
        </div>
        <p class="sc-plan-price">${escHtml(inr(p.price))}</p>
        ${feats.length ? `<ul class="sc-plan-feats">
          ${feats.map(f => `<li>${escHtml(f)}</li>`).join('')}
        </ul>` : ''}
        <a class="sc-btn sc-plan-btn${i === featuredIdx && plans.length > 1 ? '' : ' sc-btn-ghost'}"
           href="#contact">Enquire</a>
      </article>`;
    }).join('');

    section.hidden = false;
    document.querySelector('.sc-nav-membership')?.removeAttribute('hidden');
    observe([...grid.querySelectorAll('.sc-plan')]);
  });

  window.__sculptLandingCleanup = () => {
    cancelled = true;
    window.removeEventListener('scroll', onScroll);
    if (obs) obs.disconnect();
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
.sc-nav{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:20px;
  padding-block:12px;background:rgba(5,5,7,0);
  border-bottom:1px solid transparent;transition:background .25s ease,border-color .25s ease;}
.sc-nav.is-stuck{background:rgba(5,5,7,0.92);backdrop-filter:blur(10px);
  border-bottom-color:rgba(200,205,214,0.12);}
/* The badge carries the wordmark itself, so it is shown at a size where
   the arced SCULPT FITNESS lettering is actually legible, with no
   duplicate HTML text beside it. */
.sc-nav-brand{display:flex;align-items:center;text-decoration:none;line-height:0;}
.sc-nav-brand img{width:76px;height:76px;display:block;}
.sc-nav-links{display:flex;gap:28px;margin-left:auto;}
.sc-nav-links a{color:${CHROME};text-decoration:none;font-size:14px;font-weight:500;
  padding:6px 0;transition:color .18s ease;}
.sc-nav-links a:hover,.sc-nav-links a:focus-visible{color:#fff;}
.sc-burger{display:none;margin-left:auto;background:none;border:0;cursor:pointer;
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
.sc-btn-lg{padding:16px 32px;font-size:16px;}
.sc-btn-ghost{background:transparent;color:#F2F4F8;border-color:rgba(200,205,214,0.32);}
.sc-btn-ghost:hover{background:rgba(200,205,214,0.09);border-color:${CHROME};}
/* The nav login is a utility action, not the page's primary CTA — that is
   "Contact us" in the hero. It is sized down so it stops competing with the
   headline, and it stays in the bar at every width rather than being hidden
   behind the burger, because signed-up members arrive looking for exactly it.
   Declared after the size modifiers so it is the single source of its size. */
.sc-nav-cta{flex-shrink:0;padding:8px 18px;font-size:13px;min-height:36px;letter-spacing:0.01em;}
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
.sc-cta-row{display:flex;flex-wrap:wrap;gap:12px;margin-top:32px;}
.sc-cta-center{justify-content:center;}

/* SECTIONS */
.sc-sec{padding-block:clamp(56px,8vw,104px);}
.sc-sec-alt{background:#0A0B0E;}
.sc-h2{font-size:clamp(30px,5vw,48px);margin:0 0 22px;}
.sc-sec-sub{color:#8A929F;font-size:14px;line-height:1.6;margin:0 0 34px;max-width:60ch;}
.sc-grid{display:grid;gap:20px;margin-top:34px;}
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
  border-radius:var(--sc-card);padding:28px 24px;}
.sc-plan.is-featured{border-color:${BLUE};background:#12161D;}
.sc-plan-tag{position:absolute;top:-11px;left:24px;background:${BLUE};color:#fff;
  font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;
  padding:5px 12px;border-radius:999px;}
.sc-plan-head h3{margin:0;font-size:19px;font-weight:700;}
.sc-plan-dur{margin:4px 0 0;color:#8A929F;font-size:13px;font-weight:500;
  text-transform:uppercase;letter-spacing:0.08em;}
.sc-plan-price{margin:18px 0 0;font-size:38px;font-weight:800;line-height:1;
  letter-spacing:-0.02em;font-variant-numeric:tabular-nums;}
.sc-plan-feats{list-style:none;margin:20px 0 0;padding:0;display:grid;gap:10px;}
.sc-plan-feats li{position:relative;padding-left:26px;color:${CHROME};
  font-size:14px;line-height:1.5;}
.sc-plan-feats li::before{content:'';position:absolute;left:0;top:4px;width:16px;height:16px;
  border-radius:50%;border:1.5px solid ${BLUE};
  background:no-repeat center/9px 7px
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 9 7'%3E%3Cpath d='M1 3.6L3.3 6 8 1' fill='none' stroke='%230A84FF' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");}
.sc-plan-btn{margin-top:24px;width:100%;}
.sc-plan-feats + .sc-plan-btn{margin-top:auto;padding-top:24px;}

/* ABOUT — reference pairs a text column with a 570x454 image */
.sc-about{display:grid;gap:36px;align-items:center;grid-template-columns:1fr;}
@media (min-width:900px){.sc-about{grid-template-columns:1fr 1.05fr;gap:64px;}}
.sc-about-text p{color:${CHROME};font-size:15.5px;line-height:1.7;margin:0 0 18px;max-width:52ch;}
.sc-about-text .sc-btn{margin-top:10px;}
.sc-about-img{aspect-ratio:5/4;border-radius:var(--sc-card);}

/* FINAL CTA */
.sc-final{position:relative;text-align:center;
  padding-block:clamp(64px,10vw,120px);
  border-top:1px solid rgba(200,205,214,0.10);
  background:radial-gradient(120% 100% at 50% 0%,rgba(10,132,255,0.10) 0%,transparent 62%);}
.sc-final-h{font-size:clamp(34px,6vw,64px);}
.sc-final-lede{margin:20px auto 0;}

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
  /* The login stays on the bar and the burger sits after it. Hiding the
     login inside the drawer put the one thing an existing member came for
     two taps away, behind an icon. */
  .sc-nav{gap:10px;}
  .sc-nav-brand img{width:60px;height:60px;}
  .sc-nav-cta{margin-left:auto;padding:7px 14px;font-size:12px;min-height:34px;}
  .sc-burger{display:flex;margin-left:0;width:40px;height:40px;padding:9px;}
  .sc-nav-links{position:absolute;top:100%;left:0;right:0;display:none;
    flex-direction:column;gap:0;background:rgba(5,5,7,0.98);backdrop-filter:blur(10px);
    border-bottom:1px solid rgba(200,205,214,0.12);padding:8px var(--sc-gut) 16px;}
  .sc-nav-links.is-open{display:flex;}
  .sc-nav-links a{padding:14px 0;font-size:16px;
    border-bottom:1px solid rgba(200,205,214,0.07);}
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
  .sc-plan-price{font-size:32px;}
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
