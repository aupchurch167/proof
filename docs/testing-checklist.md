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

## Notifications

- [ ] Weekly compliance email sends on Monday
- [ ] Invite user email sends correctly
- [ ] Invited user can accept invite and set password

## Permissions

- [ ] MEMBER user cannot access Organization Settings
- [ ] MEMBER user cannot access Billing
- [ ] MEMBER user cannot access User Management

## Plans & Limits

- [ ] Free plan shows limit warning at 20 vendors

## Responsive & Infrastructure

- [ ] Mobile layout looks correct on 375px screen width
- [ ] HTTPS redirect works on app.proofcoi.com
