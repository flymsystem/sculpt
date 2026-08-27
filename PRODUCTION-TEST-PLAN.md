# D Sculpt Fitness — Production Test Plan

For the tester. Version 1 · 27 Aug 2026

---

## How to use this

Every test below is written as **Do this → Then check these** . The second part is the
point. Anyone can add a member and see it appear. What breaks in this app is what
happens to the *other five screens* afterwards — Finance, Alerts, Overview, the
invoice, the member's own portal. So no test ends at the screen you were on.

**Rules for the tester:**

1. **Use a name prefix.** Every test member/enquiry/expense/plan you create must start
   with `ZZTEST-` (e.g. `ZZTEST-Ramesh`). It makes cleanup possible and makes it
   obvious in the client's real data if something got left behind.
2. **Write down real numbers, not "OK".** If a test says check Finance, write the actual
   figure you saw. Half the bugs in this app are two screens disagreeing by ₹300.
3. **Hard-refresh before you trust a number.** Ctrl+Shift+R. Several past bugs only
   appeared after a refresh, because the screen was showing a stale in-memory copy.
   Several others only appeared *before* a refresh. Check both.
4. **Keep the browser console open** (F12 → Console). Red errors are findings even if
   the screen looks fine. Screenshot them.
5. **Test on a real phone too**, not just a narrow desktop window. The staff use phones.
6. **When something fails, note the exact time.** Server logs are timestamped and that's
   how the developer finds it.

**Roles you need:** an owner login, a staff login, and one member login (application
number + phone). Test the same flows as *staff* wherever marked 🔒 — the permission
split is real access control, not cosmetic.

**Devices/widths:** desktop 1440, laptop 1280, tablet 768, phone 390. Every list, table
and modal gets looked at on the phone at least once.

---

## 0 · Before you start — environment sanity

These take five minutes and catch the "nothing works at all" class of bug that
embarrassed us at the client site.

| # | Do this | Must happen |
|---|---|---|
| 0.1 | Open the production URL in a fresh incognito window | Landing page loads, no console errors, logo and photos render |
| 0.2 | Hard-refresh the dashboard 3 times in a row | Never lands on the landing page or a blank screen. (A router race used to do exactly this) |
| 0.3 | Open the app, then go offline (airplane mode), then click around | Clear "offline" messaging, not a white screen or a silent failure |
| 0.4 | Check the browser console on every page you visit today | Zero red errors. Note any that appear |
| 0.5 | Install as a PWA (Add to Home Screen) and open it | Opens standalone, icon correct, works |
| 0.6 | Log in, log out, log in again | Second login works without clearing cache |

---

## 1 · Member login (member portal)

This is where the client demo failed. Test it as if you were the member, on a phone,
from a WhatsApp message.

| # | Do this | Must happen | Why |
|---|---|---|---|
| 1.1 | Add a brand-new member as owner. **Write down the application number shown.** | The application number is shown clearly after saving and is not blank/`—`/`null` | Members were being created with no application number at all, so they could never log in and nobody knew |
| 1.2 | Log in to the member portal with that number + phone | Lands on the member portal | |
| 1.3 | Log in as a member who was created **weeks ago**, not today | Works too | Old members and new members go through different code paths |
| 1.4 | Type the phone **with +91**, with spaces, with a leading 0 | All three work | People paste from Contacts |
| 1.5 | Type the application number in lowercase | Works | |
| 1.6 | Wrong application number, correct phone | Generic error. Must **not** say which field was wrong | Saying "phone is wrong" tells an attacker the number is real |
| 1.7 | Correct application number, wrong phone | **Exactly the same** error text as 1.6 | Any difference is a security hole |
| 1.8 | Fail login 6 times in a row | Locks out with a "too many attempts" message | |
| 1.9 | After lockout, wait it out and log in correctly | Works again — you are not locked out permanently | |
| 1.10 | **Edit that member** (change anything — name, notes, photo) and save. Then log in as them again | Login still works | Editing a member has previously overwritten the application number with blank and silently locked them out. This is the single highest-value test on this page |
| 1.11 | Regenerate a member's application number, then try the **old** number | Old number rejected, new number works | |
| 1.12 | Log in as member A, then log out and log in as member B on the same device | B sees only B's data. No trace of A's name, plan, receipts or visits anywhere | |
| 1.13 | While logged in as a member, look for anything owner-only: the Add Member button, sidebar, finance figures | Nothing owner-only visible. The floating "+" button in particular has leaked into the member portal before | |
| 1.14 | Member portal → all four tabs (Check In, My Plan, Receipts, Visits) | All render, nothing blank, no console errors | |
| 1.15 | Log in as a member whose membership is **expired** | Shows "expired X days ago" — never a negative number like "-5 days remaining" | Fixed once; check both the My Plan tab and the Check In tab, they were separate bugs |

