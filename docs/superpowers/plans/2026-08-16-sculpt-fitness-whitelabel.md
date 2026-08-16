# D Sculpt Fitness White-Label Build — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert a clone of the Flym multi-tenant gym SaaS into a standalone, single-tenant product for D Sculpt Fitness, with its own branding, its own Supabase backend, and zero remaining trace of Flym.

**Architecture:** Strip first (remove superadmin, broadcast/Razorpay, contact form, subscription tiers), then rebrand every remaining string and asset, then rebuild the design tokens and landing page around the client's logo, then stand up a fresh Supabase project whose schema is verified against what the code actually queries rather than trusted from the migrations folder.

**Tech Stack:** Vanilla ES modules + Vite 8, Supabase (Postgres + Auth + RLS + Edge Functions), Playwright for verification, PWA with a hand-written service worker. No framework, no TypeScript in `src/`.

**Spec:** `docs/superpowers/specs/2026-08-16-sculpt-fitness-whitelabel-design.md`

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Brand name, verbatim:** `D Sculpt Fitness`. Never `Sculp`, never `Sculpt Fitness` alone in a title, never `D Sculpt`.
- **Identifier prefix:** `sculpt` (lowercase) for code identifiers, cache keys, storage keys, cron job names, and SQL functions. Never `sculp`.
- **`vite.config.js` must keep `base: '/'`.** Changing it to `'./'` makes deep-link hard refresh silently serve `index.html` as JavaScript. This is the single highest-severity regression in this codebase.
- **Money RPCs stay invoker-rights** (NOT `SECURITY DEFINER`) and stay single-transaction. Rename freely; never alter transaction boundaries, `FOR UPDATE` locking, or RLS behaviour.
- **Soft delete via `is_active = false` everywhere except `expenses`,** which hard deletes. Do not normalise this.
- **`escHtml()` / `escAttr()` must wrap any user-entered text** before it reaches `innerHTML`. `escAttr()` for `onclick="..."` attributes specifically.
- **Overlays anchored in `.topbar` must be portaled to `<body>`.** `.topbar` has `overflow: hidden` in `dashboard.css` and will clip them.
- **Never combine the `hidden` attribute with a `display:` style** on the same element. Use a `.is-open` class with `display: none` as the base rule.
- **No full-screen backdrops on desktop.** Mobile only.
- **Routes and the PDF engine stay dynamically imported.** Entry JS is ~15 kB; `vendor-pdf` is ~935 kB.
- **No new runtime npm dependencies.** `@playwright/test`, `eslint` and `vite` are the only dev dependencies; asset generation must use what is already installed.
- **Hardcoded hex colours inside print/invoice/receipt HTML generators are correct,** not violations. Paper has no dark mode. Do not tokenise them.
- **Do not invent client facts.** No fabricated address, phone number, domain, testimonial, trainer name, price, or class schedule. Unknown values use the placeholder convention from Task 15 and go on the handover checklist.

### Test cycle for this codebase

There is no unit test framework. The test cycle is:

```
npm run build          # must succeed
npx playwright test    # runs against the BUILT output via npm run preview
```

`playwright.config.js` starts `npm run preview` itself and serves on port 4173, so `npm run build` must run first to give it fresh files. Tests live in `tests/*.spec.js`.

---

## File Structure

**Deleted**

| Path | Lines | Reason |
|---|---|---|
| `src/pages/admin-dashboard.js` | 1818 | Flym superadmin panel |
| `src/lib/admin.js` | 189 | All 8 exports are cross-gym admin ops |
| `src/pages/dashboard/broadcast.js` | 930 | Paid bulk-WhatsApp feature |
| `src/lib/broadcast.js` | 165 | Broadcast + Razorpay helpers |
| `src/pages/dashboard/contact.js` | 167 | Support-ticket form |
| `src/lib/tiers.js` | 42 | Flym's commercial Pro gate |
| `src/assets/logos/*`, `public/logos/*` | — | Flym wordmark SVGs |
| `supabase/functions/create-broadcast-order/` | — | Razorpay order creation |
| `supabase/functions/process-broadcast/` | — | Broadcast sender |
| `supabase/functions/whatsapp-webhook/` | — | Broadcast delivery receipts only |
| `supabase/functions/send-reminders/` | — | Automatic reminders |
| `supabase/functions/create-gym-user/` | — | Admin-only gym creation |

**Created**

| Path | Responsibility |
|---|---|
| `scripts/generate-icons.mjs` | One-off: render `sculp-logo.png` to PWA icon sizes using the already-installed Playwright browser |
| `public/icon-{48,96,192,512}.png`, `public/apple-touch-icon.png`, `public/favicon.ico` | Generated icon set |
| `src/pages/landing.js` | Rewritten from scratch |
| `supabase/migrations/100_sculpt_baseline_gaps.sql` | Tables/columns the code queries that no migration creates |
| `supabase/migrations/101_sculpt_rename_rpcs.sql` | `flym_*` → `sculpt_*` identifiers |
| `supabase/migrations/102_sculpt_drop_removed_features.sql` | Drops broadcast, support_messages, reminder cron |
| `supabase/migrations/103_sculpt_storage_buckets.sql` | Buckets + policies, previously created by hand |
| `supabase/seed/bootstrap_gym.sql` | One-off gym + owner bootstrap |
| `tests/rebrand.spec.js` | Asserts no Flym string reaches the browser, no Razorpay script loads |
| `tests/landing.spec.js` | Landing page renders at mobile + desktop |
| `tests/removed-routes.spec.js` | Dead routes redirect instead of crashing |
| `HANDOVER-SCULPT.md` | Client-facing checklist of what still needs real content |

**Heavily modified:** `src/app.js` (routes), `src/pages/dashboard/index.js` + `sidebar.js` (nav, tiers), `index.html`, `public/manifest.json`, `public/sw.js`, `vite.config.js`, `src/styles/tokens.css`, `package.json`.

---

## Phase 1 — Strip

### Task 1: Remove the superadmin panel

**Files:**
- Delete: `src/pages/admin-dashboard.js`, `src/lib/admin.js`
- Modify: `src/app.js` (the `routes` object, ~line 270; role-routing logic ~lines 55–75)
- Test: `tests/removed-routes.spec.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: the router's `routes` object no longer has an `admin` key. Any code branching on `role === 'admin'` is gone; `src/app.js` routes only `landing`, `login`, `gym`, `verify`.

- [ ] **Step 1: Confirm nothing else imports the admin modules**

```bash
grep -rn "lib/admin.js\|admin-dashboard" src --include=*.js
```

Expected: matches ONLY inside `src/lib/admin.js` (its own header comment) and `src/pages/admin-dashboard.js`. If any other file appears, stop and report it — the deletion is not safe as planned.

- [ ] **Step 2: Write the failing test**

Create `tests/removed-routes.spec.js`:

```js
// tests/removed-routes.spec.js
//
// Features removed during the D Sculpt Fitness white-label build must not
// merely be hidden from the nav — their URLs must not crash the app either.
// A stale bookmark or a browser-restored tab will hit these paths.

import { test, expect } from '@playwright/test';

const REMOVED_ROUTES = ['/admin', '/dashboard/broadcast', '/dashboard/contact'];

for (const route of REMOVED_ROUTES) {
  test(`removed route ${route} does not crash the app`, async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));

    await page.goto(route, { waitUntil: 'load' });

    // The app must boot and render something — a login redirect is fine,
    // a blank #root or an uncaught throw is not.
    await expect(page.locator('#root')).not.toBeEmpty();
    expect(jsErrors, `Uncaught JS error on removed route ${route}`).toEqual([]);
  });
}
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm run build
npx playwright test tests/removed-routes.spec.js
```

Expected: `/dashboard/broadcast` and `/dashboard/contact` may pass already; `/admin` currently loads the superadmin chunk. Record the actual result — the point is to have a baseline before deleting.

- [ ] **Step 4: Delete the two files**

```bash
git rm src/pages/admin-dashboard.js src/lib/admin.js
```

- [ ] **Step 5: Remove the admin route from `src/app.js`**

Delete this line from the `routes` object (~line 270):

```js
      admin:   lazyRoute(() => import('./pages/admin-dashboard.js'),  m => m.renderAdminDashboard(router)),
