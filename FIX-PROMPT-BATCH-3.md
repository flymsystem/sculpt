# D Sculpt Fitness — Batch 3: full fix + landing content pass

You are working on the **D Sculpt Fitness** app in this repo (plain JS + Vite + Supabase, no framework).

## RUN MODE — UNATTENDED, AUTONOMOUS

I am starting this and going to sleep. **Nobody will answer you.**

- **Do not stop to ask permission. Do not wait for approval at any point.** Work straight through every phase, A to F, to completion.
- Where something is ambiguous, **make the best call yourself**, write down the assumption and why, and keep going. Never block on a question.
- `npx supabase login` is connected on this machine, so you have **direct database access**. Apply your migrations yourself (`npx supabase db push`), verify the result against the live database (`npx supabase db query --linked`, and read live function bodies with `pg_get_functiondef` rather than trusting the migration files), and fix anything that fails — do not just write migration files and stop.
- Destructive DB operations are the one exception: never drop or truncate a table, and never delete rows outside a scoped, reversible fix. Soft-delete stays soft-delete. Take a backup before any data migration and say where it is.
- Commit after each phase with a clear message. **Push to `sculpt-whitelabel` at the very end only if** `npm run build`, `npm run lint` (no new errors) and the Playwright suite all pass — if anything fails, leave the commits local and say so in the status file. A push auto-deploys to production.
- Keep going until every phase is genuinely finished. If one item hits a wall, record it and move to the next — never abandon the run.

### Status file — REQUIRED

Create and maintain **`STATUS-BATCH-3.md`** in the repo root, updating it **as you finish each item** (not only at the end, so it survives a crash or timeout). It must contain:

