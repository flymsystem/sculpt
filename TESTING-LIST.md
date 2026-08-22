# D Sculpt Fitness — manual testing list

for testing everything by hand, feature by feature.
check-in / QR stuff is not built yet, so it's not here.

tick each one. if something fails, write it down using the format at the bottom.

---

## before you start

- [ ] test on chrome desktop first, then on an actual android phone, then on an iphone if we have one
- [ ] use the owner login for the full run, then do the whole thing again with a staff login
- [ ] don't test on real client data, add test members with obvious fake names
- [ ] keep a note of every test member you add so we can clean up after

---

## 1. login

- [ ] login with correct email and password → goes to dashboard
- [ ] login with wrong password → shows a proper error, not a blank screen
- [ ] login with an email that doesn't exist → proper error
- [ ] leave both fields empty and hit login → should stop you
- [ ] show/hide password eye icon works
- [ ] refresh the page after logging in → still logged in, doesn't throw you out
- [ ] close the browser fully, open again → still logged in
- [ ] logout → goes back to landing page
- [ ] after logout, press browser back button → should not get back into the dashboard

---

## 2. adding members

- [ ] add a member with only the required fields → saves fine
- [ ] add a member with every single field filled → saves fine
- [ ] add a member without a phone number → check whether it lets you (phone is supposed to be optional now)
- [ ] add a member with a very long name → doesn't break the layout anywhere
- [ ] add a member with a name that has special characters, try `<b>test</b>` and `O'Brien` → shows as plain text, page doesn't break
- [ ] add two members with the same phone number → see what happens, note it
- [ ] add a member and check the expiry date is calculated correctly from the plan duration
- [ ] add a member with a 1 month plan, 3 month, 6 month, 12 month → all expiry dates correct
- [ ] add a trial member
- [ ] add an unpaid member
- [ ] add a member with a date of birth → shows correctly, check it doesn't shift by a day
- [ ] upload a member photo while adding
- [ ] upload an aadhar photo while adding
- [ ] add a member, then immediately search for them → they show up
- [ ] add a member and check the new member count on the dashboard went up by 1

## 3. adding members with money variations

- [ ] add with payment mode cash
- [ ] add with payment mode online
- [ ] add with payment mode card
- [ ] add with full payment → status shows Paid
- [ ] add with partial payment → status shows Partial, balance is correct
- [ ] add with no payment → status shows Due, full amount as balance
- [ ] **add with a discount** → check the final amount is plan price minus discount
- [ ] add with a discount bigger than the plan price → should stop you, not go negative
- [ ] add with a 0 discount → same as no discount
- [ ] add with GST enabled → check the GST amount and total are right, do the maths yourself on a calculator
- [ ] add with GST disabled → no GST line anywhere
- [ ] add with an addon (cardio, personal training etc) → addon price included in total
- [ ] add with multiple addons → all of them show, total adds up
- [ ] add with discount AND gst AND addon together → this is where it usually breaks, check the maths carefully

## 4. editing members

- [ ] edit a name → saves, shows updated everywhere
- [ ] edit a phone number → saves
- [ ] change the plan → expiry date updates correctly
- [ ] edit and save without changing anything → nothing breaks
- [ ] edit the application number field
- [ ] add a photo to a member who didn't have one
- [ ] remove an existing photo → photo goes, no broken image icon left behind
- [ ] edit a member, close the popup without saving → changes are not saved

## 5. deleting and cancelling

