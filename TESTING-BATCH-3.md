# D Sculpt Fitness — testing list, batch 3

Only the things that changed this round. Tick each one. If something fails,
write: what you did → what you expected → what happened → device + browser.

Test on **a phone and a laptop** at minimum. Android phone matters most.

---

## 1. Member photo  *(was completely broken)*

- [ ] Add a new member with a photo → save → go back into the member → **photo is still there**
- [ ] Open an existing member without a photo → add one → save → reopen → photo is there
- [ ] Replace an existing photo → save → reopen → new photo shows, not the old one
- [ ] Remove a photo → save → reopen → no photo, no broken image icon
- [ ] Do all four again logged in as **staff**, not owner
- [ ] Photo shows in the members list and in the member detail popup

## 2. Desk QR screen (kiosk)

- [ ] Open the check-in display → press and hold the exit button for 3 seconds → it exits
- [ ] Hold it and let your finger **slide slightly** while holding → it still exits (this was the bug)
- [ ] Hold for 1 second and let go → does NOT exit
- [ ] Do the above on a **phone, a tablet and a laptop** (mouse)
- [ ] Scan a code with an **expired** member's login → shows "expired" once, cleanly, no fast flickering between messages
- [ ] Scan again with a healthy member → checks in normally

## 3. Data & Backup downloads

- [ ] Download each option in Data & Backup one by one
- [ ] Every file has a **different, meaningful name** with a date in it — no two files called the same thing

## 4. Member app (member login)

- [ ] Log in as a member → go to **Visits** tab → nothing is covering the tab, no blue "+" button on top of it
- [ ] Check every tab: Check In / My Plan / Receipts / Visits — no "+" add button anywhere
- [ ] Open a member with **many receipts** → the list scrolls, the bottom menu stays visible and does not slide off screen
- [ ] Go dashboard → member portal → back to dashboard: no leftover buttons floating around

## 5. Dashboard — mobile menu

- [ ] Open the menu on a phone → it is a sensible size, not covering the whole screen
- [ ] Hamburger turns into an **X** when open
- [ ] Page behind the menu does **not** scroll while it is open
- [ ] Menu closes on: tapping a link, tapping outside, Escape key, browser back
- [ ] Current page is clearly highlighted in the menu
- [ ] **Support** section has real items in it (not an empty heading)

## 6. Dashboard — main screen

- [ ] Tap each KPI card → it opens the matching filtered list
- [ ] Each card says which period it covers
- [ ] Numbers use Indian formatting (1,50,000) everywhere
- [ ] Alert banner takes you to the filtered members

## 7. All Members

- [ ] Fewer icons per row now; the rest are under a **⋯** menu — every action still works
- [ ] Scroll down a long list → header row stays stuck at the top
- [ ] Scroll sideways → action buttons stay visible
- [ ] Apply filters → it says how many results are showing
- [ ] Filter down to nothing → a clear "no results" message
- [ ] Pagination works (next / previous pages)
- [ ] Check all of this on a phone

## 8. Member detail popup

- [ ] Only one way to close it (no duplicate Close + Cancel)
- [ ] Buttons at the bottom: Renew / Invoice are the main ones; Deactivate looks clearly dangerous
- [ ] Scroll a long member record → the buttons stay at the bottom, member's name stays visible
- [ ] Payment history shows date, amount, mode, receipt
- [ ] **Send Login** says what is being sent and where
- [ ] Every button still does what it says

## 9. Enquiries

- [ ] Open on a phone → nothing overlaps, phone number is fully readable, buttons don't sit on top of text
- [ ] Try at the smallest phone size you have
- [ ] Call / WhatsApp / Edit / Convert / Delete all still work

## 10. Staff attendance

- [ ] Open the page → it never sits stuck on "Loading…" forever
- [ ] Save Attendance is disabled until the list has loaded
- [ ] Turn wifi off and open it → clear error message with a Retry button, not a blank screen

## 11. Member alerts

- [ ] Expired member with ₹0 due → main button is View/Details, not Invoice
- [ ] Member with no phone shows "No phone" clearly
- [ ] Sorting works (expiry, amount due, days overdue)
- [ ] Exact due amount and last reminder date are shown
- [ ] Send a reminder twice quickly → it stops you the second time

## 12. Finance

- [ ] The chart matches the period selected in the dropdown — label and data agree
- [ ] Year options say **FY 2026–27** style, not just "This Year"
- [ ] Revenue / expense / profit cards say which period
- [ ] Any growth % shows what it is being compared to
- [ ] Export button downloads a proper file

## 13. Audit report (Data & Backup)

- [ ] It is now called **Financial & GST Audit Support Report**
- [ ] Cover page says "Prepared for audit review — not a tax filing"
- [ ] Cover shows the report period, business name, GSTIN, PAN, address, and a generated-on timestamp
- [ ] Every table has a working CSV/Excel download, each with its own filename
- [ ] Sections with no data say "not recorded" — they should NOT show made-up numbers
- [ ] Member counts in the report match the actual member list

## 14. Website (landing page)

- [ ] Phone numbers, WhatsApp, email, address, timings and Instagram all show real values — no "to be supplied" tags left
- [ ] Tap the phone number → dialler opens with the right number
- [ ] Tap WhatsApp → opens WhatsApp chat to **8867878946** with a message ready
- [ ] Tap email → mail app opens
- [ ] Instagram link opens the right profile
- [ ] Map loads and tapping it opens Google Maps at the right location
- [ ] Footer links all work
- [ ] Menu links scroll to the right section — the page must NOT reload or replay the logo animation
- [ ] Photos are the real gym photos
- [ ] Share the site link on WhatsApp → preview image and text look right

---

## Known — do not report these

- Personal Training and Group Classes still use stock photos (real ones not supplied yet)
- All Members on mobile is still a scrolling table, not cards
- PAN / legal name / registered address show "Not supplied" until they are entered in Settings
- B2B/B2C split, SAC-wise data, ITC and credit/debit notes show "not recorded" — the app has never stored that data