---

## 2 · Add member → the money must appear everywhere

This is the core money flow. **One add, six checks.** Do not shortcut it.

**Setup:** note the current Finance → This Month revenue, and Overview's revenue figure, *before* you start.

| # | Do this | Must happen |
|---|---|---|
| 2.1 | Add `ZZTEST-A` on a ₹2,500 plan, fully paid, Cash | Saves, success message, application number shown |
| 2.2 | Members list | Appears, correct plan, correct status, correct expiry |
| 2.3 | Finance → This Month | Revenue went up by **exactly ₹2,500**. Cash total went up by ₹2,500. Card and Online unchanged |
| 2.4 | Overview | Revenue figure matches Finance. Member count went up by 1 |
| 2.5 | Open the member → payment history | One payment, ₹2,500, Cash, today's date |
| 2.6 | Generate the invoice | Amount ₹2,500, correct name, correct gym details, correct GST treatment |
| 2.7 | Hard-refresh, re-check Finance and Overview | Same numbers. Nothing drifted |

Then repeat with variations — **each of these has its own arithmetic and each has broken before:**

| # | Variation | Watch for |
|---|---|---|
| 2.8 | Plan **+ an add-on** (e.g. ₹2,500 plan + ₹300 cardio) | Member detail modal must show ₹2,500 plan / ₹300 add-on / **₹2,800 total** — not ₹2,800 plan and ₹3,100 total. Add-ons were being counted twice in the modal while the invoice and DB were correct |
| 2.9 | **Partial payment** — ₹2,500 plan, ₹1,000 paid now | Finance revenue +₹1,000 (not ₹2,500). Pending Dues +₹1,500. Member status "Partial". Alerts → Due shows them |
| 2.10 | **Zero paid / full due** | Revenue unchanged. Dues +₹2,500 |
| 2.11 | **With a discount** | Invoice, member modal and Finance all agree on the discounted figure |
| 2.12 | **Trial member** | Expiry is the trial date you set, not a plan-derived date. Doesn't pollute revenue if unpaid |
| 2.13 | Card payment, then Online payment | Finance's Cash/Card/Online split matches exactly. These three must sum to total revenue |
| 2.14 | Add a member **with no phone number** | Either blocked with a clear message, or saved — but then the portal-login prompt must say they can't be sent login details |
| 2.15 | Add two members with the **same phone number** | Blocked with a readable message, not a raw database error |
| 2.16 | Add a member with a **future join date**, and one with a **past join date** | Expiry calculated from the join date, not today. Shows in the right month in Finance |
| 2.17 | Double-click **Save** rapidly | Exactly one member, one payment. Not two |
| 2.18 | Turn off wifi mid-save, turn it back on | Either it saved once, or it didn't save at all. Never a member with no payment recorded, never two members |
| 2.19 | Name with an apostrophe (`ZZTEST-O'Brien`) and one with `<b>bold</b>` in it | Displays literally. No broken layout, no bold text rendering, no crash. Check the list, the modal, the invoice and the CSV export |

---

## 3 · Delete / remove a member

This is bug #3 from the demo and it now has new behaviour — test both paths hard.