```

Then read the surrounding auth/role logic (~lines 55–75 and `PAGE_TO_PATH`) and remove every `admin` branch, including the `/admin` entry in `PAGE_TO_PATH`. An unknown page must fall through to the existing `login` redirect, which already handles it.

- [ ] **Step 6: Verify the build and the test**

```bash
npm run build
npx playwright test tests/removed-routes.spec.js
```

Expected: build succeeds, all three routes render without a JS error.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove Flym superadmin panel and admin route"
```

---

### Task 2: Remove broadcast and Razorpay

**Files:**
- Delete: `src/pages/dashboard/broadcast.js`, `src/lib/broadcast.js`
- Delete: `supabase/functions/create-broadcast-order/`, `supabase/functions/process-broadcast/`, `supabase/functions/whatsapp-webhook/`
- Modify: `index.html:90-91`, `src/pages/dashboard/index.js`, `src/pages/dashboard/sidebar.js`, `src/lib/permissions.js`
- Test: `tests/rebrand.spec.js` (create)

**Interfaces:**
- Consumes: `tests/removed-routes.spec.js` from Task 1.
- Produces: no `broadcast` key in the `permissions.js` MATRIX, no `broadcast` entry in `getVisibleSections()`'s `navMap`, no Razorpay script tag.

- [ ] **Step 1: Confirm the Razorpay blast radius**

```bash
grep -rn -i razorpay src public supabase index.html
```

Expected: hits only in `src/lib/broadcast.js`, `src/pages/dashboard/broadcast.js`, `supabase/functions/create-broadcast-order/index.ts`, `supabase/functions/process-broadcast/index.ts`, `supabase/migrations/025_broadcast.sql`, and `index.html`. Anything else means another feature depends on it — stop and report.

- [ ] **Step 2: Write the failing test**

Create `tests/rebrand.spec.js`:

```js
// tests/rebrand.spec.js
//
// This is a white-label build. Two things must be true in the BROWSER, not
// just in the source: no Flym branding is visible, and the Razorpay SDK —
// which existed only to sell broadcast credits — is never fetched.
//
// Source greps are checked separately in CI-less fashion by the developer;
// these tests catch the case where a string survives into the built bundle.

import { test, expect } from '@playwright/test';

const PUBLIC_PAGES = ['/', '/login'];

for (const path of PUBLIC_PAGES) {
  test(`no Razorpay SDK is requested on ${path}`, async ({ page }) => {
    const razorpayRequests = [];
    page.on('request', (req) => {
      if (req.url().toLowerCase().includes('razorpay')) {
        razorpayRequests.push(req.url());
      }
    });

    await page.goto(path, { waitUntil: 'load' });
    await expect(page.locator('#root')).not.toBeEmpty();

    expect(
      razorpayRequests,
      'The Razorpay checkout SDK was requested. It only ever served the ' +
      'broadcast feature, which has been removed.'
    ).toEqual([]);
  });

  test(`no visible Flym branding on ${path}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' });
    await expect(page.locator('#root')).not.toBeEmpty();

    const bodyText = await page.locator('body').innerText();
    expect(
      bodyText.toLowerCase(),
      'Flym branding is visible on the rendered page.'
    ).not.toContain('flym');

    const title = await page.title();
    expect(title.toLowerCase()).not.toContain('flym');
  });
}
```

- [ ] **Step 3: Run it to verify it fails**

```bash
npm run build
npx playwright test tests/rebrand.spec.js
```

Expected: FAIL — the Razorpay assertion fails on both pages (the script tag is unconditional in `index.html`), and the branding assertions fail on the Flym landing page.

- [ ] **Step 4: Delete the broadcast modules and edge functions**

```bash
git rm src/pages/dashboard/broadcast.js src/lib/broadcast.js
git rm -r supabase/functions/create-broadcast-order supabase/functions/process-broadcast supabase/functions/whatsapp-webhook
```

- [ ] **Step 5: Remove the Razorpay script tag**

In `index.html`, delete both lines:

```html
  <!-- Razorpay Checkout SDK (used by Broadcast feature) -->
  <script src="https://checkout.razorpay.com/v1/checkout.js" defer></script>
```

- [ ] **Step 6: Remove broadcast from permissions and nav**

In `src/lib/permissions.js`, delete the `broadcast:` line from BOTH the `owner` and `staff` blocks of `MATRIX`, and delete this entry from `navMap` inside `getVisibleSections()`:

```js
    { id: 'broadcast',       perm: 'broadcast' },
```

In `src/pages/dashboard/index.js` and `src/pages/dashboard/sidebar.js`, remove the `broadcast` section entry, its dynamic `import()`, and its nav item. Search both files for `broadcast` and remove every hit.

- [ ] **Step 7: Verify**

```bash
npm run build
npx playwright test tests/rebrand.spec.js tests/removed-routes.spec.js
```

Expected: the Razorpay assertions now PASS. The Flym-branding assertions still FAIL — that is correct, Task 6 fixes them.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove WhatsApp broadcast feature and Razorpay integration"
```

---

### Task 3: Remove the Contact Us form

**Files:**
- Delete: `src/pages/dashboard/contact.js`
- Modify: `src/lib/permissions.js`, `src/pages/dashboard/index.js`, `src/pages/dashboard/sidebar.js`

**Interfaces:**
- Consumes: Task 2's edits to the same three files.
- Produces: no `contact` key in `MATRIX`, no `contact` entry in `navMap`.

- [ ] **Step 1: Find every reference**

```bash
grep -rn "contact" src --include=*.js | grep -vi "contact us page is gone"
```

