# Proof Manual UI Testing Checklist

## Authentication

- [ ] Login with valid credentials
- [ ] Login with invalid credentials shows error
- [ ] Signup creates new org and admin user

## Vendor Management

- [ ] Create a vendor
- [ ] Edit a vendor
- [ ] Delete a vendor with DELETE confirmation
- [ ] Bulk select and delete vendors
- [ ] Bulk COI request from vendor list

## COI Upload & Management

- [ ] Upload a COI via drag and drop in vendor detail view
- [ ] Request COI email sends successfully
- [ ] COI request email contains requesting company info
- [ ] COI data is extracted and saved correctly
- [ ] View PDF opens COI in new tab
- [ ] COI expiration dates show correctly per coverage type

## Vendor Portal

- [ ] Vendor portal link opens correctly
- [ ] Vendor portal invalid link shows helpful message
- [ ] Vendor uploads COI via portal

## Dashboard & Search

- [ ] Dashboard stat cards filter vendor list on click
- [ ] COI list search by vendor name works
- [ ] COI list filters by coverage type and date range

## Export

- [ ] Export PDFs merges and downloads correctly
- [ ] Export CSV downloads correctly

## Compliance Cockpit

- [ ] /compliance loads and opens on the first bucket with work in it
- [ ] Bucket tiles switch the list and the counts match the rows shown
- [ ] Each bucket is sorted most-urgent-first
- [ ] Request COI from the cockpit sends and refreshes the list
- [ ] Mark contacted removes the vendor from Ignored Requests
- [ ] Vendors with a placeholder email show the "No valid email" badge and a disabled Request COI button
- [ ] Escalated badge appears for requests ignored past the last follow-up day

## Notifications

- [ ] Weekly compliance email sends on Monday
- [ ] Invite user email sends correctly
- [ ] Invited user can accept invite and set password
- [ ] Expiration reminder fires for a COI already inside a window (e.g. 27 days out), not only on the exact day
- [ ] Each reminder window sends at most once per COI
- [ ] Non-responder follow-ups send at 3 / 7 / 14 days after a COI request
- [ ] Uploading a COI stops the follow-ups
- [ ] Sending a new COI request restarts the follow-up ladder
- [ ] Reminder and follow-up emails carry a working portal link for vendors imported from Airtable
- [ ] Follow-up days are editable in Settings and take effect

## Permissions

- [ ] MEMBER user cannot access Organization Settings
- [ ] MEMBER user cannot access Billing
- [ ] MEMBER user cannot access User Management

## Plans & Limits

- [ ] Free plan shows limit warning at 20 vendors

## Responsive & Infrastructure

- [ ] Mobile layout looks correct on 375px screen width
- [ ] HTTPS redirect works on app.proofcoi.com
