# D Sculpt Fitness — manual testing, batch 2

QR check-in, member app and everything around it. Batch 1 (members,
money, invoices, staff, finance, landing page) is already done and
signed off — this list does not repeat it.

Tick each one. If something fails, write it up using the format at the
bottom of batch 1.

---

## before you start

- [ ] you need **three** logins ready: owner, a staff account, and at least two test members with an application number and phone number
- [ ] you need **two devices minimum** — one to be the desk tablet showing the QR, one to be the member's phone scanning it. A laptop showing the QR and a phone scanning it is fine
- [ ] test on android first (camera works there), then on an iphone — iOS is the one that usually fails, so don't declare it done until an iphone has scanned a code
- [ ] add fresh test members for this batch, obvious fake names, note them down
- [ ] you need one member who is **expired**, one **cancelled**, one **inactive/disabled login**, and one healthy active member. Make these up front, they're used all over this list
- [ ] make one member with an **unpaid balance but not expired** — he is supposed to be let IN, only the portal shows the amount due
- [ ] know the gym timezone setting is `Asia/Kolkata` and the server runs UTC — several checks below are only about that difference

---

## 1. desk QR display (the kiosk screen)

- [ ] open the check-in display as owner → a QR code shows, big, with the gym logo
- [ ] leave it open and watch it → the code **changes roughly every 30 seconds**. If it never changes, stop, that's the whole security of this feature gone
- [ ] take a screenshot / photo of the QR, wait **2 minutes**, then try to scan that photo from a member phone → must be **rejected**. This is the single most important test in this batch
- [ ] scan the code right at the moment it rotates (scan an "old looking" one within ~60 seconds) → should still work, the old and new codes overlap on purpose
- [ ] scan the QR with the **phone's normal camera app** (not our app) → should show a meaningless string like `SCULPT1:...`, NOT a clickable link
- [ ] leave the display open for 15 minutes → screen does not sleep, code keeps rotating, no error
- [ ] turn off the tablet's wifi while the display is open → shows a clear **offline** message, does NOT keep showing a dead code as if it's fine
- [ ] turn wifi back on → recovers on its own without reloading the page
- [ ] lock the tablet, unlock after 5 minutes → code is fresh, not frozen on an old one
- [ ] switch to another app and come back → same, recovers
- [ ] open the display on a phone-size screen → still usable, QR still big enough to scan
- [ ] open the display as **staff** → should work (the desk tablet is meant to be a staff account, not the owner's)
- [ ] press browser back / exit the display → returns to dashboard cleanly, no stuck full-screen state
- [ ] open the display in two places at once → both work, codes are different but both scan fine

---

## 2. member first login

- [ ] member login page opens from the landing page / login page
- [ ] log in with correct **application number + phone number** → asks you to set a 4-digit PIN
- [ ] set a PIN → lands in the member portal
- [ ] log out, log in again → now asks for the **PIN**, not the phone number again
- [ ] wrong application number → proper error, not a blank screen
- [ ] right application number, wrong phone number → proper error
- [ ] wrong PIN → proper error, and it does NOT tell you whether the app number exists
- [ ] enter wrong PIN 5–6 times in a row → note what happens (is there any lockout? if not, write it down as a finding)
- [ ] PIN that isn't 4 digits, letters in the PIN field, empty PIN → all stopped properly
- [ ] a member of **another gym's** application number → rejected
- [ ] a member whose login the owner disabled → cannot log in
- [ ] owner resets a member's login from the member row → member can log in again with app number + phone, sets a new PIN
- [ ] after the reset, the **old PIN no longer works**
- [ ] refresh the page while logged in as a member → still logged in
- [ ] close the browser, reopen → still logged in
- [ ] member logs out → back to member login, and browser back does NOT get back into the portal
- [ ] a member tries to open a **dashboard URL** directly (type `/dashboard` or the members page URL in the address bar) → must be blocked, must not see the gym dashboard even for a second
- [ ] an owner/staff logging in on the member login screen → sensible behaviour, note what it does
- [ ] a member logging in on the owner/staff login screen → sensible behaviour, note what it does

---

## 3. member scans the QR (the main flow)

Desk display open on one device, member logged in on a phone.

- [ ] active member scans → success screen, clear "checked in" message, member's name shown
- [ ] the check-in appears on the owner's Check-ins page within a few seconds
- [ ] same member scans again **immediately** → says already checked in, and does NOT create a second entry
- [ ] same member scans again after **90+ minutes** → allowed, creates a second entry
- [ ] **expired** member scans → **blocked**, clear message telling him to renew
- [ ] that blocked attempt still shows up in the owner's **denied** list (this is the point — it's the renewal call list)
- [ ] **cancelled** member scans → blocked, and the reason shown is cancellation, not expiry
- [ ] member with a **pending balance but not expired** scans → **allowed in**, and the portal shows the amount due
- [ ] member who expired **today** → check whether he's blocked or allowed, and confirm it matches the grace-days setting
- [ ] set grace days to 3 in settings, expired-2-days member scans → allowed. Set it back to 0 → blocked
- [ ] member scans a QR from a **different gym's** display (if you can make one) → rejected
- [ ] member scans some random other QR code (a product barcode, a UPI QR) → clean error message, app does not crash or hang
- [ ] scan in bad lighting / at an angle → either reads it or shows a normal "couldn't read" state, never freezes
- [ ] deny camera permission when asked → clear message explaining what to do, not a blank screen
- [ ] deny it, then allow it in browser settings and come back → scanner works
- [ ] scan with the phone on **mobile data**, not wifi → works
- [ ] turn off all internet on the member phone and scan → proper error, does not hang forever
- [ ] scan, then immediately kill the app and reopen → check-in was recorded once, not zero times, not twice