1. **Run header** — start time, end time, branch, commits made, whether it was pushed, and every migration (file name · applied yes/no · verified yes/no).
2. **DONE** — one row per item: `item ID → root cause in one line → files changed → migration → how it was verified (query / test / screenshot)`.
3. **PENDING / NOT DONE** — every item you could not finish, why, how far you got, and exactly what is needed to finish it.
4. **ASSUMPTIONS I MADE** — every ambiguous call you decided yourself, with the reasoning, so I can overrule any of them.
5. **NEEDS STEVEN** — things only I can supply (GSTIN, PAN, legal entity name, a physical iPhone test, a photo you couldn't source).
6. **CHECKS** — final output of `npm run build`, `npm run lint`, `npx playwright test`, `node scripts/verify-schema.mjs`, and the qa-* scripts.

Write it in plain, complete sentences. I will attach this file to Claude in the desktop app to pick up where you left off, so it must make sense with no other context.

## Step 0 — orientation (do this before writing a single line of code)

1. Read, in full, in this order: `CLAUDE.md`, `HANDOVER.md` (§6 "Things that will break it" especially), `README.md`, `FIX-PROMPT.md`, `VERIFY-PROMPT.md`, `TESTING-LIST.md`, `TESTING-BATCH-2.md`, `CHECKIN-PLAN.md`, `LANDING-CONTENT-CHECKLIST.md`, `supabase/migrations/README.md`. Do not skip any of them.
2. Then map the code you are about to touch — at minimum `src/app.js`, `src/pages/landing.js`, `src/pages/member/*`, `src/pages/dashboard/{index,overview,members,member-modals,enquiries,finance,alerts,staff,backup,checkin-display,checkin-scan,sidebar,settings,helpers}.js`, `src/components/photo-picker.js`, `src/lib/{members,checkin,member-auth,qr}.js`, and `src/styles/*.css`.
3. **Use the installed skills**: engage `superpower` for the multi-phase engineering work, and the `ui ux pro max` skill for every visual/interaction item below (mobile menu, dashboard, tables, modals, member portal, landing page). Use subagents to explore in parallel where it saves time, but one agent owns each phase's edits.
4. Write your plan (phases, files, migrations, risks) into `STATUS-BATCH-3.md`, then **start immediately** — do not wait for me to review it.

## Ground rules (non-negotiable)

- Fix **root causes**, not symptoms. Locate the real module / query / RLS policy before changing anything. Never guess a path.
- Every DB change = a **new, idempotent migration** under `supabase/migrations/`, zero-padded, next number in sequence. Never edit an applied migration. **Apply it yourself against the live database and verify it actually took effect**, then record it in the status file. Follow `CLAUDE.md`'s rules on `RETURNS TABLE` shadowing, gym-timezone date math, check-in RPCs returning status (never RAISE), and the `get_my_gym_id_as_staff()` funnel.
- Respect the architecture: import direction `pages/ → lib/` only; the mutable singleton `S` in `dashboard/state.js`; `.is-open` classes never the `hidden` attribute; every user-typed string through `escHtml()`; no widening of static imports into `landing.js`, `login.js` or the PDF engine (a test guards it); all colours/spacing from `src/styles/tokens.css`.
- Keep the long "why" comments in this codebase's voice; add one for every non-obvious fix.
- After each item: state **file(s) changed → root cause in one line → how you verified it**.
- Add or update a Playwright test in `tests/` for every functional fix that can be covered by one.
- Work in phases; commit after each phase with a clear message; push only under the condition in RUN MODE above.
- If a fix is ambiguous or would change a business rule, **decide it yourself, record it under ASSUMPTIONS I MADE in `STATUS-BATCH-3.md`, and continue.** Do not stop and ask.

---

## Phase A — Blocking bugs (do these first)

**A1. Member photo does not persist.** Upload a member photo, save, navigate away, come back — the photo is gone. This is the highest-priority bug. Trace the whole chain: `src/components/photo-picker.js` → `src/pages/dashboard/photo.js` → `member-modals.js` save path → the storage bucket + its RLS policies → the column the URL/path is written to → the read path that renders it. Verify as **owner and as staff** (storage RLS was previously broken for staff because `get_my_gym_id()` was NULL). Cover: upload during member creation, upload to an existing member, replace, remove (storage object actually deleted, no broken image left).

**A2. Expired-member scan glitches violently.** Scanning with an expired member's login makes the UI flash "Check in / name / Expired" repeatedly at high speed. `CLAUDE.md` documents the class of bug (the scanner must `stop()` on *every* terminal outcome, not only success) and claims it was fixed — it is not fixed for the expired/denied path. Re-audit `src/lib/qr.js`, `src/pages/member/index.js` and `src/pages/dashboard/checkin-scan.js`: guarantee a single in-flight check-in request, an idempotency/debounce guard so one physical scan can never fire two RPCs, and one terminal render. Add a test that simulates a denied (expired) scan and asserts exactly one RPC call and one stable UI state.

**A3. Hold-to-exit on the QR kiosk display is unreliable.** Works sometimes, not others. Fix `checkin-display.js` properly across **mouse, touch and pen** — use Pointer Events with `setPointerCapture`, handle `pointercancel`/`lostpointercapture`/`visibilitychange`/scroll-cancel, prevent the long-press context menu and text selection, and show a visible progress ring/bar for the 3-second hold. It must stay a 3-second hold (never a tap — HANDOVER §6) and must work on mobile, tablet and desktop. Test all three.

**A4. Backup/export filenames are all "d sculpt fitness".** In `src/pages/dashboard/backup.js`, every download from Data & Backup gets the same generic name. Give each export a specific, sortable filename: `dsculpt-<export-type>-<YYYY-MM-DD[-HHmm]>.<ext>` (e.g. `dsculpt-members-2026-08-26.csv`, `dsculpt-full-backup-2026-08-26-1039.json`). Derive the type from the actual option clicked; verify each one downloads with the right name and the right extension.

---

## Phase B — Member portal & member login

**B1.** The "Visits" bottom-nav item is covered by the floating **+** button (see screenshot: member portal → Visits tab, the blue FAB sits on top of the nav item). Remove or reposition the FAB in the member portal — a member has no "add" action; if it is the check-in shortcut, move it and make its purpose explicit. Guarantee it never overlaps the bottom nav on any viewport, including with iOS safe-area insets.

**B2.** An "add members" **+** button is appearing inside the member login / member portal where it does not belong. Find where the dashboard FAB is leaking into member routes and scope it to the dashboard only.

**B3.** Audit the whole member portal at 360/390/414/768px: no overlap, no double scrollbars, nothing under the notch or the home indicator.

---

## Phase C — Dashboard UI/UX (use the `ui ux pro max` skill)

**C1. Mobile menu / sidebar** (`sidebar.js` + CSS)
- Menu is visually oversized and eats almost the whole viewport — reduce to a sensible sheet/drawer with proper type scale.
- Separate primary navigation from account actions; group **Member Login** and **Staff & Owner Login** as account actions.
- Hamburger transforms into a clear **X** close state.
- Body scroll fully locked while open (and restored, with scroll position, on close).
- Closes on: navigation, outside click, `Escape`, and browser back where applicable.
- Menu must not visually cover the destination section during anchor navigation.
- Add a visible **active state** to navigation.

**C2. Dashboard overview** (`overview.js` / `index.js`)
- KPI cards become clickable (each drills into the filtered view it summarises).
- Explicit period labels on every card ("This month", "1–26 Aug 2026").
- Consistent number formatting everywhere (Indian grouping, one rounding rule).
- Tooltip explaining what each percentage compares against.
- Alert banner links directly to the filtered members list.
- Remove the generic floating **+** if it only duplicates existing Add buttons; keep it only if it opens a genuinely useful global quick-action menu.

**C3. All Members** (`members.js`)
- Too many action icons per row: keep only the most common actions visible, consolidate the rest into a **⋯** overflow menu.
- Every icon-only action gets a tooltip and an accessible label (`aria-label`).
- Sticky table header; sticky actions column.
- Proper mobile/tablet transformation (cards, not a squeezed table).
- Clear empty state and a clear "showing X of Y" filtered-results count.
- Add pagination (or virtualised scroll) for scale.
- Keep: search, status filter, plan filter, date filter, added-by filter, bulk selection.
- On mobile, the menu and the member rows/cards are far too large — bring the type and spacing back to the token scale.

**C4. Member details modal** (`member-modals.js`)
- Close + Cancel are redundant — remove one.
- Fix footer action hierarchy: primary = **Renew** / **Invoice**; secondary = **Edit** / **Remind**; destructive = **Deactivate**.
- Sticky modal footer; member identity stays visible while scrolling; section navigation for long records.
- Payment history must show date, amount, mode, invoice/receipt.
- **Send Login** must state exactly what is being sent and through which channel.
- Remove any action that duplicates the row actions without adding value.

**C5. Enquiries** (`enquiries.js`) — the layout is broken on mobile (see screenshot: the source label "Google Maps" / "Instagram" wraps one word per line, the phone number is overlapped by the action buttons, timestamps wrap mid-value, the action button row collides with the contact line). Rebuild the enquiry card: no overlapping elements, no mid-value wrapping, action buttons on their own row with labels or tooltips, consistent status chips, and a sane card layout from 320px up.

**C6. Support section not showing.** In the sidebar (see screenshot) there is a **SUPPORT** heading with nothing under it. Either populate it with the real support actions (contact / help / version / report a problem) or remove the empty heading. No empty section headings anywhere.

**C7. Staff attendance** (`staff.js`) — the page can sit forever on "Loading attendance…" with a large empty area. Never leave a page indefinitely loading: add a skeleton, a timeout + error state, a retry action, an empty state when there are no records, keep **Save Attendance** disabled until data loads, and render the staff list while loading where possible.

**C8. Member alerts** (`alerts.js`)
- **Invoice** on an expired member with ₹0 outstanding is not a valid primary action — change it to **View / Details** and move Invoice into secondary actions.
- "2 callable" must explain why only 2 of 3 are callable; a member with no phone shows an explicit **No phone** status.
- Sorting by expiry urgency, amount due, days overdue.
- Show the exact due amount and the last reminder date; prevent accidental repeated reminders (cooldown + confirm).
- Keep: Expired, Expiring, Payment Due, Renew, Remind.

**C9. Finance** (`finance.js`)
- "This Month" is selected but the chart shows multiple months. Either relabel it **Recent 6 months** or make the chart honour the selected period — pick one and make label and data agree.
- Use Indian financial-year terminology: replace vague "This Year" with explicit **FY 2026–27** / **FY 2025–26**, or label calendar-year reports clearly as such.
- Period labels on the revenue / expense / profit cards.
- A "574% growth" figure needs a meaningful comparison: show the comparison period and the exact calculation basis in a tooltip.
- Payment split must reconcile to the underlying transaction records — prove it with a query.
- Add an export button.

---

## Phase D — Year-end / audit report (`backup.js` + report generator)

The current PDF is **not audit-ready and not tax-filing-ready**. Two changes:

**D1. Stop marketing it as a tax-filing report.** Rename it throughout the UI and the document to **"Financial & GST Audit Support Report"**, with a clear "Prepared for audit review — not a tax filing" statement on the cover.

**D2. Make the Excel/CSV audit exports the primary deliverable**, with a download link behind every audit table in the PDF. Keep what is already good (clean layout, monthly summary, revenue, expenses, net profit, expense categories) and add:
- GST reconciliation; tax breakup; B2B/B2C split; SAC-wise data; place of supply; ITC information
- Invoice register; purchase/expense register
- Invoice sequence audit; cancelled invoices; credit/debit notes
- Payment reconciliation; outstanding balances
- Audit trail + supporting-document references
- Excel/CSV export for every one of the above

**D3. Fix the data problems in the current year-end PDF:**
- "42 members / 42 new members" needs verifying against a direct DB query — report the real numbers.
- It says "Financial Year 2026" while the data only covers July/August — it is a **YTD management report**, label it as such.
- Add: exact report period, GSTIN, PAN, legal entity / business name, registered address, accounting basis/method where relevant, and a reconciliation timestamp.
- Where GSTIN/PAN/legal name are not yet configured, add them as **Gym Settings** fields and render a visible "not supplied" state rather than inventing values — then tell me exactly what to enter.

---

## Phase E — Landing page: real content, real actions

Fill in the `GYM` object at the top of `src/pages/landing.js` with these real details (every "to be supplied" chip must disappear), and update `index.html`'s JSON-LD (address, telephone, opening hours) to match:

```
Phone:      +91 78921 31996   and   +91 88678 78946
WhatsApp:   +91 88678 78946
Email:      dsculptfitness5@gmail.com
Instagram:  https://www.instagram.com/d_sculptfitness?igsi=MWZnMmN3eXJmeXdjbA==
Address:    No.13, 20th Cross, Malagala, Nagarbhavi 2nd Stage, Bangalore - 560091
Maps:       https://maps.google.com/maps?q=12.974279403686523%2C77.51455688476562&z=17&hl=en
Hours:      Monday–Saturday 5:00 AM – 10:00 PM   ·   Sunday 7:00 AM – 12:00 PM
```

**E1.** Embed an actual **map** in the Contact section (lazy-loaded iframe or a static map image that links out to the Maps URL above — do not let it block LCP or leak into the hero's loading budget).
**E2.** **Contact us** must perform a real action immediately — call / WhatsApp / email — not navigate somewhere that then needs another click. WhatsApp deep-links to **8867878946** with a sensible prefilled message. Keep "View memberships" as it is; the hero headline and CTA hierarchy are already good.
**E3.** Footer gets real, clickable contact links (`tel:`, `https://wa.me/…`, `mailto:`, Instagram, Maps).
**E4.** Reduce the excessive vertical empty space between sections; keep section headings consistent; add a visible active state to nav.
**E5.** Remove: any unused decorative navigation, any empty contact placeholder, and any CTA that does not perform a real action.
**E6.** The mobile-menu requirements in **C1** apply to the landing page nav too — and remember `CLAUDE.md`'s `popstate` guard: anchor clicks must not tear down and rebuild the page or replay the intro animation.

---

## Phase F — Real photographs

I am putting the gym's real photos in a folder named **`PHOTOS`** at the repo root (`sculp-fitness/PHOTOS/`). Use them — the site currently ships stock photos from a Figma community template that are not licensed for us.

- Inspect what is in `PHOTOS/`, pick the best fit for each slot, and generate the optimised web assets into `public/img/`: `hero.jpg` (wide, full colour, the dominant shot), `about.jpg` (interior), and `train-1.jpg` … `train-4.jpg` (Strength & Conditioning, Personal Training, Group Classes, Cardio & Conditioning).
- Follow the existing pipeline in `scripts/prep-landing-images.mjs` — extend it to read from `PHOTOS/` rather than the Figma reference. Emit properly sized/compressed JPEGs (and WebP/AVIF with `<picture>` fallbacks if you can do it without breaking the hero's `fetchpriority`), with correct dimensions and `width`/`height` attributes to stop layout shift.
- Interior shots pick up the black-and-blue duotone treatment (`.sc-duo`) automatically; the hero stays full colour.
- Also produce a **1200×630 social share image** from the hero + logo for link previews, and wire up `og:image` (leave `canonical`/`og:url` alone until the domain exists — that omission is deliberate).
- Delete the stock template images once the real ones are in, and tell me which photo you used in which slot so I can swap any you got wrong.

---

## Finish with

1. `npm run build` (must succeed), `npm run lint` (12 pre-existing errors — add none), `npx playwright test` (report pass/skip vs. the previous run), `node scripts/verify-schema.mjs`, plus `node scripts/qa-responsive.mjs`, `node scripts/qa-nav.mjs` and `node scripts/qa-dashboard.mjs` against `npm run preview`.
2. Hard-refresh a deep route (`/dashboard/finance`) against `npm run preview` before declaring done — that failure mode is silent.
3. Real-device-width screenshots (375 / 390 / 768 / 1024 / 1440) of every screen you changed, before and after.
4. A summary table: **finding → root cause → files changed → migration → test covering it**.
5. A list of anything you could not fix or verify and exactly what you need from me.
6. **`STATUS-BATCH-3.md` complete and current** — this is the deliverable I read when I wake up. Put screenshots in a folder next to it and reference them from it.

Do not mark an item done because the code looks right. Prove it — a query, a test run, or a screenshot for every single item. And do not end the run early: work A → F, then the checks, then finalise the status file.