| # | Do this | Must happen |
|---|---|---|
| 3.1 | Add `ZZTEST-B` with a ₹2,000 payment. Note Finance revenue | |
| 3.2 | **Remove** the member (the normal soft delete) | Gone from Members list, gone from Alerts, gone from member count |
| 3.3 | Check Finance immediately, then after a hard refresh | Revenue **still includes** the ₹2,000 — this is correct and deliberate. The screen must *say so* somewhere, so the owner isn't left thinking it's a bug |
| 3.4 | Use **Delete permanently** on another test member with a payment | Revenue drops by exactly that member's payments. Member, payments, invoices and check-ins all gone |
| 3.5 | Try Delete permanently as **staff** 🔒 | Not available / refused |
| 3.6 | Delete permanently, then hard refresh, then check Finance, Overview, Analytics, and the Payments CSV export | All five agree that the money is gone. Not "gone in Finance, still in Analytics" |
| 3.7 | Remove a member, then check the Payments/Members CSV export and the Full Backup | The removed member is handled consistently — either present-and-marked or absent, in *every* export, not different per file |
| 3.8 | Remove a member who has an **outstanding balance** | Pending Dues drops by their balance. Alerts count drops |
| 3.9 | Cancel a membership (not delete) | Different from remove: check what Finance, Alerts and the member's own portal each show |
| 3.10 | Remove the **last remaining** member | Finance/Overview show ₹0 or empty states cleanly, not "NaN", "undefined" or a broken chart |

---

## 4 · Renewals

The renewal duplicate-guard has been broken before in a way that only shows up on the *second* renewal.

| # | Do this | Must happen |
|---|---|---|
| 4.1 | Renew a member **before** their expiry, same plan, same price | Succeeds. New expiry = old expiry + plan duration (**not** today + duration — they must not lose the days they'd already paid for) |
| 4.2 | **Renew the same member again** on the same plan and price a minute later | Must succeed. This exact case was permanently blocked as a "duplicate" — the single most common real-world pattern |
| 4.3 | Renew a member **after** expiry | New expiry counts from today, not from the old expired date |
| 4.4 | Double-click the Renew confirm button | Exactly one renewal, one payment |
| 4.5 | After each renewal: Finance, Overview, payment history, invoice, member's own portal | All show the new payment and the new expiry. All agree |
| 4.6 | Renew onto a **different, more expensive** plan | Amount, expiry and plan name all update everywhere |
| 4.7 | Renew with a partial payment | Balance due created correctly, appears in Alerts and Finance Pending Dues |
| 4.8 | Renew a **cancelled** member | Either sensibly reactivates them or is blocked with a clear message — not a silent failure |

---

## 5 · Collecting a pending balance

| # | Do this | Must happen |
|---|---|---|
| 5.1 | Member with ₹1,500 due — collect ₹500 | Balance now ₹1,000. Status stays Partial. Finance revenue +₹500. Dues −₹500 |
| 5.2 | Collect the remaining ₹1,000 | Balance ₹0, status Paid, member leaves the Alerts→Due list |
| 5.3 | Try to collect **more** than the balance | Blocked or handled sensibly — never a negative balance |
| 5.4 | Try to collect ₹0 or a negative amount | Blocked |
| 5.5 | Open the same member on two devices/tabs and collect at the same time | Money counted once, not twice |
| 5.6 | After collecting, check the invoice and payment history | Both show the new payment separately from the original |
| 5.7 | As staff 🔒 collect a balance | Allowed (staff can collect) — but the Finance page must still be blocked for them |

---

## 6 · Finance page

| # | Do this | Must happen |
|---|---|---|
| 6.1 | Click through every period: Today / This Week / This Month / Last Month / Calendar Year / All Time | Each loads, no console errors, figures change sensibly |
| 6.2 | Add up: does Cash + Card + Online = total Revenue? | Yes, in every period |
| 6.3 | Net Profit = Revenue − Expenses? | Check by hand for one period |
| 6.4 | "All Time" revenue vs the sum of every month | Must reconcile |
| 6.5 | Custom range: pick a range that contains a known payment | That payment is included. Check both boundary days — the first and last day of the range must be inclusive. Off-by-one on the end date has broken this before |
| 6.6 | Custom range with **end date before start date** | Blocked or handled, not a crash or a nonsense number |
| 6.7 | Add an expense dated **today**, check This Month; then change it to last month | Moves between periods correctly |
| 6.8 | Pending Dues card | It is **all-time**, not period-scoped. Confirm the label says so and the number matches the sum of every member's balance |
| 6.9 | Click each stat card to expand the detail | Rows shown match the total above them |
| 6.10 | Export CSV | Opens in Excel. Rows match what's on screen. Member names with commas/apostrophes don't break the columns. Filename sensible |
| 6.11 | The 6-month Revenue vs Expenses chart | Doesn't change when you change the period buttons (it's a fixed 6-month trend) — and the label must say so |
| 6.12 | As staff 🔒 try to reach Finance (sidebar and by typing the URL `/dashboard/finance`) | Blocked both ways |