---

## 4. timezone — check this properly, it is the classic bug

- [ ] do a check-in **before 5:30 AM IST** (or temporarily change the phone/computer clock, or check an early-morning entry the next day) → the date recorded must be **today in India**, not yesterday
- [ ] do a check-in late at night (after 11 PM IST) → still today's date, not tomorrow's
- [ ] the time shown next to a check-in matches the actual IST clock time it happened
- [ ] the "today" count on the Check-ins page rolls over at **midnight IST**, not at 5:30 AM
- [ ] staff attendance marked by scanning shows on the correct day in the attendance report

---

## 5. staff / trainer check-in

- [ ] a staff member logged in on his own phone scans the desk QR → attendance marked **Present** for today, check-in time recorded
- [ ] he scans again after 10+ minutes → sets his **check-out** time, does NOT create a second row
- [ ] he scans a third time → nothing breaks, no duplicate row
- [ ] he scans again within 10 minutes of the first scan → no-op, no error mess
- [ ] this attendance shows on the existing staff attendance page for today
- [ ] the owner can still change it manually afterwards (mark half day, leave, etc.) and the manual change sticks
- [ ] the monthly staff attendance PDF and CSV include scan-marked days correctly
- [ ] a staff member who was deleted / login disabled scans → rejected

---

## 6. manual check-in (the fallback when the tablet is offline)

- [ ] owner marks a member present manually from the members list / member modal → entry created, marked as manual not QR
- [ ] the manual entry shows in the Check-ins list with today's date
- [ ] staff can also mark a member present manually
- [ ] mark an expired member manually → note whether it lets you (it should either block or clearly flag it)
- [ ] manual entry for a member already checked in today → doesn't create a confusing duplicate

---

## 7. owner Check-ins page

