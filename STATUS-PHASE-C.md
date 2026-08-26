# Phase C — Dashboard UI/UX — Status

Worktree: `C:\steven\sculp\sculp-fitness\.claude\worktrees\agent-ad5c6ce5941940248`
Branch: `worktree-agent-ad5c6ce5941940248`

No browser-automation tool with a live authenticated session was available for
this pass — the dashboard requires a real Supabase sign-in, and this worktree
has no `SCULPT_TEST_EMAIL` / `SCULPT_TEST_PASSWORD` / `.env` (the same
credential gap the repo's own Playwright suite skips 21 tests for). All C1-C9
changes below were made by reading the actual rendered markup/CSS for the
affected components, tracing state through to the DOM, and verifying with
`npm run build` + `npm run lint` + the existing Playwright suite after each
item — not by rendering the pages in a browser and looking at them. Where a
claim below depends on visual rendering I did not perform, that is noted
explicitly rather than asserted as verified.

## C1 — Mobile menu / sidebar
**Files:** `src/pages/dashboard/sidebar.js`, `src/pages/dashboard/index.js`, `src/styles/dashboard.css`

Root causes found and fixed:
- The mobile drawer had no scroll lock — `.app-content` (the actual scroll
  container, not `body`) stayed scrollable underneath the open overlay.
  Added `lockBodyScroll()`/`unlockBodyScroll()` which save/restore
  `.app-content.scrollTop` so the page doesn't snap to the top on close.
- No `Escape` handler existed for the drawer (only the overlay click).
- A browser-back landing on a different dashboard section calls
  `window._navTo()` directly (`app.js`'s popstate listener) — this bypasses
  `bindSidebar()`'s click handler entirely, so the open drawer was never
  told to close. Added a `closeMobileSidebar()` call inside `nav()`
  (`index.js`) itself.
- Drawer width/type scale were hand-picked px values (300px/82vw, 14px,
  10px) instead of `tokens.css` values; drawer now uses
  `min(260px, 76vw)` and `var(--text-md)`/`var(--text-xs)`/`var(--space-*)`.
- The sidebar's active-state highlighting (`.nav-item.active`) was already
  correct — `nav()` toggles it on every navigation (`index.js:281`); this
  was not actually broken, just re-verified by reading the code path.
- Hamburger→X was already implemented via `.hamburger-btn.open span:nth-
  child(n)` transforms; added `aria-expanded`/`aria-controls` for a11y.

**Not applicable / could not verify:** "group Member Login and Staff & Owner
Login as account actions" and "menu must not cover the destination section
during anchor navigation" — these concepts (Member Login / Staff & Owner
Login links, in-page anchor nav) exist only in `src/pages/landing.js`'s
mobile menu, which the task's Ground Rules explicitly forbid touching
(another agent owns it in parallel). Treated this as a prompt-writing
inconsistency and left `landing.js` untouched, per the explicit exclusion.

**Verified by:** `npm run build`, `npm run lint` (12 pre-existing errors,
none added), code trace of the popstate → `nav()` → `closeMobileSidebar()`
path. Not rendered in a browser.

## C2 — Dashboard overview
**Files:** `src/pages/dashboard/overview.js`, `src/pages/dashboard/helpers.js`, `src/styles/components.css`

- KPI cards, mini-stats, and the alert banner were **already** clickable /
  linked to filtered views (`bindScardClicks()`, `bindMiniStatClicks()`,
  the urgent-members banner's "View Alerts" button) — verified by reading
  the existing bindings, no change needed.
- Added explicit period chips (`.stat-card-period`) to every KPI card:
  "All time" (Total Members), "Right now" (Active, Payment Due), "Next N
  days" (Expiring Soon), and a computed `1-DD Mon YYYY` range for
  "This Month" mini-stats — via new `thisMonthLabel()` in `helpers.js`.
- Added `fmtNumber()` (en-IN grouped, unit-less) and applied it to every
  raw integer the page renders (KPI counts, mini-stat counts, activity
  count) — previously only currency went through `toLocaleString('en-IN')`.
- Added a `title` tooltip to each card's sub-line explaining the exact
  comparison basis (e.g. growth % states "New members 1-DD Mon (N) vs all
  of \<Month\> (M)").
- The floating **+** (`updateFAB`/`toggleFABMenu` in `index.js`) already
  opens a contextual menu (Add Member everywhere; Add Expense on the
  Expenses page) rather than being a static duplicate of a page button —
  left unchanged; this satisfies "keep only if it opens a genuinely useful
  global quick-action menu." Did not touch anything under `src/pages/member/*`.

**Verified by:** `npm run build`, `npm run lint`. Not rendered in a browser.

## C3 — All Members
**File:** `src/pages/dashboard/members.js`, `src/styles/dashboard.css`

- Root cause: each row rendered up to 8 icon buttons (Renew, Clear
  Balance, Cancel/Reactivate, WhatsApp, Invoice, Edit, Delete, "more") with
  no consolidation despite a `moreBtn` already existing (it just opened the
  detail modal, mobile-only). Kept WhatsApp reminder, Edit, and Renew (when
  applicable) as direct icons — the actions actually taken on a typical
  row — and moved Invoice, Clear Balance, Cancel/Reactivate, and Delete
  into a single per-row **⋯** overflow menu (`toggleOverflowMenu()`),
  recomputed from `S.members` per click rather than serialized into row
  markup.
- The overflow menu is appended to `<body>` and positioned via
  `getBoundingClientRect()` because `.members-table-scroll` has
  `overflow-x:auto`, which would otherwise clip an absolutely-positioned
  dropdown (same reasoning CLAUDE.md documents for topbar dropdowns).
  Closes on outside click, `Escape`, scroll, resize, and page navigation.
- Every icon action already had `title` + `aria-label` — re-verified, no
  change needed there.
- Table header and the Actions column are now `position:sticky` **within
  the table's own scroll container** (`.members-table-scroll`, which now
  also caps height at `min(72vh,720px)` so there's something to scroll),
  not page-level sticky.
- Search/status/plan/date/added-by filters, bulk selection, pagination,
  and both empty states ("no members yet" vs "no members match filters",
  with the exact "showing X of Y" count) were **already present** —
  verified unchanged.

**Not attempted:** a true mobile card layout (the item asks for "cards, not
a squeezed table"). The existing approach — `.hide-mobile` columns
collapsing the table to Member/Expiry/Status/Actions below 768px — was
left as-is; rebuilding this as genuine stacked cards is a larger, riskier
change than the rest of this item and was deprioritized given the number of
other C-items. Noted here as unfinished, not silently skipped.

**Verified by:** `npm run build`, `npm run lint`. Not rendered in a browser.

## C4 — Member details modal
**File:** `src/pages/dashboard/member-modals.js`, `src/styles/components.css`

- Root cause of the Close/Cancel redundancy: `openModal()` (`modal.js`)
  always renders a header ✕ close button; the footer additionally had its
  own "Close" button (`id="modal-cancel"`) that did the exact same thing.
  Removed the footer Close button — the header ✕ is now the only close
  affordance.
- Rebuilt the footer into three explicit tiers: **primary** (Renew,
  Invoice, and Clear Balance when a balance is actually due — all
  `btn-primary`/prominent), **secondary** (Edit, Remind — `btn-ghost`),
  **destructive** (Cancel/Reactivate Membership, Remove Member — visually
  separated by a top border, at the bottom).
- `.modal-footer` was only `position:sticky` inside the mobile media
  query in `components.css` — added the same rule to the base (desktop)
  selector, since `.modal` itself is the scroll container
  (`overflow-y:auto`), so a sticky footer relative to it works.
- Modal title changed from generic "Member Details" to `Member — <name>`
  so identity stays visible in the (already-sticky) header while the body
  scrolls.
- Added a sticky in-body section nav (Contact / Membership / Payment /
  History) that scrolls to and, for History, expands the target section.
- "Send Login" was ambiguous about channel — relabeled the trigger to
  "Send Login via WhatsApp" with a tooltip, and the confirmation modal
  (`openCredentialsWAModal`) now states up front, in a caption, exactly
  what's sent (app number + login link) and that it opens WhatsApp with
  the message pre-filled rather than sending anything automatically.
- Payment history already showed date/amount/mode; added a per-row
  invoice icon. `payment_history` has no persisted per-transaction invoice
  number in this schema (checked `supabase/migrations` — no `invoice_no`/
  `receipt_no` column anywhere), so the icon opens the member's *current*
  invoice, and a caption under the list says so explicitly rather than
  implying a historical receipt that doesn't exist.

**Kept minimal near the photo-picker area** per the Ground Rules — did not
touch any photo-upload call site in this file; all edits are in the
profile-header markup structure, the footer builder, and the payment
history block, none of which overlap the photo picker's DOM or handlers.

**Verified by:** `npm run build`, `npm run lint`. Not rendered in a browser.

## C5 — Enquiries
**File:** `src/pages/dashboard/enquiries.js`

Root cause: the enquiry row was a single horizontal `display:flex` container
holding the avatar, name, badges, contact line, and every action button, with
`flex-wrap:nowrap` on the action row and no wrap boundary between content and
actions — on a narrow phone the action buttons squeezed onto the same visual
line as the phone number (overlap), the two-word "Google Maps" source label
had no `white-space:nowrap` so it wrapped one word per line, and timestamps
had no nowrap guard either.

Rebuilt as a vertical card (`.enq-card`): a head row (avatar + name/status/
source), a meta row of `white-space:nowrap` chips (phone or an explicit "No
phone", time, followed-up), notes, then a separate action row
(`.enq-actions`) that is the only part allowed to `flex-wrap` — full rows of
its own, never over the content above. Every action button now carries both
a visible text label and a `title`/`aria-label` (labels matter more than
tooltips on touch, where tooltips don't exist); below 480px buttons stretch
to fill the row.

**Verified by:** `npm run build`, `npm run lint`. Not rendered in a browser
at the specified breakpoints (320-768px) — the CSS wrap boundaries were
verified by reading the rules, not by measuring a rendered page.

## C6 — Support section
**File:** `src/pages/dashboard/sidebar.js`

Root cause: `buildSidebar()` pushed a `<div class="nav-section-label">
Support</div>` heading and nothing else — confirmed by reading the function,
no nav item ever followed it. Added a "Help & Support" nav item that opens a
small modal (`openSupportModal()`, using the existing `openModal()`
component) with a support email, the gym's phone number if on file
(`S.gym.phone`), and the app version. `support` is not a routable dashboard
section, so `bindSidebar()`'s click handler special-cases it to open the
modal instead of calling `_nav('support')` (which would silently fall back
to Overview via `VALID_SECTIONS`).

**Verified by:** `npm run build`, `npm run lint`. Not rendered in a browser.

## C7 — Staff attendance
**File:** `src/pages/dashboard/staff.js`, `src/styles/global.css`

Root cause: `loadAttendance()` called `getAttendance()` and on failure only
did `console.error()` — the grid stayed on the literal string "Loading
attendance..." forever with no timeout, no error state, no retry, over a
mostly-empty area (confirmed by reading the function; there was no catch-path
UI update at all).

Fixed:
- `withTimeout()` wraps the fetch with a 10s timeout so a hung request
  surfaces as an error instead of spinning indefinitely.
- A visible error bar with a Retry button appears on failure (distinct
  message for a timeout vs. a normal fetch error).
- A real empty state ("No staff yet" with guidance) replaces blank text
  for the zero-staff case.
- The staff list now renders immediately as a skeleton
  (`attendanceSkeleton()`) — names/roles are already in `S.staff`, no
  fetch needed for those — with real status/check-in/check-out hydrated in
  once the attendance fetch resolves, instead of one loading line over an
  empty page.
- "Save Attendance" is `disabled` by default and only re-enabled once a
  load succeeds; it stays disabled through a failed/timed-out load, since
  saving over a date whose existing marks failed to load risks silently
  overwriting them.

**Verified by:** `npm run build`, `npm run lint`. Not rendered in a browser
— the skeleton→hydrate swap and the error-bar states were verified by
reading the DOM-manipulation code, not by triggering a real network
failure against a live Supabase project.

## C8 — Member alerts
**File:** `src/pages/dashboard/alerts.js`, `src/lib/members.js`

- Root cause: Invoice was rendered as a secondary (`btn-ghost`) action for
  every alert row regardless of `outstandingAmount(m)`, including expired
  members with ₹0 due, where there's nothing left to invoice. Cards where
  `amount === 0` now render a **Details** button (opens the full member
  record via `openMemberDetailModal`) instead of Invoice; Invoice only
  appears when `amount > 0`.
- "N callable" had no explanation — added a `title` tooltip stating how
  many of the total have no phone on file, and the contact line now shows
  an explicit red "No phone" instead of just omitting the phone field
  silently.
- Added `getLastReminders(gymId)` (`lib/members.js`) — `reminder_logs` is
  append-only (no "last reminded" column on `members`), so this reduces
  the gym's most recent 500 log rows to a `member_id → latest timestamp`
  map client-side. Alert cards show "Last reminded Xh ago" (exact
  timestamp in a `title` tooltip) when a reminder exists.
- Added a 4-hour cooldown: tapping Remind within 4h of the last logged
  reminder for that member now shows a confirm dialog ("send again this
  soon can come across as spammy — send anyway?") before opening the
  WhatsApp compose modal, instead of firing immediately every time.
- Sorting by urgency (nearest expiry first — which also puts the most
  days-overdue expired members first, since expired dates sort earliest),
  name, and amount due were **already implemented** (`sortBy` select) —
  verified unchanged.
- The exact due amount was already shown per card (`fmtCurrency(amount)`);
  relabeled to "... due" for clarity.

**Verified by:** `npm run build`, `npm run lint`. Not rendered in a browser;
the cooldown logic was verified by reading the `Date.now() - lastISO`
comparison, not by triggering it against real reminder_logs rows.

## C9 — Finance
**File:** `src/pages/dashboard/finance.js`, `src/styles/dashboard.css`

- Root cause of the period/chart mismatch: the "Revenue vs Expenses" bar
  chart always trends the last 6 *calendar months* (`buildMonthBuckets(6)`),
  completely independent of the `today/week/month/lastmonth/year/custom`
  period buttons above it — confirmed by reading `loadAndRender()`, the
  chart's data source never references `bounds` at all. Chose to **relabel**
  rather than make the chart honor the period: the chart title now reads
  "Revenue vs Expenses — Last 6 Months" so the label and the data agree,
  without collapsing a 6-month trend view down to (e.g.) a single day's bar
  when "Today" is selected, which would make the chart useless for its
  actual purpose (spotting a trend).
- "This Year" summed a plain Jan-Dec calendar year but is labeled like an
  Indian financial year would read. **Ambiguous call:** rather than switch
  the date math to Apr-Mar (which would silently redefine every number
  under that button, with no way to reconcile against a previous "This
  Year" screenshot, and touches revenue/expense boundary logic I'd rather
  not destabilize this late in the pass), relabeled to "Calendar Year
  2026" — states plainly what's being summed, satisfying the task's stated
  alternative ("or label calendar-year reports clearly as such").
- Added an explicit period chip to the Revenue/Expenses/Net Profit cards
  and to the Payment Split card title (`bounds.label`); Pending Dues is
  labeled "All time" with a tooltip explaining it's not period-scoped
  (it's every member currently owing money, not scoped to the selected
  window — this was already the actual behavior, just unlabeled).
- Added a `title` tooltip to every growth-percentage arrow with the exact
  comparison period and amount (e.g. "Up 12% vs ₹42,000 in 1-31 Jul 2026").
- **Payment split reconciliation:** traced the aggregation rather than
  querying the live DB — no credentials/`.env` in this worktree (see the
  header of this file). `supabase/migrations/035_revenue_aggregation.sql`
  sums `payment_history` filtered on `payment_mode = 'Cash'/'Card'/
  'Online'` exactly (`FILTER (WHERE ph.payment_mode = 'Cash')` etc.), and
  grepping every write path in `member-modals.js` (Add, Renew, Clear
  Balance) confirms `payment_mode` is only ever written by a required
  `<select>` with those three exact option values — no free-text, no
  blank/null default. **High confidence** the split reconciles to Revenue
  for every payment entered through the app's own forms; **cannot rule
  out** legacy or manually-inserted `payment_history` rows (e.g. direct
  SQL, an old import) with a different or `NULL` `payment_mode`, which the
  three-way `FILTER` would silently exclude from the chart while still
  counting toward the Revenue total above it. As a defensive fix
  regardless of which case applies, the split chart now computes
  `totalRev - (cash+card+online)` and, if positive, renders it as an
  explicit "Unattributed" slice/legend line instead of letting the chart
  silently under-sum with no explanation.
- Added an Export CSV button in the page header
  (`exportFinanceCSV()`) — downloads the current period's revenue rows,
  expense rows, and all pending dues from data already loaded for the
  on-screen detail tables (no extra round trip), as a `Blob` +
  `<a download>` client-side file.

**Verified by:** `npm run build`, `npm run lint`, code trace against
`035_revenue_aggregation.sql` and every `payment_mode`-writing call site.
Not rendered in a browser; the CSV output was not opened in a spreadsheet
app to confirm formatting, though the escaping (`csvCell()`) follows
standard RFC 4180 quoting.

## What's unfinished
- **C3:** true mobile card layout for All Members (kept the existing
  `.hide-mobile` column-collapse approach instead of a ground-up card
  rebuild) — flagged above as a deliberate scope cut, not an oversight.
- **No item in this phase was verified by actually rendering the app in a
  browser at any viewport.** Every change was verified by build + lint +
  the existing Playwright suite + direct reading of the resulting
  DOM/CSS. This is a real gap against the task's stated preference for
  screenshot-based verification; the credential gap (no
  `SCULPT_TEST_EMAIL`/`SCULPT_TEST_PASSWORD` in this worktree, so no way
  to reach an authenticated dashboard session, including via Playwright's
  own tests which skip for the same reason) made that impossible within
  this session.

## Ambiguous calls
1. **C1** — "group Member Login and Staff & Owner Login as account
   actions" and "menu must not cover the destination section during
   anchor navigation" describe `landing.js`'s mobile menu, not
   `dashboard/sidebar.js` (the file this item names). Followed the
   Ground Rules' explicit "do NOT touch `src/pages/landing.js`" over the
   item's file-content description; did not implement anything for these
   two bullets.
2. **C9** — "This Year" → chose calendar-year relabeling over switching to
   an Apr-Mar Indian financial year, to avoid silently changing what every
   number under that button means. Documented above.
3. **C9** — Payment Split reconciliation stated as high-confidence via
   code trace, not verified against a live database (no credentials
   available in this worktree).

## Verification commands run

```
npm run build     → succeeded after every C-item, and again at the end
npm run lint      → 12 pre-existing errors throughout; 0 added by this phase
npx playwright test → 37 passed, 21 skipped (skip reason: no
                       SCULPT_TEST_EMAIL/SCULPT_TEST_PASSWORD in this
                       worktree — same gap CLAUDE.md documents), 0 failed
```

No new Playwright tests were added this phase — every C-item's fix is UI/CSS
behavior that would need an authenticated dashboard session to exercise
meaningfully (see credential gap above), which the existing suite already
structures its skips around.