---

## 7 · Expenses

| # | Do this | Must happen |
|---|---|---|
| 7.1 | Add an expense, check Finance | Expenses total and Net Profit both move |
| 7.2 | Edit its amount | Finance updates |
| 7.3 | Delete it | Finance returns to the previous figure exactly |
| 7.4 | Expense on the **1st** and on the **last day** of a month | Both land in the right month. Month-boundary handling has broken here before |
| 7.5 | Category name with `<script>` or `&` in it | Displays literally, does not break the page (this exact spot had an XSS bug) |
| 7.6 | Very large amount, and a decimal amount (₹99.50) | Stored and displayed correctly, rounding consistent everywhere |
| 7.7 | As staff 🔒 | Can add, **cannot** edit or delete |

---

## 8 · Check-in (desk display + scanner)

| # | Do this | Must happen |
|---|---|---|
| 8.1 | Open the desk display | QR appears, refreshes on its own (watch for ~1 min), screen doesn't sleep |
| 8.2 | Press the **Back** button on the desk display | Returns to the dashboard **on the first press**. This is the button that failed at the client site |
| 8.3 | Go to another section and come back to the desk display, then press Back again | Still works. The earlier failure only appeared after navigating around first |
| 8.4 | Scan the QR from the member portal as an **active** member | Check-in succeeds, confirmation shown |
| 8.5 | Scan again immediately | Handled — either a friendly "already checked in" or counted once. Never two visits for one entry |
| 8.6 | Scan as an **expired** member | Rejected with a clear reason |
| 8.7 | Scan a QR screenshot taken **2+ minutes ago** | Rejected (codes expire) |
| 8.8 | Check in early morning (before 6am if you can) or change device time | The visit lands on today's date in India time, not yesterday. UTC/IST slippage has broken this class of thing before |
| 8.9 | Staff manual check-in | Works, appears in Check-ins list |
| 8.10 | After check-ins: Check-ins page, the member's Visits tab, and the attendance report | All show the same visits, same count, same dates |
| 8.11 | Leave the desk display open for 10 minutes | Still refreshing, no memory bloat, no console errors piling up |
| 8.12 | Desk display with wifi off | Shows the offline warning, doesn't show a stale QR as if it were valid |

---

## 9 · Staff accounts and permissions 🔒

This is real access control. Test it like you're trying to break in.

| # | Do this | Must happen |
|---|---|---|
| 9.1 | Create a staff login, log in as them | Works |
| 9.2 | As staff, check the sidebar | No Finance, Staff, Settings, Backup, Analytics |
| 9.3 | As staff, **type the URLs directly**: `/dashboard/finance`, `/dashboard/staff`, `/dashboard/gymconfig`, `/dashboard/backup`, `/dashboard/analytics` | All blocked. Hiding the menu item is not enough |
| 9.4 | As staff, look at Overview | No revenue figures anywhere |
| 9.5 | As staff, open a member | Can edit, can renew, can collect — **cannot** delete or cancel |
| 9.6 | Reset a staff password as owner, then log in as staff with the new password | Works; old password rejected |
| 9.7 | Revoke/disable a staff login, then try to log in as them | Blocked. And if they were already logged in in another tab, they lose access on next action |
| 9.8 | Delete a staff member who has added members | Their added members survive; "added by" doesn't crash the UI |
| 9.9 | Log in as owner and staff in two browsers at once | Neither one's session breaks the other |

---

## 10 · Plans

| # | Do this | Must happen |
|---|---|---|
| 10.1 | Create a plan, add a member on it | Price and duration flow through to expiry, invoice and Finance |
| 10.2 | **Change the plan's price**, then look at the existing member | Their historical payment must NOT change. Their invoice must still show what they actually paid |
| 10.3 | **Delete a plan** that members are on | Those members still display correctly. Their detail modal and invoice don't break or show wrong totals — the fallback path for a deleted plan has had its own arithmetic bug |
| 10.4 | Duplicate a plan, edit the copy | Original untouched |
| 10.5 | Plan with 0 or negative price/duration | Blocked |
| 10.6 | Plans Showcase page vs Plan Settings | Same plans, same prices |
| 10.7 | As staff 🔒 | View only, no editing |

