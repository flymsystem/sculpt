# CLAUDE.md

Working notes for AI agents on this codebase. Read this first, then
**[HANDOVER.md](HANDOVER.md) §6 "Things that will break it"** before changing
anything. [README.md](README.md) has the commands.

## What this is

A single-gym management app plus public website for D Sculpt Fitness.
Plain JavaScript + Vite, no framework. Supabase (Postgres, Auth, RLS) on the
back. Installable as a PWA.

There is **one gym**. Multi-tenant machinery, plan tiers, and a superadmin
panel were all deliberately removed — see HANDOVER §7 before you reintroduce
anything that looks like them. The owner/staff permission split is real
access control and stays.

## Layout and boundaries

```
src/app.js                routing; pages are lazy-imported on purpose
src/lib/                  database access + cross-cutting services
src/pages/landing.js      public website
src/pages/dashboard/      the app, one file per section
src/styles/tokens.css     every colour, font and spacing value
supabase/migrations/      applied in filename order, zero-padded
```

Import direction is `pages/ → lib/`, never the reverse. A module that needs
dashboard state or `helpers.js` belongs in `src/pages/dashboard/`, not
`src/lib/` — that is why `invoice-template.js` lives beside its helpers while
`invoice-pdf.js` (which needs neither) sits in `lib/`.

Dashboard modules share a mutable singleton `S` from
`src/pages/dashboard/state.js` (`S.gym`, `S.members`, `S.plans`, `S.role`, …).
Read from it; don't thread it through parameters.

## Conventions

- **Match the surrounding file.** This codebase writes long explanatory
  comments above non-obvious code, saying *why*, often citing the outage or
  bug that motivated it. Keep that voice; don't strip those comments.
- **Every user-typed string goes through `escHtml()`** before reaching the
  DOM. Member names are attacker-controlled.
- **Money and membership logic lives in Postgres functions**
  (`sculpt_add_member`, `sculpt_renew_member`, `sculpt_clear_balance`) and is
  atomic on purpose. Do not split them into steps or reimplement their
  arithmetic in JS.
- **Never widen a static import** into `landing.js`, `login.js`, or the PDF
  engine. Lazy loading is guarded by a test.
- Use `.is-open` classes, never the `hidden` attribute, on anything you also
  style with `display:`.

## Invoices and printable documents

`showPrintPreview(title, html, opts)` renders a complete HTML document inside
an app modal (iframe), never `window.open()` — on iOS standalone PWAs a second
window has no back affordance and traps the user.

The membership invoice lives in **`src/pages/dashboard/invoice-template.js`**
and has three consumers: the preview iframe, the browser print dialog, and the
PDF blob that gets uploaded and WhatsApp'd. Three constraints are load-bearing:

1. **The sheet width is 660px in three places that must agree** — `.page` in
   `invoice-template.js`, and both `container.style.width` and
   `html2canvas.windowWidth` in `src/lib/invoice-pdf.js`. html2pdf maps that
   width onto A4 portrait; a mismatch silently rescales the exported PDF while
   the on-screen preview still looks correct.
2. **Every CSS rule is scoped to `body.inv-doc` or `.page`.** The PDF path
   injects this markup with `innerHTML` into the *live app document*, and
   `innerHTML` keeps `<style>` blocks — a bare `body { }` rule here repaints
   the dashboard for the duration of the render.
3. **The A4 budget is 933px of content** (660 × 297/210). A single-plan
   invoice lands around 896px. Measure after any edit; a GST invoice with
   several add-ons legitimately runs to a controlled second page, which is why
   `break-inside: avoid` sits in the *base* stylesheet and not inside
   `@media print` — html2canvas renders in screen mode and never sees print
   rules.

Anything scoped to `@media screen and (max-width: …)` must stay **below**
660px, or it fires during PDF export. `invoice-pdf.js` also forces
`target.style.zoom = '1'` for the same reason.

Print behaviour, palette, and the fixture set used to verify all of this are
documented in the header comment of `invoice-template.js`.

## Design system

Manrope everywhere; Barlow Condensed for large marketing headlines only.
All colour, spacing and radius values come from `src/styles/tokens.css` —
don't hardcode hex values in components.

The dashboard's brand blue `#0A84FF` is tuned for a near-black UI and only
reaches ~3.1:1 on white. Printed or light-background surfaces use the
light-theme tone `#0A63C4` instead. Invoices carry a print-safe copy of the
palette as constants rather than importing tokens, because they render as a
standalone document with no access to the app's stylesheets.

## Verifying a change

```bash
npm run build                 # must succeed
npx playwright test           # 20 pass, 4 skip without credentials
npm run lint                  # 12 pre-existing errors; add none
node scripts/verify-schema.mjs
```

Hard-refresh a deep route such as `/dashboard/finance` against
`npm run preview` before shipping — that failure mode is silent.

For UI work, render the real thing and measure it rather than reasoning about
CSS. Printable documents can be checked with fixture HTML plus
`page.emulateMedia({ media: 'print' })`; the PDF path itself has to be
exercised through the app, because html2canvas behaves differently from the
browser's own print engine.

## Known non-issues — do not "fix"

- 12 ESLint unused-variable errors, all pre-existing and cosmetic.
- Sidebar animates `width` on purpose; the content margin animates in lockstep.
- Old migration files still name the previous product (`is_flym_admin`). They
  are the record of what already ran. The live database uses `sculpt_*`.
- Deleting sets `is_active = false` everywhere except expenses, which really
  are deleted.

## Environment

Windows, PowerShell. `&&` chaining and `$(...)` are bash syntax and fail;
`curl` is not real curl (use `curl.exe`). A Bash tool is also available and
takes normal POSIX syntax.