- [ ] new **Check-ins** item shows in the sidebar for the owner
- [ ] today's list shows every check-in, newest first, with the member name and time
- [ ] leave the page open and have someone scan → the new entry appears **without refreshing**
- [ ] the denied list shows only denied attempts, with the reason (expired / cancelled)
- [ ] counts at the top (today's check-ins, denied) match the number of rows actually listed — count them by hand
- [ ] open a member's record → his own visit history shows, and matches what you actually did
- [ ] history / date filter → change the date, numbers and rows change correctly
- [ ] a day with no check-ins → shows an empty state, not an error or a blank box
- [ ] monthly check-in report downloads (PDF and/or CSV) → opens, numbers add up
- [ ] the page works on the owner's **phone** — list readable, no sideways scrolling
- [ ] a very long member name in the list → doesn't break the layout
- [ ] a member name with `<b>test</b>` or an apostrophe → shows as plain text, page doesn't break

---

## 8. staff vs owner permissions on the new stuff

Log in as the staff account.

- [ ] staff **can** open the desk QR display
- [ ] staff **can** see the Check-ins page (it's under the attendance permission)
- [ ] staff **can** mark a manual check-in
- [ ] staff **cannot** see revenue anywhere on the check-ins screens
- [ ] staff **cannot** change the grace-days / check-in settings
- [ ] staff typing the settings URL directly → still blocked
- [ ] staff **cannot** reset a member's portal login (or if they can, decide whether that's wanted and write it down)

---

## 9. member privacy — the serious one

This is the part where a mistake leaks the whole business. Do it
carefully, as a logged-in member on his own phone.

- [ ] member portal shows **only his own** name, photo, plan, dates and balance
- [ ] member's visit history shows **only his own** visits
- [ ] member's receipts list shows **only his own** invoices
- [ ] there is **no way at all** from the member portal to see another member's name, phone or amount
- [ ] there is no way to reach the members list, finance, expenses, staff or settings
- [ ] type each of those dashboard URLs directly as a member → all blocked
- [ ] the member portal never shows the gym's total revenue, total member count, or any staff detail
- [ ] log in as member A, note something. Log out, log in as member B on the same phone → B sees only B's data, nothing of A's is left on screen or after a refresh
- [ ] check-in count / dates shown to the member match what he actually did

---

## 10. member portal — the rest of it

- [ ] plan name, start date, expiry date and days remaining are all correct
- [ ] days remaining counts down correctly (check it against a calendar by hand)
- [ ] an expired member's portal clearly says expired and tells him to renew
- [ ] pending balance shows the right amount; a fully paid member shows no balance
- [ ] gym name and logo show correctly at the top
- [ ] member photo shows; a member with no photo → placeholder, not a broken image
- [ ] receipts list shows every invoice for that member, with correct date and amount
- [ ] open a receipt → the PDF opens and is the right member's invoice
- [ ] open a receipt on a phone → opens, doesn't freeze
- [ ] a member with **no** invoices yet → empty state, not an error
- [ ] renew a member from the dashboard, then refresh his portal → new expiry and new receipt show up
- [ ] clear a member's balance from the dashboard → portal balance updates
- [ ] cancel a member → his portal reflects it sensibly
- [ ] portal on 390 / 375 width → nothing spilling off the side, no sideways scroll

---

## 11. receipts / invoice links (this changed — private bucket + signed links)

- [ ] send an invoice on whatsapp as before → the link still opens the PDF
- [ ] open that link on a phone that is **not logged in** → still opens
- [ ] take an invoice PDF URL and remove or change a character in it → should **not** open somebody else's invoice
- [ ] take member A's invoice link and try to reach member B's file by editing the path → must fail
- [ ] an invoice link generated **before** this change → check whether it still works, and write down the answer either way
- [ ] download a PDF from the dashboard → unchanged from batch 1, still A4, nothing cut off
- [ ] check the same invoice from the member portal and from the dashboard → same document

---

## 12. app / install specific

- [ ] install the app on android, log in as a member, scan → camera opens inside the installed app and works
- [ ] install on **iphone**, log in as a member, scan → camera works. If it doesn't, stop and report it, this is a known risk area
- [ ] iphone: first time it asks for camera permission inside the installed app → allow → works
- [ ] member locks the phone mid-scan and comes back → no stuck camera, no frozen screen
- [ ] switch to another app while the scanner is open and come back → camera restarts properly
- [ ] the camera light/indicator turns **off** when you leave the scan screen (camera actually released)
- [ ] open the app after 10 minutes idle → still logged in as member, scan still works
- [ ] the desk display installed as an app on the tablet → stays awake, keeps rotating

---

## 13. sizes

Same widths as batch 1, but only on the new screens: desk display,
member login, member portal, scan screen, Check-ins page.

- [ ] 1600
- [ ] 1440
- [ ] 1280
- [ ] 1024
- [ ] 768
- [ ] 480
- [ ] 390
- [ ] 375

At each one: no sideways scrolling, QR still scannable, buttons not overlapping, lists scroll properly.

---

## 14. try to break it on purpose

- [ ] double-tap the scan button fast → one check-in, not two
- [ ] scan the same code from two different member phones at the same moment → both get their own correct result
- [ ] two members scan within a second of each other → two separate correct entries
- [ ] hard refresh (Ctrl+Shift+R) on the Check-ins page and the desk display → loads, doesn't go blank
- [ ] hard refresh on the member portal → loads
- [ ] leave the member portal open for an hour, then scan → either works, or asks him to log in again properly. No silent failure
- [ ] leave the desk display open overnight → next morning it still shows a live rotating code
- [ ] do 30–40 check-ins in a day → the Check-ins list still loads fast and pages properly
- [ ] change the gym timezone setting to something else and back → nothing corrupts
- [ ] delete a member who has check-ins → nothing breaks; check whether his check-ins are still counted anywhere and write down what happens
- [ ] cancel a member who has check-ins → his history is still visible to the owner

---

## 15. regression — quick re-check of batch 1 things that were touched

The member portal work touched login, invoices and the members page, so
re-run just these:

- [ ] owner login still works normally
- [ ] staff login still works normally
- [ ] add a member → still fine (application number gets generated)
- [ ] add a member without a phone number → check what the portal login does for him, since login needs the phone. Write down the answer
- [ ] two members must never end up with the same application number — add several quickly and compare
- [ ] renew, clear balance, invoice PDF, whatsapp send → all still behave as in batch 1
- [ ] landing page still loads, logo animation still plays once
- [ ] first page load is still fast — the QR scanner code must not be loading on the landing page

---

## how to report a bug

Same as batch 1:

```
where:         member portal → scan
what i did:    scanned the desk QR as Ramesh Kumar (expired member)
expected:      blocked with a renew message
what happened: said checked in successfully
device:        android phone, installed app
logged in as:  member
screenshot:    attached
```

If it only happens sometimes, say so. If you can make it happen again,
write the exact steps.