---

## 11 · Enquiries

| # | Do this | Must happen |
|---|---|---|
| 11.1 | Add an enquiry, move it New → Contacted → Converted | Counts on the four cards update every time |
| 11.2 | Convert an enquiry into a member | Member created with the enquiry's details prefilled; enquiry marked converted; **not** duplicated as a fresh enquiry |
| 11.3 | Filter by each status | Counts match the rows shown |
| 11.4 | Delete an enquiry | Counts drop; nothing else affected |
| 11.5 | Enquiry with a phone that's already a member | Handled sensibly, message is readable |

---

## 12 · Alerts

| # | Do this | Must happen |
|---|---|---|
| 12.1 | Compare the "Payment Due" count and total against Finance → Pending Dues | Identical. These two disagreeing is a classic |
| 12.2 | Collect a member's balance | They disappear from the Due list immediately and after refresh |
| 12.3 | Renew an expiring member | They leave the Expiring list |
| 12.4 | Each filter pill (All / Expired / Expiring / Due) | Count on the pill = rows shown |
| 12.5 | A member expiring **today** | Appears in exactly one bucket, not both Expired and Expiring |
| 12.6 | Members with no phone number | "callable" count is accurate; call button doesn't appear or is disabled |
| 12.7 | Click a member from Alerts | Opens the right member |

---

## 13 · Invoices & WhatsApp