Note each hit. Some are unrelated (a member's contact number) — only remove the ones referring to the support form: the `contact` permission key, the `contact` nav item, and the dynamic import of `contact.js`.

- [ ] **Step 2: Delete the page**

```bash
git rm src/pages/dashboard/contact.js
```

- [ ] **Step 3: Remove the permission key and nav entry**

In `src/lib/permissions.js`, delete `contact: true,` from both the `owner` and `staff` blocks, and delete from `navMap`:

```js
    { id: 'contact',         perm: 'contact' },
```

In `src/pages/dashboard/index.js` and `sidebar.js`, remove the `contact` section, its `import()`, and its nav item.

- [ ] **Step 4: Verify**

```bash
npm run build
npx playwright test tests/removed-routes.spec.js
```

Expected: build succeeds; `/dashboard/contact` renders without a JS error.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove dashboard Contact Us support form"
```

---

### Task 4: Remove the subscription tier gate

**Files:**
- Delete: `src/lib/tiers.js`
- Modify: `src/pages/dashboard/index.js:11,353,418`, `src/pages/dashboard/overview.js:4,120,203`, `src/pages/dashboard/sidebar.js:6,82,118,162,163`, `src/pages/dashboard/staff.js:15,184`

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces: no module imports `tiers.js`. `S.tier` is no longer read anywhere. Analytics and staff logins are unconditionally available to `owner`.

- [ ] **Step 1: List every call site**

```bash
grep -rn "hasFeature\|hasAnyFeature\|getProFeatures\|S.tier\|subscription_tier\|FLYM PRO\|FLYM CORE" src --include=*.js
```

Expected: 12 hits across the four files named above plus `src/lib/tiers.js` itself.

- [ ] **Step 2: Unwind each call site**

Every gate has the same shape — a feature is hidden unless the tier is `pro`. Removing the gate means keeping the feature and dropping the condition:

- `dashboard/index.js:353` — `if (tierKey && !hasFeature(tier, tierKey)) { ...block... }` → delete the whole `if` block, so no section is ever blocked.
- `dashboard/index.js:418` — `if (tk && !hasFeature(tier, tk)) return false;` → delete the line.
- `overview.js:120` — `${hasFeature(S.tier, 'analytics') ? \`<div ...>\` : ''}` → keep the truthy branch unconditionally, drop the ternary.
- `overview.js:203` — `if (hasFeature(S.tier, 'analytics')) { ...body... }` → unwrap, keep the body.
- `sidebar.js:118` — `if (tierFeature && !hasFeature(tier, tierFeature)) return false;` → delete the line, and delete the now-unused `tierFeature` variable and any `tierFeature:` properties in the nav item definitions.
- `staff.js:184` — `const isPro = hasFeature(S.tier || 'core', 'staff_login');` → `const isPro = true;` on this step, then remove `isPro` and its branches entirely in the same edit, keeping the Pro branch.

Delete the `import { hasFeature } ...` line from all four files, and the `const tier = S.tier || 'core';` lines at `index.js:322`, `index.js:407`, `sidebar.js:82`.

- [ ] **Step 3: Replace the tier badge**

`sidebar.js:162-163` renders a `FLYM PRO` / `FLYM CORE` badge. Delete the badge entirely — the `tierLabel` and `tierBadge` variables and the markup that uses them. A single-tenant app has no plan to advertise.

- [ ] **Step 4: Delete the module and confirm no references remain**

```bash
git rm src/lib/tiers.js
grep -rn "tiers.js\|hasFeature\|S.tier" src --include=*.js
```

Expected: zero matches.

- [ ] **Step 5: Verify**

```bash
npm run lint
npm run build
npx playwright test
```

Expected: build succeeds. `npm run lint` may report pre-existing unused-variable errors (there were 13 before this work started); it must not report *new* ones in the four files you edited.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove Pro/Core subscription tier gating, keep owner/staff permissions"
```

---

### Task 5: Redirect dead routes

**Files:**
- Modify: `src/pages/dashboard/index.js` (the section resolver, near `_navTo` / `sectionFromPath` handling)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: an unknown dashboard section falls back to `overview` rather than rendering an empty panel.

- [ ] **Step 1: Find the section resolver**

```bash
grep -n "sectionFromPath\|_navTo\|SECTIONS\|function nav" src/pages/dashboard/index.js
```

Read the function that maps a section id to a render call.

- [ ] **Step 2: Add the fallback**

In that resolver, before dispatching, coerce an unrecognised section to `overview`:

```js
  // A section that no longer exists (broadcast, contact — removed during the
  // white-label build) must not render an empty panel. Old bookmarks and
  // browser-restored tabs will still ask for them.
  if (!SECTION_RENDERERS[section]) section = 'overview';
```

Use whatever the real lookup object is called — read the file rather than assuming the name above.

- [ ] **Step 3: Verify**

```bash
npm run build
npx playwright test tests/removed-routes.spec.js
```

Expected: PASS for all three removed routes.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: fall back to overview for removed dashboard sections"
```

**CHECKPOINT — Phase 1.** Report to Steven: what was deleted, line counts, and confirmation that Member Alerts, Finance, Staff, Members and Enquiries all still render.

---

## Phase 2 — Rebrand

### Task 6: Rebrand the app shell

**Files:**
- Modify: `index.html`, `public/manifest.json`, `public/sw.js`, `vite.config.js`, `package.json`, `public/robots.txt`, `public/sitemap.xml`, `public/unstick/index.html`

**Interfaces:**
- Consumes: Task 2's `tests/rebrand.spec.js`.
- Produces: service worker cache prefix `sculpt-`, localStorage theme key `sculpt-theme`, service worker message type `SCULPT_NOTIFICATION_CLICK`, modal overlay element id `sculpt-modal-overlay`.

- [ ] **Step 1: `package.json`**

```json
  "name": "d-sculpt-fitness",
  "description": "D Sculpt Fitness — gym management",
```

- [ ] **Step 2: `index.html` — titles and meta**

Replace the head content. Note that `canonical`, `og:url` and `og:image` currently point at `https://flym.in`. **Delete those three tags entirely** rather than inventing a Sculpt domain — a wrong canonical URL actively harms search ranking, and the real domain is unknown. They go on the handover checklist (Task 23).

```html
  <meta name="apple-mobile-web-app-title" content="D Sculpt Fitness">
  <title>D Sculpt Fitness — Gym in [PLACEHOLDER: CITY]</title>
  <meta name="description" content="D Sculpt Fitness — strength training, personal coaching and group classes. [PLACEHOLDER: one-line description from the client.]">
  <meta name="author" content="D Sculpt Fitness">
  <meta property="og:title" content="D Sculpt Fitness">
  <meta property="og:site_name" content="D Sculpt Fitness">
  <meta name="twitter:title" content="D Sculpt Fitness">
```

Update the JSON-LD block (lines ~52–68): `name` → `D Sculpt Fitness`, remove `alternateName`, remove `url` and the publisher `url`, and change `email` from `flym.system@gmail.com` to `[PLACEHOLDER: gym email]`. Change `@type` from a SoftwareApplication-style entry to `"@type": "HealthClub"` — this is a gym's site now, not a SaaS product's.

Change the favicon link to the generated icon from Task 8:

```html
  <link rel="icon" type="image/png" href="%BASE_URL%icon-48.png">
  <link rel="apple-touch-icon" href="%BASE_URL%apple-touch-icon.png">
```

- [ ] **Step 3: `index.html` — inline script keys**

Three storage keys and one element id are namespaced. Rename all of them:

| Old | New | Line |
|---|---|---|
| `localStorage.getItem('flym-theme')` | `'sculpt-theme'` | ~96 |
| `window.__flymTheme` | `window.__sculptTheme` | ~99 |
| `document.getElementById('flym-modal-overlay')` | `'sculpt-modal-overlay'` | ~133 |
| `sessionStorage 'flym-sw-reloading'` | `'sculpt-sw-reloading'` | ~166,168,175 |

`flym-modal-overlay` and `__flymTheme` are also referenced in `src/`. Rename there in the same commit:

```bash
grep -rn "flym-modal-overlay\|__flymTheme\|flym-theme" src
```

- [ ] **Step 4: `public/manifest.json`**

```json
{
  "name": "D Sculpt Fitness",
  "short_name": "D Sculpt",
  "description": "Member management for D Sculpt Fitness.",
  "id": "/",
  "scope": "/",
  "start_url": "/dashboard",
  "display": "standalone",
  "display_override": ["standalone", "minimal-ui"],
  "orientation": "portrait-primary",
  "background_color": "#050507",
  "theme_color": "#050507",
  "categories": ["business", "productivity"],
  "lang": "en-IN",
  "dir": "ltr",
  "prefer_related_applications": false,
  "icons": [
    { "src": "/icon-48.png",  "sizes": "48x48",   "type": "image/png", "purpose": "any" },
    { "src": "/icon-96.png",  "sizes": "96x96",   "type": "image/png", "purpose": "any" },
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Also update `<meta name="theme-color">` in `index.html` to `#050507`.

- [ ] **Step 5: `public/sw.js` — cache keys and push copy**

The cache version prefix must change so a future Sculpt deploy cannot collide with a Flym-flavoured cache on a shared origin:

| Line | Old | New |
|---|---|---|
| 1 | `// Flym Service Worker — v4` | `// D Sculpt Fitness Service Worker — v4` |
| 18 | `const CACHE_VERSION = 'flym-1781415943375';` | `const CACHE_VERSION = 'sculpt-1781415943375';` |
| 137 | `title: 'Flym'`, `tag: 'flym-notification'` | `title: 'D Sculpt Fitness'`, `tag: 'sculpt-notification'` |
| 152 | `payload.tag \|\| 'flym-notification'` | `'sculpt-notification'` |
| 170 | `payload.title \|\| 'Flym'` | `'D Sculpt Fitness'` |
| 189 | `type: 'FLYM_NOTIFICATION_CLICK'` | `'SCULPT_NOTIFICATION_CLICK'` |
| 214 | `type: 'FLYM_PUSH_RESUBSCRIBE'` | `'SCULPT_PUSH_RESUBSCRIBE'` |

`FLYM_NOTIFICATION_CLICK` is listened for in `src/pages/dashboard/index.js`. Rename both sides in this commit or the notification click handler silently stops working:

```bash
grep -rn "FLYM_NOTIFICATION_CLICK\|FLYM_PUSH_RESUBSCRIBE" src public
```

- [ ] **Step 6: `vite.config.js` — the SW stamping plugin**

Rename the plugin and its regex. **The regex must match the new cache prefix** or the stamp silently stops applying:

```js
      name: 'sculpt-sw-version',
```

```js
          sw = sw.replace(/'sculpt-\d+'/, `'sculpt-${ts}'`);
```

```js
          console.log(`✓ Service worker stamped with version sculpt-${ts}`);
```

```js
          console.warn('[sculpt-sw-version] Could not stamp sw.js:', e.message);
```

Update the two `base: '/'` explanatory comments (lines ~10, ~24) to say D Sculpt Fitness instead of Flym — **but do not change the `base` value itself.**

- [ ] **Step 7: `public/robots.txt`, `public/sitemap.xml`, `public/unstick/index.html`**

Remove `flym.in` URLs from robots and sitemap. Since the real domain is unknown, reduce `sitemap.xml` to just `/` and `/login` with no absolute host, or delete it and remove the `Sitemap:` line from `robots.txt`. Rebrand the visible copy in `unstick/index.html`.

- [ ] **Step 8: Verify the stamping actually still works**

```bash
npm run build
grep -n "CACHE_VERSION" dist/sw.js
```

Expected: `const CACHE_VERSION = 'sculpt-<a fresh 13-digit timestamp>';` — NOT the hardcoded `1781415943375`. If it still shows the old number, the regex in Step 6 does not match and the plugin silently failed.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: rebrand app shell, manifest, service worker and build config to D Sculpt Fitness"
```

---

### Task 7: Rebrand the application source

**Files:**
- Modify: every remaining file under `src/` containing `flym`, case-insensitive — roughly 30 files after Phase 1's deletions.

**Interfaces:**
- Consumes: Task 6's renamed keys.
- Produces: zero `flym` matches under `src/`, except where a rename would break a database call (those are handled in Task 18).

- [ ] **Step 1: Categorise every remaining hit**

```bash
grep -rn -i flym src | tee /tmp/flym-hits.txt
wc -l /tmp/flym-hits.txt
```

Sort each hit into one of four buckets before editing anything:

1. **User-facing copy** — page text, toasts, error messages, PDF headers, email copy. → `D Sculpt Fitness`.
2. **Console logs and comments** — `[Flym router]`, `[Flym Admin]`, header comments. → `D Sculpt Fitness` / `[sculpt router]`.
3. **Namespaced keys** — storage keys, element ids, CSS class prefixes, event names. → `sculpt-` prefix. **These must be renamed on both sides in the same commit.**
4. **Database identifiers** — `supabase.rpc('flym_add_member')`, `is_flym_admin`. → **LEAVE ALONE FOR NOW.** Task 18 renames these together with the SQL, so the client and database never disagree.

- [ ] **Step 2: Rebrand the invoice and print generators first**

These are the highest-stakes user-facing strings — they print on documents given to paying members.

```bash
grep -n -i flym src/lib/invoice-pdf.js src/lib/invoices.js src/components/print-preview.js src/pages/dashboard/attendance-report.js src/pages/dashboard/backup.js
```

Replace every occurrence of the Flym name in headers, footers and document titles with `D Sculpt Fitness`. **Do not tokenise the hardcoded hex colours in these files** — paper has no dark mode and those literals are correct.

- [ ] **Step 3: Rebrand the remaining source files**

Work through buckets 1–3. Because these are ordinary string replacements across many files, a scripted pass is acceptable — but review the diff file by file afterwards, because the word appears in comments describing *why* something exists, and some of those sentences need rewriting rather than substituting.

```bash
grep -rn -i flym src | grep -v "rpc(" | grep -v "is_flym_admin"
```

- [ ] **Step 4: Rebrand the CSS**

```bash
grep -rn -i flym src/styles/
```

These are class-name prefixes and comments. Rename the class prefix to `sculpt-` and update every usage in `src/`:

```bash
grep -rn "flym-" src --include=*.js
```

- [ ] **Step 5: Delete the Flym logo assets**

```bash
git rm -r src/assets/logos public/logos
grep -rn "assets/logos\|/logos/" src index.html public
```

Expected after removal: zero references. Any that remain will 404 — fix them to point at the Task 8 icons.

- [ ] **Step 6: Verify**

```bash
grep -rn -i flym src
```

Expected: only bucket-4 database identifiers remain (`flym_add_member`, `flym_renew_member`, `flym_clear_balance`, `flym_revenue_*`, `is_flym_admin`). Count them and record the number — Task 18 must reduce it to zero.

```bash
npm run build
npx playwright test
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: rebrand application source, invoices and print output to D Sculpt Fitness"
```

**CHECKPOINT — Phase 2.** Report the before/after `flym` match count and the list of database identifiers deliberately left for Task 18.

---

## Phase 3 — Brand system

### Task 8: Generate the icon set

**Files:**
- Create: `scripts/generate-icons.mjs`
- Create: `public/icon-48.png`, `public/icon-96.png`, `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`
- Delete: `public/favicon-48.png`, `public/favicon-192.png`

**Interfaces:**
- Consumes: `sculp-logo.png` in the repo root.
- Produces: the icon filenames referenced by `public/manifest.json` and `index.html` in Task 6.

- [ ] **Step 1: Write the generator**

No new dependency is allowed, and `@playwright/test` is already installed with a Chromium browser — so render the resize in the browser's canvas.

Create `scripts/generate-icons.mjs`:

```js
// scripts/generate-icons.mjs
//
// Generates the PWA icon set from sculp-logo.png.
//
// Why Playwright and not sharp: this project forbids adding npm dependencies,
// and @playwright/test is already installed with a Chromium binary. Canvas
// downscaling in Chromium is high quality and costs no new packages. This is
// a one-off build-asset script, not part of `npm run build`.
//
// Run:  node scripts/generate-icons.mjs

import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'sculp-logo.png';
const SIZES = [
  { size: 48,  out: 'public/icon-48.png' },
  { size: 96,  out: 'public/icon-96.png' },
  { size: 192, out: 'public/icon-192.png' },
  { size: 512, out: 'public/icon-512.png' },
  { size: 180, out: 'public/apple-touch-icon.png' },
];

// The logo is transparent-background artwork. PWA icons render against
// unpredictable launcher backgrounds, so composite onto the brand black
// rather than shipping transparency.
const BRAND_BLACK = '#050507';

const dataUri = 'data:image/png;base64,' + readFileSync(SOURCE).toString('base64');

const browser = await chromium.launch();
const page = await browser.newPage();

for (const { size, out } of SIZES) {
  const base64 = await page.evaluate(
    async ({ dataUri, size, bg }) => {
      const img = new Image();
      img.src = dataUri;
      await img.decode();

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size, size);

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // The artwork is square; draw it edge to edge with a small inset so the
      // outer chrome ring is not clipped by a launcher's circular mask.
      const inset = Math.round(size * 0.04);
      ctx.drawImage(img, inset, inset, size - inset * 2, size - inset * 2);

      return canvas.toDataURL('image/png').split(',')[1];
    },
    { dataUri, size, bg: BRAND_BLACK }
  );

  writeFileSync(out, Buffer.from(base64, 'base64'));
  console.log(`✓ ${out} (${size}×${size})`);
}

await browser.close();
```

- [ ] **Step 2: Run it**

```bash
node scripts/generate-icons.mjs
```

Expected: five `✓` lines, five files written.

- [ ] **Step 3: Look at the output**

Open `public/icon-48.png` and `public/icon-192.png` and actually look at them. The full logo is a circular badge with three concentric rings, a wordmark arc, a figure and two dumbbells. At 48px that will very likely be unreadable mush.

**If 48px is illegible,** hand-crop a simplified mark — the central blue figure alone, no rings, no wordmark — save it as `sculpt-mark.png` in the repo root, and add a second pass in the script that uses `sculpt-mark.png` for the 48 and 96 sizes while keeping the full badge for 192 and 512. Do not ship an icon you cannot read.

- [ ] **Step 4: Remove the old icons and verify nothing references them**

```bash
git rm public/favicon-48.png public/favicon-192.png
grep -rn "favicon-48\|favicon-192\|flym_favicon" src public index.html
```

Expected: zero matches.

- [ ] **Step 5: Verify in a real browser**

```bash
npm run build
npm run preview
```

Open `http://localhost:4173`, check the browser tab shows the Sculpt icon, then open DevTools → Application → Manifest and confirm the name is `D Sculpt Fitness` and all five icons resolve with no 404.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: generate D Sculpt Fitness PWA icon set from the client logo"
```

---

### Task 9: Rebuild the design tokens

**Files:**
- Modify: `src/styles/tokens.css`

**Interfaces:**
- Consumes: the palette in §3 of the spec.
- Produces: the same token *names* the rest of the CSS already uses, with new values. No token is renamed or removed — only revalued.

- [ ] **Step 1: Read the existing token file end to end**

```bash
cat src/styles/tokens.css
```

It is 103 lines and dual-theme with dark as default. Note every custom property name. **Do not rename any of them** — `components.css`, `dashboard.css` and ~2,000 inline styles consume these names, and renaming turns the whole app grey.

- [ ] **Step 2: Revalue the dark theme**

Map the existing roles onto the Sculpt palette:

| Role | New value |
|---|---|
| page background | `#050507` |
| surface / card | `#0E0F13` |
| raised surface | `#15171D` |
| border | `#22262F` |
| primary text | `#F2F4F8` |
| secondary text | `#C8CDD6` |
| muted text | `#8A929F` |
| accent / primary action | `#0A84FF` |
| accent hover | `#1E90FF` |
| accent contrast text | `#FFFFFF` |

Keep the existing semantic status colours (success / warning / danger) unless they clash — a gym dashboard still needs red to read as overdue. Verify the accent against the surface: `#0A84FF` on `#0E0F13` is roughly 5.6:1, which clears WCAG AA for text.

- [ ] **Step 3: Revalue the light theme block**

The file is dual-theme. Update the light values to the same brand family — white/near-white grounds, `#0A63C4` as the accent (the `#0A84FF` blue does not have enough contrast on white for text at 4.5:1). Even though dark is the default, the light block must not be left on Flym's palette.

- [ ] **Step 4: Verify visually at both themes**

```bash
npm run build
npm run preview
```

Open the login page. Toggle `data-theme` between `dark` and `light` in DevTools on the `<html>` element and confirm both are legible and neither shows a Flym colour. Check that focus rings are still visible against the new surfaces.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: rebuild design tokens around the D Sculpt Fitness palette"
```

**CHECKPOINT — Phase 3.** Send Steven screenshots of the login page and dashboard in the new palette, plus the generated icons at actual size.

---

## Phase 4 — Landing page

### Task 10: Rebuild the landing page

**Files:**
- Replace: `src/pages/landing.js` (currently 1,506 lines)
- Check: `src/pages/landing.html` — determine whether it is used; if it is dead, delete it
- Test: `tests/landing.spec.js` (create)

**Interfaces:**
- Consumes: `router` (the module exports `renderLanding(router)` — this signature must not change, `src/app.js` depends on it).
- Produces: `export function renderLanding(router)`, and a cleanup path matching the existing convention (the current file force-sets `data-theme="dark"` while mounted and restores it on cleanup — read how, and preserve the mechanism).

- [ ] **Step 1: Read the existing landing page before replacing it**

```bash
grep -n "export function\|window\.\|addEventListener\|data-theme" src/pages/landing.js
```

You are looking for: the exact export signature, every window global it registers (these must be in the cleanup array in `src/app.js`), and how it sets and restores the theme. The new page must honour the same contract.

- [ ] **Step 2: Invoke the UI/UX design skill**

This task is design-led, not mechanical. Use the `ui-ux-pro-max` skill to establish the layout, type scale and section rhythm before writing markup. The brief: a gym marketing page that feels physical and premium — heavy black, electric blue, large kinetic type — not a SaaS template.

- [ ] **Step 3: Write the failing test**

Create `tests/landing.spec.js`:

```js
// tests/landing.spec.js
//
// The landing page is the client's public shopfront. These tests check the
// two things most likely to break silently: that it renders at all after a
// rewrite, and that it does not overflow horizontally on a phone — which is
// how most of this gym's prospects will see it.

import { test, expect } from '@playwright/test';

const VIEWPORTS = [
  { name: 'mobile',  width: 390,  height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
];

for (const vp of VIEWPORTS) {
  test(`landing page renders with no horizontal overflow at ${vp.name}`, async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));

    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/', { waitUntil: 'load' });
    await expect(page.locator('#root')).not.toBeEmpty();

    expect(jsErrors, 'Uncaught JS error on the landing page').toEqual([]);

    // A page wider than its viewport is the single most common mobile defect
    // and is invisible in a desktop browser.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, 'The landing page scrolls horizontally').toBeLessThanOrEqual(1);
  });

  test(`landing page shows the brand and a login CTA at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/', { waitUntil: 'load' });

    await expect(page.getByText(/D Sculpt Fitness/i).first()).toBeVisible();

    // The page must offer a way into the app.
    const cta = page.getByRole('link', { name: /login|member login|sign in/i })
      .or(page.getByRole('button', { name: /login|member login|sign in/i }));
    await expect(cta.first()).toBeVisible();
  });
}

test('landing page contact links are real links, not a form', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('#root')).not.toBeEmpty();

  // The client explicitly does not want a contact form anywhere.
  expect(await page.locator('form').count(),
    'The landing page contains a <form>. Contact must be tel:/wa.me/mailto: links.'
  ).toBe(0);
});
```

- [ ] **Step 4: Run it to verify it fails**

```bash
npm run build
npx playwright test tests/landing.spec.js
```

Expected: FAIL on the brand assertion (the old page still says Flym).

- [ ] **Step 5: Write the new landing page**

Sections, in order: hero → why join (USPs) → programmes → location and contact → CTA into login.

Rules:

- Use the logo at `public/icon-512.png` in the hero.
- Every fact you do not have gets the literal marker `[PLACEHOLDER: …]` in the rendered copy, so it is impossible to ship by accident. Address, phone, WhatsApp number, email, opening hours, class names, trainer names, pricing and photos are all unknown.
- Contact is `tel:`, `https://wa.me/<number>` and `mailto:` links. **No `<form>` element anywhere on this page.**
- All interpolated text goes through `escHtml()` from `src/pages/dashboard/helpers.js`.
- Preserve the theme force-set/restore mechanism you found in Step 1.
- Keep the `renderLanding(router)` signature and register any window globals in `src/app.js`'s cleanup array.

- [ ] **Step 6: Run the test until it passes**

```bash
npm run build
npx playwright test tests/landing.spec.js
```

Expected: all five tests PASS.

- [ ] **Step 7: Look at it**

```bash
npm run preview
```

Screenshot at 390px and 1440px. Actually look at both. A passing overflow assertion does not mean the page is well-composed.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: rebuild the landing page for D Sculpt Fitness"
```

**CHECKPOINT — Phase 4.** Send Steven both screenshots and the list of every `[PLACEHOLDER: …]` marker that needs real content.

---

## Phase 5 — Backend

> **BLOCKED until Steven has created a Supabase account on his new email and run `npx supabase login`.** Confirm with `npx supabase projects list` before starting Task 11 — it must NOT list `flym-system`.

### Task 11: Create the project and wire up the environment

**Files:**
- Modify: `.env.local`
- Create: `supabase/.temp/` link to the new project

**Interfaces:**
- Produces: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the new project; a project ref used by every later task.

- [ ] **Step 1: Confirm the correct account is active**

```bash
npx supabase projects list
```

Expected: the new empty account. **If `flym-system` appears, STOP.** The wrong account is logged in and creating a project here would put the client's data in Flym's organisation.

- [ ] **Step 2: Create the project**

```bash
npx supabase projects create d-sculpt-fitness --region ap-south-1 --plan free
```

Region `ap-south-1` is Mumbai — closer to an Indian gym than Flym's Seoul. The CLI will prompt for a database password; generate a strong one and record it for Steven immediately, because it cannot be retrieved later.

- [ ] **Step 3: Capture the credentials**

```bash
npx supabase projects list
npx supabase projects api-keys --project-ref <NEW_REF>
```

- [ ] **Step 4: Write `.env.local`**

```
VITE_SUPABASE_URL=https://<NEW_REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<new anon key>
```

Drop `VITE_VAPID_PUBLIC_KEY` — Web Push stays undeployed. Also rewrite the file's header comment, which currently says "Flym Environment Variables".

- [ ] **Step 5: Verify the app points somewhere new**

```bash
npm run build
grep -c "ogxqspnqtjphprqzwuye" dist/assets/*.js
```

Expected: `0` — the Flym project ref must not appear anywhere in the built bundle.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: point the app at the new D Sculpt Fitness Supabase project"
```

---

### Task 12: Apply the existing migrations and record what fails

**Files:**
- Create: `docs/superpowers/notes/schema-audit.md`

**Interfaces:**
- Produces: a list of migrations that failed and a list of objects that did not materialise. Task 13 consumes both.

- [ ] **Step 1: Link the CLI to the new project**

```bash
npx supabase link --project-ref <NEW_REF>
```

- [ ] **Step 2: Remove migrations for deleted features before running anything**

`025_broadcast.sql`, `006_support_messages.sql`, `007_auto_reminders.sql` and `037_broadcast_resume_cron.sql` create objects for features that no longer exist. Do not apply them and then drop them — just do not apply them.

```bash
git rm supabase/migrations/025_broadcast.sql supabase/migrations/006_support_messages.sql supabase/migrations/007_auto_reminders.sql supabase/migrations/037_broadcast_resume_cron.sql
```

**Before deleting, grep each one for objects other features depend on.** `007_auto_reminders.sql` in particular may create `reminder_logs`, which `src/lib/members.js` writes to via `safeInsert()`:

```bash
grep -n "CREATE TABLE\|CREATE FUNCTION\|ALTER TABLE" supabase/migrations/006_support_messages.sql supabase/migrations/007_auto_reminders.sql supabase/migrations/025_broadcast.sql supabase/migrations/037_broadcast_resume_cron.sql
```

Anything still referenced by surviving code must be carried into `100_sculpt_baseline_gaps.sql` in Task 13. Record what you carry forward.

Also skip `034_scale_indexes.sql` — it uses `CREATE INDEX CONCURRENTLY`, which cannot run inside a transaction. `034b_scale_indexes_no_concurrent.sql` is its working replacement.

- [ ] **Step 3: Push the remaining migrations**

```bash
npx supabase db push
```

Record every error verbatim in `docs/superpowers/notes/schema-audit.md`. Errors are expected — this step is a measurement, not a success criterion.

- [ ] **Step 4: Dump what actually materialised**

```bash
npx supabase db dump --schema public > docs/superpowers/notes/actual-schema.sql
```

- [ ] **Step 5: Extract what the code actually queries**

```bash
grep -rhno "from('[a-z_]*'" src | sort -u
grep -rhno "rpc('[a-z_]*'" src | sort -u
```

Write both lists into `schema-audit.md`, then for each table go find the columns the code selects, inserts and updates. This is the authoritative requirement list — the migrations folder is not.

- [ ] **Step 6: Diff and record the gaps**

For every table and column in Step 5's list, confirm it exists in Step 4's dump. Write the missing ones into `schema-audit.md` under a heading `## Gaps to fix in migration 100`.

Flym's own notes say to expect at minimum: the `expenses` table, the `invoices` table, `gyms.gst_percentage`, `plans.is_featured`, and all storage buckets. Treat that as a floor, not the full list.

- [ ] **Step 7: Commit the audit**

```bash
git add -A
git commit -m "docs: audit the new database schema against what the code queries"
```

---

### Task 13: Write the gap migration

**Files:**
- Create: `supabase/migrations/100_sculpt_baseline_gaps.sql`

**Interfaces:**
- Consumes: the `## Gaps to fix in migration 100` list from Task 12.
- Produces: a schema where every table, column and RPC the client calls exists.

- [ ] **Step 1: Write the migration**

One `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` per gap. Rules from this codebase that apply:

- Helper functions are `SECURITY DEFINER` with `SET search_path = public` — **except** the money and revenue RPCs, which stay invoker-rights.
- Views use `WITH (security_invoker = true)`.
- A view selecting `m.*` must be `DROP`ped then `CREATE`d when a column is added; `CREATE OR REPLACE` fails on column position shifts.
- Plain `CREATE INDEX`, never `CONCURRENTLY` — the Supabase SQL editor wraps everything in a transaction.
- Every new table needs RLS enabled and a `gym_id`-scoped policy using `get_my_gym_id()`, matching the pattern in `001_initial_schema.sql`.
- No placeholders. If a value is needed, fill it in.

- [ ] **Step 2: Apply it**

```bash
npx supabase db push
```

- [ ] **Step 3: Re-verify against the code's requirement list**

```bash
npx supabase db dump --schema public > docs/superpowers/notes/actual-schema.sql
```

Re-check every table and column from Task 12 Step 5. Expected: zero remaining gaps. If any remain, extend migration 100 and repeat — do not proceed with a known gap.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(db): add tables and columns missing from the migration history"
```

---

### Task 14: Drop the removed features' database objects

**Files:**
- Create: `supabase/migrations/102_sculpt_drop_removed_features.sql`

- [ ] **Step 1: Confirm what actually exists to drop**

Some objects may never have been created, because Task 12 skipped their migrations. Check first:

```sql
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('broadcasts','broadcast_recipients','support_messages','reminder_logs');

select jobname from cron.job;
```

- [ ] **Step 2: Write the migration**

```sql
-- 102_sculpt_drop_removed_features.sql
--
-- The broadcast, support-ticket and automatic-reminder features were removed
-- during the D Sculpt Fitness white-label build. This drops their database
-- objects so the schema has no orphans.
--
-- IF NOT EXISTS / IF EXISTS throughout: some of these were never created,
-- because their migrations were not applied to this project at all.

drop table if exists public.broadcast_recipients cascade;
drop table if exists public.broadcasts          cascade;
drop table if exists public.support_messages    cascade;

alter table if exists public.gyms drop column if exists cost_per_msg_paise;

drop function if exists public.trigger_resume_broadcasts()  cascade;
drop function if exists public.get_due_reminders()          cascade;
drop function if exists public.record_reminder_sent(uuid, uuid, integer, text) cascade;
```

Check `record_reminder_sent`'s real argument types against the dump before writing that line — dropping a function requires the exact signature.

- [ ] **Step 3: Unschedule the cron jobs**

Cron jobs are rows, not schema, so they are not part of a migration's transaction semantics. Run separately:

```sql
select cron.unschedule('flym-resume-broadcasts');
select cron.unschedule('flym-cleanup-old-logs');
select cron.schedule('sculpt-cleanup-old-logs', '0 3 * * 0', $$select cleanup_old_logs()$$);
```

The cleanup job is kept — it prunes `activity_log` and is unrelated to broadcast. Only its name changes.

- [ ] **Step 4: Apply and verify**

```bash
npx supabase db push
```

Then re-run Step 1's queries. Expected: no broadcast/support tables, and `cron.job` lists only `sculpt-cleanup-old-logs`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): drop broadcast, support-message and auto-reminder objects"
```

---

### Task 15: Rename the flym_* database identifiers

**Files:**
- Create: `supabase/migrations/101_sculpt_rename_rpcs.sql`
- Modify: `src/lib/members.js` (the RPC call sites and `isMissingFunction()` usage)

**Interfaces:**
- Consumes: the bucket-4 list recorded in Task 7 Step 6.
- Produces: `sculpt_add_member`, `sculpt_renew_member`, `sculpt_clear_balance`, `sculpt_revenue_summary`, `sculpt_revenue_monthly`, `sculpt_revenue_rows`. Client and database renamed in the same commit.

- [ ] **Step 1: Write the rename migration**

`ALTER FUNCTION ... RENAME TO` preserves the body exactly, which is the entire point — the transaction boundaries, the `SELECT ... FOR UPDATE` in the clear-balance function, and the invoker-rights setting all survive untouched.

```sql
-- 101_sculpt_rename_rpcs.sql
--
-- Renames the money and revenue RPCs off the Flym name.
--
-- ALTER FUNCTION ... RENAME TO changes ONLY the identifier. The body, the
-- transaction boundary, the SELECT ... FOR UPDATE row lock in clear_balance,
-- and the deliberate absence of SECURITY DEFINER are all preserved. That is
-- why this is a rename and not a drop-and-recreate.

alter function public.flym_add_member    rename to sculpt_add_member;
alter function public.flym_renew_member  rename to sculpt_renew_member;
alter function public.flym_clear_balance rename to sculpt_clear_balance;

alter function public.flym_revenue_summary rename to sculpt_revenue_summary;
alter function public.flym_revenue_monthly rename to sculpt_revenue_monthly;
alter function public.flym_revenue_rows    rename to sculpt_revenue_rows;
```

If any function is overloaded, `ALTER FUNCTION` needs the full argument list. Check first:

```sql
select p.proname, pg_get_function_identity_arguments(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'flym%';
```

- [ ] **Step 2: Drop the admin predicate**

`is_flym_admin()` supported the removed superadmin role. Check nothing still uses it before dropping — RLS policies may reference it:

```sql
select schemaname, tablename, policyname, qual::text
  from pg_policies
 where qual::text like '%is_flym_admin%' or with_check::text like '%is_flym_admin%';
```

Every policy that appears must be rewritten to drop the admin branch (keeping the `get_my_gym_id()` branch) **before** the function can be dropped. Add those `CREATE POLICY` statements to migration 101, then:

```sql
drop function if exists public.is_flym_admin();
```

- [ ] **Step 3: Apply it**

```bash
npx supabase db push
```

- [ ] **Step 4: Rename the client call sites**

```bash
grep -rn "flym_" src
```

Rename each `supabase.rpc('flym_…')` to its `sculpt_` counterpart. **Do not touch `isMissingFunction()`** — its `PGRST202` / `42883` fallback logic is unchanged and still correct.

- [ ] **Step 5: Verify no Flym identifier survives anywhere**

```bash
grep -rn -i flym src public index.html supabase
```

Expected: **zero matches**, except inside `docs/` and the historical `AUDIT.md` / `STATE.md` / `FLYM_PROJECT_INSTRUCTIONS.md`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(db): rename flym_* functions to sculpt_* and drop the admin predicate"
```

---

### Task 16: Create the storage buckets

**Files:**
- Create: `supabase/migrations/103_sculpt_storage_buckets.sql`

- [ ] **Step 1: Write the migration**

These are created by hand in Flym, which is exactly why they are missing from its repo. Scripting them makes this project reproducible.

```sql
-- 103_sculpt_storage_buckets.sql
--
-- Storage buckets. In Flym these were created by hand in the dashboard and
-- therefore existed in no migration — one of the reasons that repository
-- could not rebuild its own database. They are scripted here.

insert into storage.buckets (id, name, public)
values ('member-photos', 'member-photos', true),
       ('gym-logos',     'gym-logos',     true),
       ('aadhar-photos', 'aadhar-photos', false)
on conflict (id) do nothing;
```

`aadhar-photos` is **not public** — it holds government ID scans. `member-photos` and `gym-logos` are public because the app renders them by URL.

Then add RLS policies on `storage.objects` scoped by the `{gymId}/…` path prefix, matching how `src/pages/dashboard/photo.js` writes them:

```sql
create policy "gym members read own bucket objects"
  on storage.objects for select
  using (
    bucket_id in ('member-photos', 'gym-logos', 'aadhar-photos')
    and (storage.foldername(name))[1] = public.get_my_gym_id()::text
  );

create policy "gym members write own bucket objects"
  on storage.objects for insert
  with check (
    bucket_id in ('member-photos', 'gym-logos', 'aadhar-photos')
    and (storage.foldername(name))[1] = public.get_my_gym_id()::text
  );

create policy "gym members update own bucket objects"
  on storage.objects for update
  using (
    bucket_id in ('member-photos', 'gym-logos', 'aadhar-photos')
    and (storage.foldername(name))[1] = public.get_my_gym_id()::text
  );

create policy "gym members delete own bucket objects"
  on storage.objects for delete
  using (
    bucket_id in ('member-photos', 'gym-logos', 'aadhar-photos')
    and (storage.foldername(name))[1] = public.get_my_gym_id()::text
  );
```

Confirm the real upload paths before trusting the `foldername` index:

```bash
grep -n "upload\|from(" src/pages/dashboard/photo.js
```

- [ ] **Step 2: Apply and verify**

```bash
npx supabase db push
```

Then in the Supabase dashboard, Storage → confirm three buckets exist with the expected public flags.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(db): script the storage buckets and their access policies"
```

---

### Task 17: Bootstrap the gym and owner account

**Files:**
- Create: `supabase/seed/bootstrap_gym.sql`

**Interfaces:**
- Produces: one `gyms` row and one `owner` auth user, which Task 19's end-to-end login test uses.

- [ ] **Step 1: Create the auth user**

The admin panel that used to do this is gone, so the user is created directly. In the Supabase dashboard: Authentication → Users → Add user, with "Auto Confirm User" checked. Record the resulting user UUID.

Use a real email Steven controls and a strong generated password. Record both for handover.

- [ ] **Step 2: Write the seed**

```sql
-- supabase/seed/bootstrap_gym.sql
--
-- One-off bootstrap. Flym created gyms through its superadmin panel, which
-- this build removes, so the first gym and its owner are inserted directly.
-- Run ONCE, in the Supabase SQL editor.
--
-- Replace <OWNER_USER_ID> with the UUID from Authentication -> Users.

insert into public.gyms (gym_code, name, owner_name, phone, city, address, email, is_active)
values ('SCULPT01', 'D Sculpt Fitness', '[PLACEHOLDER: owner name]',
        null, null, null, null, true)
returning id;
```

Then link the auth user to the gym with the owner role, using whatever table `001_initial_schema.sql` defines for that (read it — it may be `gym_users`, `profiles`, or a column on `gyms`):

```bash
grep -n "role\|owner\|auth.users\|user_id" supabase/migrations/001_initial_schema.sql | head -40
```

Write the matching `insert` and put the real gym id and user id in — **no placeholders in SQL Steven will paste and run.** He has run a migration with an unreplaced placeholder before.

- [ ] **Step 3: Apply and verify the login works**

```bash
npm run build
npm run preview
```

Log in at `http://localhost:4173/login` with the owner credentials. Expected: the dashboard loads, the gym name shows, and Members renders an empty state rather than an error.

- [ ] **Step 4: Commit**

```bash
git add supabase/seed/
git commit -m "feat(db): bootstrap the D Sculpt Fitness gym and owner account"
```

---

### Task 18: Deploy the surviving edge function

- [ ] **Step 1: Confirm what is left**

```bash
ls supabase/functions
```

Expected: `create-staff-user`, `send-push`, `generate-notifications` only.

- [ ] **Step 2: Check its entrypoint is `index.ts`**

```bash
ls supabase/functions/create-staff-user/
```

The Supabase CLI accepts no other filename. Two functions in Flym were undeployable for months because of exactly this.

- [ ] **Step 3: Rebrand the function source**

```bash
grep -rn -i flym supabase/functions/
```

Fix any remaining strings, including the "Pro-only" tier check inside `create-staff-user` — there is no tier any more, so that guard must go while the `owner`-role guard stays.

- [ ] **Step 4: Deploy**

```bash
npx supabase functions deploy create-staff-user --project-ref <NEW_REF>
```

`WARNING: Docker is not running` is harmless — the CLI builds server-side. The success signal is `Deployed Functions on project <ref>`, not the absence of warnings.

`send-push` and `generate-notifications` stay undeployed, matching Flym.

- [ ] **Step 5: Verify from the app**

Log in as owner → Staff → create a staff login. Expected: it succeeds. If it fails, read the JSON error out of `error.context` — supabase-js buries it there and every failure looks identical otherwise.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: deploy create-staff-user to the new project"
```

**CHECKPOINT — Phase 5.** Report to Steven: the project ref, the dashboard URL, the owner login, the database password, and confirmation that login works end to end.

---

## Phase 6 — Verification

### Task 19: Full verification sweep

**Files:**
- Create: `tests/auth-flow.spec.js`

- [ ] **Step 1: Write the end-to-end login test**

```js
// tests/auth-flow.spec.js
//
// The one test that proves the whole stack is wired together: the built
// frontend, the new Supabase project, and the seeded owner account.
//
// Credentials come from the environment so they are never committed.
// Run with:  SCULPT_TEST_EMAIL=... SCULPT_TEST_PASSWORD=... npx playwright test

import { test, expect } from '@playwright/test';

const EMAIL = process.env.SCULPT_TEST_EMAIL;
const PASSWORD = process.env.SCULPT_TEST_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'SCULPT_TEST_EMAIL / SCULPT_TEST_PASSWORD not set');

test('owner can log in and reach the dashboard', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'load' });

  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /log ?in|sign ?in/i }).click();

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  await expect(page.locator('#root')).not.toBeEmpty();
});

test('no superadmin route is reachable once logged in', async ({ page }) => {
  await page.goto('/login', { waitUntil: 'load' });
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /log ?in|sign ?in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

  await page.goto('/admin', { waitUntil: 'load' });
  const bodyText = await page.locator('body').innerText();
  expect(bodyText.toLowerCase()).not.toContain('all gyms');
  expect(bodyText.toLowerCase()).not.toContain('superadmin');
});
```

Adjust the selectors to match the real login form — read `src/pages/login.js` for the actual labels and button text rather than guessing.

- [ ] **Step 2: Run the whole suite**

```bash
npm run build
npx playwright test
```

Expected: every spec passes — `build-integrity`, `rebrand`, `removed-routes`, `landing`, `auth-flow`.

- [ ] **Step 3: The deep-refresh check, by hand**

```bash
npm run preview
```

Hard-refresh (Ctrl+Shift+R) each of `/dashboard/finance`, `/dashboard/members`, `/dashboard/staff`. Expected: the page renders. A blank page means `base` regressed.

- [ ] **Step 4: Check the bundle has not ballooned**

```bash
npm run build
```

Read the size table Vite prints. The entry chunk should still be roughly 15 kB, and `vendor-pdf` (~935 kB) must be a separate chunk. Removing ~3,100 lines of code in Phase 1 means totals should have gone *down*; an increase means something dynamic became static.

- [ ] **Step 5: Manually exercise Member Alerts**

Log in, add one test member with a phone number, go to Member Alerts, and click both the call and WhatsApp buttons. Expected: `tel:` and `wa.me` links open correctly. This is the client's core manual-reminder workflow and the one thing broadcast removal could plausibly have broken.

- [ ] **Step 6: Final grep**

```bash
grep -rn -i flym src public index.html supabase package.json vite.config.js
```

Expected: **zero matches.**

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: add end-to-end auth flow verification"
```

---

## Phase 7 — Polish and handover

### Task 20: Impeccable pass and handover document

**Files:**
- Create: `HANDOVER-SCULPT.md`
- Delete: `FLYM_PROJECT_INSTRUCTIONS.md`, `STATE.md`, `AUDIT.md`, `SETUP.txt`, `README.md` (replace)

- [ ] **Step 1: Run the Impeccable audit**

Invoke the `impeccable` skill across the landing page, login, and every dashboard section. Record what was checked and what was changed — an assertion that it was audited is not the deliverable.

- [ ] **Step 2: Collect every placeholder**

```bash
grep -rn "PLACEHOLDER" src index.html supabase
```

Every hit becomes a line item in the handover checklist.

- [ ] **Step 3: Write `HANDOVER-SCULPT.md`**

It must contain: the deploy procedure (build locally, upload `dist/`), the Supabase project ref and dashboard URL, the owner login, the database password, the list of content the client still owes (address, phone, WhatsApp, email, hours, programmes, photos, domain), and the constraints from this plan's Global Constraints section that a future developer must not break.

- [ ] **Step 4: Replace the Flym documentation**

`FLYM_PROJECT_INSTRUCTIONS.md`, `STATE.md` and `AUDIT.md` describe a different product with live paying customers and a different database. Shipping them to this client is both confusing and a disclosure of another client's operational detail.

**Before deleting, port forward anything still true:** the codebase rules, the overlay rules, the money-operations rules and the PowerShell notes are all still valid and belong in `HANDOVER-SCULPT.md`.

```bash
git rm FLYM_PROJECT_INSTRUCTIONS.md STATE.md AUDIT.md SETUP.txt
```

Rewrite `README.md` for D Sculpt Fitness.

- [ ] **Step 5: Final full verification**

```bash
npm run build
npx playwright test
grep -rn -i flym . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=docs
```

Expected: build clean, all tests pass, zero `flym` matches.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: D Sculpt Fitness handover, replacing Flym project documentation"
```

**CHECKPOINT — Phase 7.** Final report: what was checked in the Impeccable pass, what was fixed, and the outstanding content checklist.

---

## Self-Review

**Spec coverage.** §3 brand → Tasks 8–9. §4.1 superadmin → Task 1. §4.2 broadcast/Razorpay → Task 2. §4.3 reminders → Tasks 2, 12, 14. §4.4 contact → Task 3. §4.5 tiers → Task 4. §4.6 dead routes → Task 5. §5.1 project → Task 11. §5.2 untrusted migrations → Tasks 12–13. §5.3 multi-tenant plumbing → untouched by design. §5.4 renaming → Tasks 6, 7, 15. §5.5 buckets → Task 16. §5.6 seeding → Task 17. §5.7 functions → Task 18. §6 landing → Task 10. §7 verification → Task 19. §2 constraints → Global Constraints. No gaps.

**Naming consistency.** `sculpt` (with T) is the identifier prefix in every task. `D Sculpt Fitness` is the display string in every task. `sculp-logo.png` keeps its original filename because that is what is on disk. Cache prefix `sculpt-` appears identically in Task 6 Steps 5, 6 and 8, and the `vite.config.js` regex was checked against the new value rather than left matching `flym-`.

**Known ordering risk.** Task 7 leaves `flym_*` database identifiers in place deliberately, and Task 15 removes them. If Phase 5 is delayed, the repo sits with a handful of `flym_` strings in `src/lib/members.js`. That is intentional — renaming the client before the database exists would break every money operation.