- [ ] delete a member → they disappear from the list
- [ ] after deleting, check they are NOT permanently gone (it's supposed to hide, not erase)
- [ ] cancel a membership → member is still in the list but shows as cancelled
- [ ] cancel is different from delete, make sure both behave differently
- [ ] delete a member who has payment history → the payment records should still be there in finance
- [ ] try deleting as a staff login → staff should NOT be allowed

## 6. renewing

- [ ] renew a member whose plan is still active → new expiry adds on to the old one
- [ ] renew a member who already expired → new expiry starts from today
- [ ] renew with a different plan than the original
- [ ] renew with a discount
- [ ] renew with partial payment → balance is correct
- [ ] renew and check it appears in payment history
- [ ] renew and check the revenue on the finance page went up by the right amount
- [ ] renew twice quickly in a row → should not create two entries or double-charge

## 7. clearing balance / collecting payment

- [ ] clear a partial balance fully → status changes to Paid
- [ ] clear part of a balance → status stays Partial, remaining amount is right
- [ ] try to clear more than the balance → should stop you
- [ ] after clearing, check it shows in payment history with the right date and mode
- [ ] check finance revenue went up by the amount collected
- [ ] staff login should be able to collect payment but NOT see the finance page

---

## 8. invoice — this one needs proper attention

- [ ] open the invoice preview for a member → opens inside the app, NOT in a new browser tab
- [ ] check gym name, logo, address, phone are all correct on the invoice
- [ ] check member name, plan, dates, amounts are correct
- [ ] invoice for a simple 1-plan member → everything fits on one page
- [ ] invoice with GST → GST breakdown shows correctly
- [ ] invoice with discount → discount line shows, final total is right
- [ ] invoice with several addons → check if it runs to a second page and if that second page looks proper, not cut off
- [ ] invoice number is unique, add two members and compare
- [ ] close the invoice preview → goes back to the dashboard cleanly
- [ ] print the invoice → print preview looks the same as the on-screen one
- [ ] **download the invoice as PDF** → opens, is A4 size, nothing cut off at the edges
- [ ] compare the PDF against the on-screen preview → they should look the same, check the width especially
- [ ] PDF on a long member name → doesn't overflow
- [ ] make a PDF on a phone → works, doesn't freeze

## 9. whatsapp invoice — check the link actually works

- [ ] send invoice on whatsapp → whatsapp opens with the message already filled in
- [ ] check the number it's sending to is the member's actual number
- [ ] check the message text reads properly, no code or weird symbols showing
- [ ] **click the invoice link in the whatsapp message → it should actually open the PDF**
- [ ] open that same link on a different phone that is not logged in → should still open
- [ ] open the link after a day → still works
- [ ] send to a member with no phone number saved → should stop you with a proper message
- [ ] send a renewal reminder on whatsapp → template fills in name, plan, expiry date correctly
- [ ] test on an android phone and on an iphone, whatsapp behaves differently on both

---

## 10. plans

- [ ] add a new plan
- [ ] edit a plan price
- [ ] delete a plan
- [ ] delete a plan that members are already on → existing members should not break
- [ ] add a plan with features listed → features show correctly
- [ ] mark a plan as featured
- [ ] add a plan with 0 price → see what happens
- [ ] check new plans show up in the add member dropdown immediately
- [ ] staff login → should be able to see plans but NOT edit them

## 11. staff

- [ ] add a staff member
- [ ] edit staff details
- [ ] delete staff
- [ ] add staff with a salary amount
- [ ] mark staff attendance — present, absent, half day, leave
- [ ] change an attendance mark after saving it
- [ ] mark attendance for a past date
- [ ] pay a salary → check it also shows up as an expense
- [ ] pay an advance salary
- [ ] create a login for a staff member → note the credentials, you'll need them for section 17
- [ ] disable a staff login → that person can no longer log in
- [ ] download the staff attendance report as PDF → grid looks correct, totals add up
- [ ] download the same report as CSV → opens in excel properly

## 12. expenses

- [ ] add an expense
- [ ] edit an expense
- [ ] delete an expense → this one is supposed to actually delete permanently, unlike members
- [ ] add an expense with a receipt/bill attached
- [ ] add expenses in different categories
- [ ] check expenses show up on the finance page
- [ ] staff login → should be able to ADD an expense but not edit or delete

## 13. finance

- [ ] total revenue matches what you actually collected during testing, add it up manually
- [ ] filter by this month, last month, custom date range → numbers change correctly
- [ ] profit = revenue minus expenses, check the maths
- [ ] payment history list shows every payment you made during testing
- [ ] filter payment history by mode (cash / online / card)
- [ ] export finance data → file downloads and opens
- [ ] check a cancelled member's old payments are still counted

## 14. enquiries / leads

- [ ] add an enquiry
- [ ] edit an enquiry
- [ ] change the status of an enquiry
- [ ] convert an enquiry into a member → member gets created with the right details
- [ ] delete an enquiry
- [ ] whatsapp an enquiry

## 15. alerts and notifications

- [ ] expiring members list → shows members expiring soon, dates are right
- [ ] expired members list → correct
- [ ] members with pending balance → correct, amounts match
- [ ] send a reminder from alerts → whatsapp opens correctly
- [ ] notification bell → shows a count
- [ ] open the bell, read a notification, check the count goes down
- [ ] mark all as read

## 16. dashboard and analytics

- [ ] total members count is correct
- [ ] active members count is correct
- [ ] revenue figures match the finance page
- [ ] all the graphs load, no blank boxes
- [ ] change the date range → graphs update
- [ ] check the numbers on a fresh gym with no data → shows 0 or empty state, not an error
- [ ] analytics on a phone → charts still readable

---

## 17. staff login vs owner login — do this properly

log in as the staff account you made in section 11.

staff should NOT be able to see or open:

- [ ] finance page
- [ ] settings
- [ ] backup / data export
- [ ] staff management
- [ ] analytics
- [ ] revenue numbers on the main dashboard

staff SHOULD be able to:

- [ ] add and edit members
- [ ] collect payments and renew
- [ ] add expenses
- [ ] see plans (but not edit)
- [ ] handle enquiries

also:

- [ ] as staff, try typing a blocked page's URL directly in the address bar → should still be blocked
- [ ] staff should not be able to delete a member
- [ ] staff should not be able to cancel a membership

---

## 18. settings

- [ ] change the gym name → shows everywhere, including on the invoice
- [ ] upload a gym logo → shows on dashboard and invoice
- [ ] change the address and phone → updates on the invoice
- [ ] turn GST on, set a percentage → invoices pick it up
- [ ] turn GST off → GST disappears from invoices
- [ ] edit the whatsapp reminder template → new text is used when you send a reminder
- [ ] change owner password → old password stops working, new one works

## 19. backup / data

- [ ] export all data → file downloads
- [ ] open the export file and check the data is actually in there, not empty
- [ ] export members list
- [ ] GST summary report
- [ ] attendance report

## 20. landing page (public site)

open it in a private/incognito window, not logged in.

- [ ] page loads, logo animation plays once
- [ ] click each menu link — why us, training, membership, about, contact → scrolls to the right section
- [ ] **click a menu link twice → the logo animation should NOT replay each time**
- [ ] membership section shows the plans from plan settings with correct prices
- [ ] all photos load, none broken
- [ ] the grey "to be supplied" tags — note down which ones are still showing
- [ ] member login button → goes to login page
- [ ] staff & owner login at the bottom → goes to login page
- [ ] check it on a phone, the menu, the photos, the text — nothing spilling off the side
- [ ] scroll the whole page on a phone → no sideways scrolling anywhere

---

## 21. phone / app specific

- [ ] install the app on android (add to home screen) → opens like an app
- [ ] install on iphone → same
- [ ] use the app installed, not in the browser → everything still works
- [ ] open the app, lock the phone, come back after 10 minutes → still logged in, doesn't error
- [ ] sidebar opens and closes properly on a phone
- [ ] all popups close properly on a phone, every close button works
- [ ] make an invoice PDF from the installed app on a phone
- [ ] turn off wifi and mobile data, try to do something → shows a proper error, doesn't just hang

## 22. sizes — check on these widths

resize the browser window, or use chrome device toolbar.

- [ ] 1600
- [ ] 1440
- [ ] 1280
- [ ] 1024
- [ ] 768
- [ ] 480
- [ ] 390
- [ ] 375

at each one: no sideways scrolling, no text cut off, no buttons overlapping, tables scroll properly

---

## 23. try to break it on purpose

- [ ] add a member, then hit browser back → doesn't create a duplicate
- [ ] double-click the save button fast → only saves once
- [ ] open the same account on two browsers, change something in one, refresh the other → shows the change
- [ ] type a very long address in settings
- [ ] enter letters in a number field
- [ ] enter a negative amount anywhere it takes money
- [ ] set an expiry date in the past
- [ ] **hard refresh (ctrl+shift+R) while on a deep page like finance or members → page must load, not go blank**
- [ ] do that on every dashboard section
- [ ] leave the app open for an hour, come back and click something → still works or asks you to log in again properly, no silent failure
- [ ] add 50+ members and check the list still loads fast and pages properly

---

## how to report a bug

don't just say "invoice not working". write:

```
where:        members page → member detail → download PDF
what i did:   opened Ramesh Kumar, clicked Download PDF
expected:     PDF downloads
what happened: nothing happens, no error
device:       android phone, chrome
logged in as: owner
screenshot:   attached
```

if it only happens sometimes, say so. if you can make it happen again, write down the exact steps.