| # | Do this | Must happen |
|---|---|---|
| 13.1 | Generate an invoice for a paid member | Gym name, address, GSTIN, logo, member details, amount, date all correct |
| 13.2 | Check the address on the invoice | It must be an **address**, not an email. (Settings currently has an email in the address field — confirm whether it's been fixed) |
| 13.3 | Invoice for a partially paid member | Shows paid vs balance correctly |
| 13.4 | Invoice for a member with add-ons | Line items add up to the total actually charged. Cross-check against payment history |
| 13.5 | Invoice with a discount applied | Discount shown, maths correct |
| 13.6 | GST on / GST off in Settings | Invoice changes accordingly; totals still correct |
| 13.7 | Print / save the invoice as PDF | Fits the page, nothing cut off, no dark-mode-only colours making it unreadable on paper |
| 13.8 | Send login details / invoice via WhatsApp | Opens WhatsApp with the right number and a readable message; the application number and link in the message are correct |
| 13.9 | Send WhatsApp to a member with no phone | Blocked with a clear message, not a broken link |
| 13.10 | Invoice for a member whose plan was later deleted | Still correct (see 10.3) |

---

## 14 · Settings

| # | Do this | Must happen |
|---|---|---|
| 14.1 | Change gym name / address / phone, save, hard refresh | Persisted. Then check it flowed into: invoices, the landing page, the desk display, the audit report |
| 14.2 | Upload a logo | Appears on dashboard, invoice, desk display, login screens. Try a large file and a non-image file — both handled |
| 14.3 | Change GST settings | Invoice and the audit report both follow |
| 14.4 | Fill in Legal Name / PAN / Registered Address | Audit report picks them up instead of "Not supplied" |
| 14.5 | Edit the WhatsApp template, use every placeholder (`{name}`, `{appnum}`, etc.) | All substitute correctly with real values — no literal `{appnum}` left in the sent message |
| 14.6 | Change reminder days | Alerts → Expiring window changes to match |
| 14.7 | Change your password, log out, log in with the new one | Works; old one rejected |
| 14.8 | Save a setting, then open the app on a **second device** | The change is there |
| 14.9 | Enter a bad GSTIN / an obviously wrong PAN | Either validated, or at minimum it doesn't corrupt the invoice |

---

## 15 · Backup, exports and reports

| # | Do this | Must happen |
|---|---|---|
| 15.1 | Export Members / Payments / Expenses reports | Each downloads, opens in Excel, columns aligned |
| 15.2 | Count rows in the Members export vs the member count on screen | Equal |
| 15.3 | Sum the Payments export vs Finance → All Time revenue | Equal. If they differ, that is a finding, full stop |
| 15.4 | Export with a name containing a comma, quote or `#` | Columns don't shift |
| 15.5 | Full Data Backup | Downloads, non-empty, contains members + payments + expenses |
| 15.6 | Financial & GST Audit Support Report | Totals match Finance. Identity fields populated. No "undefined"/"Not supplied" where you filled it in |
| 15.7 | Do an export, then delete a member permanently, then export again | Difference is exactly that member |
| 15.8 | Export when a date filter is applied | Export honours the filter — or clearly states it doesn't |
| 15.9 | As staff 🔒 | Backup page unreachable |

---

## 16 · Overview / dashboard / analytics

| # | Do this | Must happen |
|---|---|---|
| 16.1 | Every number on Overview, cross-checked against its own page | Revenue = Finance. Members = Members list. Dues = Alerts. Expiring = Alerts |
| 16.2 | Click every stat card and mini-stat | Navigates to the right page **with the right filter applied** |
| 16.3 | Analytics page, every chart | Loads, no console errors, figures agree with Finance |
| 16.4 | Analytics with a period changed | Charts update; totals still reconcile |
| 16.5 | Recent activity list | Shows the things you actually just did, in the right order |
| 16.6 | Overview with zero members (or filter to an empty period) | Empty states, not `NaN`, `undefined`, `₹NaN` or a broken chart |
| 16.7 | As staff 🔒 Overview | No financial figures |

---

## 17 · Cross-cutting — run these last, they find the ugly ones

| # | Do this | Must happen |
|---|---|---|
| 17.1 | **The full lifecycle in one go:** enquiry → convert to member → partial payment → collect balance → renew → check in twice → generate invoice → remove permanently. After *every single step*, glance at Finance, Overview and Alerts | Every number moves by exactly the right amount, every time |
| 17.2 | Browser **Back button** after every navigation: dashboard sections, modals, member portal tabs, desk display | Goes somewhere sensible. Never a blank screen, never logged out, never stuck |
| 17.3 | Open two tabs, change something in tab A, refresh tab B | Tab B shows the change |
| 17.4 | Leave the app open for 30+ minutes, then click something | Still works, or asks you to log in again cleanly. Not a silent failure or a stale-token error |
| 17.5 | Every modal: open it, press Escape, click outside, press the X | All three close it. Nothing left stuck on screen behind it |
| 17.6 | Every form: submit it **empty** | Clear validation messages, no crash |
| 17.7 | Every list with a search box: search for text that matches nothing | Clean "no results", not a blank page |
| 17.8 | Long member name (60+ characters) and a very long note | No layout break in the list, modal, invoice or export |
| 17.9 | Phone (390px): every page, every table, every modal | Nothing cut off, nothing needing horizontal scroll, buttons reachable, the floating + button doesn't cover anything you need |
| 17.10 | Anywhere a number is shown: check ₹ formatting | Indian format (₹1,25,000), consistent everywhere, no `1.25e5`, no missing symbol |
| 17.11 | Check the same figure on desktop and phone | Identical |
| 17.12 | Log out from the member portal, then press Back | Cannot get back into the portal without logging in |
| 17.13 | While logged out, type a dashboard URL directly | Redirected to login, not a flash of real data first |

---

## 18 · Cleanup — do not skip

| # | Do this |
|---|---|
| 18.1 | Delete every `ZZTEST-` member, enquiry, expense, plan and staff login you created |
| 18.2 | Confirm Finance → All Time revenue is back to the number you recorded at the start of testing |
| 18.3 | Confirm the member count is back to its starting value |
| 18.4 | List anything you could not delete, so the developer can clean it up |

---

## Reporting a finding

For each one, give:

- **Where** — page and what you clicked
- **What you did** — exact steps, in order, so it can be repeated
- **What you expected vs what happened** — with the actual numbers
- **Screenshot** — including the browser console if there was a red error
- **Time** — so it can be matched to server logs
- **Does it repeat?** — try it twice. "Happened once" and "happens every time" get fixed differently
- **How bad** — Blocker (can't use the app) / Major (wrong money, wrong data, security) / Minor (cosmetic, wording)

Anything involving **money being wrong**, **one screen disagreeing with another**, or
**a member seeing data that isn't theirs** is Major, even if it looks small.
