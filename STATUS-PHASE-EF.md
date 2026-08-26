# Phase E + F — status

Worktree: `C:\steven\sculp\sculp-fitness\.claude\worktrees\agent-af98335f6c4b44691`
Branch: `worktree-agent-af98335f6c4b44691`

Commits (in order):
1. `18aea01` — real contact details, WhatsApp CTAs, lazy map, scrollspy nav, index.html SEO/JSON-LD
2. `1881f50` — real gym photography (hero/about/2 training slots) + social share image
3. `c0ba340` — new Playwright coverage for the above
4. `209bcf6` — scrollspy test robustness fix (flaky under parallel workers)

Commits are grouped by concern rather than strictly one-per-lettered-item:
several E-items (E1/E2/E3/E4/E6) all touched the same handful of
contiguous regions of `src/pages/landing.js` in one pass, and splitting
those into separate commits after the fact would have meant fabricating
artificial intermediate states rather than doing per-item work in order.
E5 ("remove decorative unused nav / empty contact placeholder / non-
functional CTA") had no leftover matching content to remove — see its row
below.

## E/F items

| # | What changed | How verified |
|---|---|---|
| E1 | Contact section gets a real Google Maps embed (`maps.google.com/maps?...&output=embed`, no API key). Loaded via `IntersectionObserver` only once the footer's `#sc-map` box scrolls into view (200px rootMargin lead), with `loading="lazy"` on the `<iframe>` as defense-in-depth, plus an always-visible "Open location in Google Maps" pill overlay as a fallback/secondary affordance. | Playwright test asserts zero `<iframe>` on initial load, then one with the correct `output=embed` src after `scrollIntoViewIfNeeded()`. Also confirmed visually via a full-page screenshot at desktop and mobile widths (see below). |
| E2 | "Contact us" (hero + closing band) and "Come and see the floor" (About) now fire `https://wa.me/918867878946?text=...` directly in a new tab instead of scrolling to `#contact`. "View memberships" untouched. | Playwright test asserts every `a.sc-btn` with text "Contact us" has an `href` matching `^https://wa\.me/918867878946\?text=` and `target="_blank"`. |
| E3 | Footer "Visit"/"Talk to us"/"Opening hours" columns now render real `tel:`, second `tel:` line, `wa.me`, `mailto:`, Instagram and Maps links, and real Mon–Sat / Sunday hours (labels changed from the old placeholder "Mon–Fri"/"Sat–Sun"). | Playwright test asserts exact `href` values for each link type and that `.sc-tbd` count is 0 (every to-be-supplied chip is gone). |
| E4 | `.sc-sec` block padding trimmed from `clamp(48px,7vw,88px)` to `clamp(40px,5.5vw,64px)`, `.sc-sec-tight` from `clamp(32px,5vw,56px)` to `clamp(28px,4vw,44px)`. Section headings (`.sc-h2`) untouched — already consistent. Nav gets a scrollspy-driven `.is-active` state (left accent bar + white text + `aria-current`) on the drawer link matching the section in view. | Visual diff via full-page screenshots at 1440px and 390px before/after — no section-to-section gap reads as a page break anymore. Scrollspy covered by a Playwright test (scroll to `#contact`, assert its nav link gets `.is-active`/`aria-current`). |
| E5 | Audited for unused decorative nav, empty contact placeholders, and non-functional CTAs. Nothing left to remove: the nav has no decorative-only elements (every link/button is functional), and the only "empty contact placeholder" state was the `.sc-tbd` chips, which now render real content instead of being deleted (deleting them outright would have broken the graceful-degradation contract `tbd()`/`orTbd()` exist for — see the CONTENT POLICY comment at the top of `landing.js` — for any *future* field the client hasn't supplied yet). The one CTA that previously did *not* act immediately ("Contact us" → `#contact`) was fixed under E2, not removed. | Manual audit of the rendered nav/footer markup; confirmed via the `.sc-tbd` count assertion in the E3 test. |
| E6 | Verified the `popstate` same-page-anchor guard in `src/app.js` (`if (page === router.current && page !== 'gym') return;`) is intact and unmodified, and added a Playwright regression test that actually clicks a real nav link (`#why`) and asserts the intro overlay is *not* remounted and `#root` is the same DOM node — i.e. the page was not torn down and rebuilt. | New Playwright test passes; confirms the guard still works end-to-end, not just by reading the source. |
| F | 4 real photos from `PHOTOS/` mapped to slots: `hero.jpg` ← `landing page - main.png` (full colour); `about.jpg` ← `sub photo 1`; `train-1.jpg` (Strength & Conditioning) ← `sub photo 3`; `train-4.jpg` (Cardio & Conditioning) ← `sub photo 2`. `train-2.jpg` (Personal Training) and `train-3.jpg` (Group Classes) have no matching source photo and remain the original stock images — **not overwritten, not deleted**. `scripts/prep-landing-images.mjs` rewritten to read `PHOTOS/` by filename (the old Figma-hash lookup is gone) and also composites a 1200×630 `public/img/og-share.jpg` from the new hero + `public/logo-512.png`, wired into `index.html`'s `og:image`/`twitter:image`. `width`/`height` attributes added to the hero, about, and programme-card `<img>` tags to reserve layout space. | Ran `node scripts/prep-landing-images.mjs` and inspected each output image directly (see console output below). Confirmed in the rendered page that the hero has no `.sc-duo` wrapper (stays full colour) while `about.jpg` and all 4 programme-card images (real and stock alike) sit inside a `.sc-duo` figure and visibly pick up the grayscale+blue-blend treatment — checked with a full-page screenshot, not just by reading the CSS, and covered by a Playwright test. |

## Photo slots — needs Steven

| Slot | Source | Status |
|---|---|---|
| hero | `landing page - main.png` | **Real photo** |
| about | `landing page - sub photo 1.png` | **Real photo** |
| train-1 (Strength & Conditioning) | `landing page - sub photo 3.png` | **Real photo** |
| train-4 (Cardio & Conditioning) | `landing page - sub photo 2.png` | **Real photo** |
| train-2 (Personal Training) | — | **Still stock** (original template image, untouched) |
| train-3 (Group Classes) | — | **Still stock** (original template image, untouched) |

The client supplied 4 photos against 6 slots. Two more photos — ideally
a 1-on-1 coaching moment for Personal Training and a group/class shot for
Group Classes — would let the last two stock images be replaced without
any code change: drop them into `PHOTOS/`, add two lines to the `JOBS`
array in `scripts/prep-landing-images.mjs`, and re-run the script.

## Ambiguous calls

- **sub photo 3 → Strength & Conditioning, not Group Classes.** The
  photo has both a loaded barbell rack/plates (strength) and a couple of
  step platforms in the background (group-class gear). The rack and
  plates dominate the foreground and read unambiguously as "strength
  training" at a glance, which is what the card needs at thumbnail size,
  so it went to Strength & Conditioning over Group Classes.
- **sub photo 2 → Cardio & Conditioning.** Treadmills sit in the
  foreground on the left, machines fill the rest of the (otherwise very
  wide) floor shot. Treadmills are the clearest single equipment cue for
  "cardio" among the four photos, so this one went there over Strength &
  Conditioning even though it also shows strength machines.
- **sub photo 1 → About, not a training-category slot.** It's a member
  from behind, facing the branded mirror wall — no equipment in frame at
  all, so it doesn't read as any specific training category. It reads as
  "the D Sculpt Fitness culture/identity," which is exactly what the
  About section's copy is selling, so it went there over being held back
  entirely.
- **Contact us CTA fallback.** `ctaHref` falls back to `#contact` only in
  the hypothetical state where `GYM.whatsapp` is ever blank again (e.g. a
  future white-label deploy with no WhatsApp number yet) — today it is
  always the wa.me link, since the number is filled in. This keeps the
  button from ever being a dead link if that field is ever cleared.
- **`Contact` nav link vs. "Contact us" CTA.** Kept the nav drawer's plain
  "Contact" link scrolling to `#contact` (the footer) rather than also
  routing it through WhatsApp — the brief's "must perform a real action
  immediately" language reads as being about the CTA *buttons*
  specifically, not the section-navigation links, which exist precisely
  to let a visitor browse to the footer's full set of contact options.
- **Second phone number placement.** `GYM.phone2` renders as an unlabelled
  second `tel:` link directly under the primary number in "Talk to us" —
  no "(alt)" or "(2nd line)" label. Both numbers reaching the same gym
  didn't seem to need disambiguating text, and adding a label risked
  implying one number is for a different purpose (e.g. billing) which was
  never stated.

## Not finished / needs follow-up

- WebP/AVIF `<picture>` variants were **not** added (optional per the
  brief — "if you can do it without breaking the hero's fetchpriority").
  Given the time budget, JPEG-only was chosen to keep the fetchpriority
  contract on the hero `<img>` unambiguous; if this matters for
  performance later, `prep-landing-images.mjs` is the place to add a
  second encode pass per image.
- The Maps embed uses the classic `maps.google.com/maps?...&output=embed`
  URL (no API key required) rather than the newer Maps Embed API — this
  was a deliberate choice to avoid introducing a Google Cloud API key
  dependency for a single embed, but it's worth knowing this is the
  "unofficial" embed method if Google ever changes its behavior.
- `public/img/.dimensions.json` is a small metadata file the prep script
  writes for its own future runs (not read by the app) — harmless to
  keep or delete.

## Verification output

```
$ npm run build
✓ built in 722ms
✓ Service worker stamped with version sculpt-1787730961521

$ npm run lint
12 problems (12 errors, 0 warnings)   # identical pre-existing set named in CLAUDE.md — none in landing.js

$ npx playwright test
21 skipped
44 passed (7.0s)
```

Image prep script output (`node scripts/prep-landing-images.mjs`):
```
hero.jpg      1459x1078 -> 1400x1034  2174KB -> 177KB
about.jpg     1190x1322 -> 1190x1322  1872KB -> 147KB
train-1.jpg   1402x1122 -> 900x720    1873KB -> 78KB
train-4.jpg   1295x1214 -> 900x844    1821KB -> 85KB
og-share.jpg  1200x630                101KB
```

Rendered pages were checked directly with a headless Playwright browser
at 1440×900 and 390×844 (hero, why-us, programmes, about, membership-CTA,
footer/map) — screenshots were used to confirm layout, duotone treatment,
and the map fallback pill, then discarded (not part of the deliverable,
not committed).

Note on environment: this worktree had no `.env.local` — Supabase env vars
are baked in at Vite build time, and without them the whole app throws
`supabaseUrl is required` on boot (every route, not just the ones that
call Supabase), which made the *entire* Playwright suite fail with an
empty `#root` on first run. Copied `.env.local` from the shared checkout
before rebuilding; this is a pre-existing environment-setup requirement,
unrelated to anything in this phase's diff.
