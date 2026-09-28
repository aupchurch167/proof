# PR 27 verification (Prompt V)

**Final verdict: FAIL**

**Implementation under test:** [PR #27](https://github.com/aupchurch167/proof/pull/27), commit `b428d4f` (`Cap the free plan at 10 vendors and store signup UTMs.`), branch `cursor/free-plan-utm-signup-ee6f`.
**Checked against:** `origin/main` at `8e5f3f6`.
**Product code changed by this verification:** none. This branch only adds this note.

The free-plan number, the copy, the over-limit behavior, and signup attribution match the PR on a single request. Parallel requests do not. A burst that all read the live count before any insert commits can create as many vendors as it fires. On a free organization that started at zero, 20 parallel adds created 20 vendors and none were rejected. Two overlapping CSV imports created 20. Six overlapping public applications, starting from 9 vendors, created 6 more (15 live). That is the failure. Signup UTMs, the migration, and the certificate caps held.

Line numbers below are from `b428d4f`.

## What was run

- `npm test` in `server` against PostgreSQL 16 (`proof_test`, `PROOF_TEST_DB=1`): **28 suites, 340 tests, passed** (25.4s).
- `npm run build` in `client` (`vite build`): **passed** (`dist/assets/index-BSzVSXcz.js`, `dist/assets/index-BsbMhFB7.css`).
- `npx prisma migrate deploy` on an empty database (`proof_fresh`): **20 migrations applied**, including `20260928000000_add_signup_attribution`. A second deploy reported **no pending migrations**.
- An HTTP probe (not committed) against that fresh database: sequential and parallel vendor creates, CSV import, public apply, soft-delete, Starter, Unlimited, inbound email, signup and Google attribution, organization update, and cross-tenant reads.
- A Node run of `client/src/utils/signupAttribution.js` with a fake `sessionStorage`, covering bracket-array query strings, duplicate keys, length, and the sign-in link round trip.

`FREE.maxCois` is still 100, `STARTER.maxCois` is still 500, and `UNLIMITED.maxCois` is still unlimited. Versus `8e5f3f6`, `server/src/config/plans.js` changes `FREE.maxVendors` from 20 to 10 and adds `vendorLimitReachedMessage`. The certificate numbers are the same lines as before.

## Findings

**1. Medium — The free-plan cap is a check followed by a later insert, so parallel requests all succeed.**

`server/src/middleware/planLimits.js:16-19` counts live vendors (`deletedAt: null`) and returns 403 when `count >= limits.maxVendors`. `server/src/routes/vendors.js:117` runs that check in middleware, then `server/src/routes/vendors.js:125` inserts the row. `server/src/routes/apply.js:82-88` does the same check, then `server/src/routes/apply.js:137` inserts. `server/src/routes/import.js:109-111` counts once per request, and `server/src/routes/import.js:143-168` inserts and bumps an in-memory counter. Nothing wraps the count and the insert in one transaction or an advisory lock. Each in-flight request that still sees a count under 10 inserts a row.

One request stays at 10. Overlapping requests do not share that view.

Reproduce on a FREE organization with an admin token (distinct emails, fired together):

- 20 parallel `POST /api/vendors` from 0 live vendors. This run: **20 responses were 201, 0 were 403, live count 20.**
- 8 parallel `POST /api/vendors` with 9 vendors already on file. This run: **8 responses were 201, live count 17.**
- Two parallel `POST /api/import/vendors`, each CSV 12 new rows, starting from 0. This run: **each response `created: 10`, live count 20.**
- 6 parallel `POST /api/apply/:slug` with 9 live vendors. This run: **6 responses were 201, live count 15.**

The same three paths reject further creates once a count of 10 or more is visible. 8 parallel adds against an organization that already had 10 live vendors were all 403, and the live count stayed 10. The hole is the burst that crosses the line, and that burst is uncapped: every request that read a count under 10 inserted one vendor. A single CSV of 25 rows from 0 created 10 and skipped 15, so bulk import holds only when it is one request.

This shape was already how the old cap of 20 worked. This PR changes the number and the message. The cap it describes is still bypassed by two tabs importing at once, or by parallel `POST /api/vendors`.

**2. Low — A numeric UTM is stored, while every other non-string is dropped.**

`server/src/lib/signupAttribution.js:15-16` accepts a finite number and stores `String(value)`. The PR says empty or non-string values are stored as null. Arrays, objects, and booleans are null. Numbers are not.

Reproduce: `POST /api/auth/signup` with `utm_campaign: 99` and `utm_source: ["a","b"]`. This run stored `utmCampaign` `"99"` and `utmSource` null. Signup still returned 201.

**3. Low — Public apply's JSON still names the plan and the cap.**

`server/src/routes/apply.js:84-86` replaces `error` and spreads the rest of the plan-limit body. The sentence shown to the applicant is `This organization has reached its vendor limit. Please contact them to resolve this.` That sentence does not say "Free" or "10". The same JSON includes `plan: "FREE"`, `limit: 10`, and `current: 10`.

Reproduce: FREE organization with 10 live vendors, `POST /api/apply/:slug` with name, email, phone, and address. This run returned 403 with that sentence and those three extra fields. No vendor was created.

## What held

### Vendor cap, one request at a time

`server/src/config/plans.js:4` sets `FREE.maxVendors` to 10. Starter is 50 (`plans.js:8`). Unlimited is `Infinity` (`plans.js:12`).

- `GET /api/auth/config` returned `freeVendorLimit: 10`.
- `GET /api/organization/usage` on a free organization returned `vendors.limit: 10`.
- One CSV of 25 new rows created 10, skipped 15, and each skip used `The Free plan includes 10 vendors, and this account is already at that limit. Your existing vendors stay on file. Contact us when you need room for more.` (`plans.js:33-34`, used by `import.js:146`).
- The next `POST /api/vendors` was 403 `PLAN_LIMIT_EXCEEDED` with `limit: 10` and `current: 10`. The live count stayed 10. Nothing was deleted.
- An organization seeded with 12 live vendors listed all 12 (`GET /api/vendors` length 12). Usage was `used: 12`, `limit: 10`, `percent: 100`. Another add was 403. The 12 rows were still live.
- 9 live vendors plus 4 soft-deleted: the 10th add returned 201. The next returned 403. `PUT /api/vendors/:id` on a soft-deleted id, with `deletedAt: null` in the body, returned 404. `deletedAt` was still set. There is no route that clears `Vendor.deletedAt`.
- Public apply with 9 live vendors returned 201 and the live count became 10. Apply with only soft-deleted vendors returned 201 (those rows do not count).
- Starter with 50 live vendors: the next add was 403, `limit: 50`, message contains "Starter". Starter with 11 live vendors: the next add was 201.
- Unlimited: 12 parallel adds all returned 201.
- Inbound `POST /api/webhooks/resend-inbound` (`email.received`) does not insert a vendor. An unknown sender was `matched: 0`. A sender matched to an existing vendor on a full free account was `matched: 1`, and the live vendor count stayed 10. `server/src/routes/webhooks.js:124-191` can create a certificate for that vendor; it does not create a vendor. Staff and portal upload call `evaluatePlanLimit` for certificates (`vendors.js:386`, `portal.js:135`), which is the certificate cap, and they do not insert vendors.

Copy, from the API value rather than a second hardcoded 10:

- Signup: `Free forever for up to ${freeVendorLimit} vendors.` (`client/src/pages/Signup.jsx:84`).
- Settings, free plan: `Free forever for up to {usage.vendors.limit} vendors.` and, when `used > limit`, `This account already has more than that. Every vendor stays on file.` (`client/src/pages/Settings.jsx:323-328`).
- Vendors page, at or over the cap, uses the same free-plan sentence as the API (`client/src/pages/Vendors.jsx:317-321`). The list itself is the full `GET /api/vendors` result.
- Sidebar still prints `used / limit` (`client/src/components/Layout.jsx:135`).
- `docs/testing-checklist.md:74` says the warning is at 10 vendors.

A search of `client/src`, `server/src`, `docs/`, and the production bundle found no "20 vendors" string. `audit/verification/B03.md` still describes an older probe at 20 vendors. `server/tests/vendors.test.js:313` still stubs `maxVendors: 20` so a certificate-cap test is not blocked by the vendor cap. Neither is product copy.

### Signup UTMs

Migration `server/prisma/migrations/20260928000000_add_signup_attribution/migration.sql` is five `ADD COLUMN` statements and one `CREATE INDEX`. On the fresh database the columns `utmSource`, `utmMedium`, `utmCampaign`, `utmTerm`, and `utmContent` are nullable `text` with no default. `createdAt` was already `NOT NULL` with `CURRENT_TIMESTAMP`. Index `Organization_utmSource_createdAt_idx` is btree (`utmSource`, `createdAt`), matching `server/prisma/schema.prisma:83-87` and `:101`. No backfill. Existing rows stay null because the columns are nullable.

`server/src/lib/signupAttribution.js:14-27` trims, maps C0 controls and zero-width characters to spaces, strips `<` and `>`, collapses whitespace, and cuts to 128 Unicode code points after NFKC. Empty results are omitted, so the column stays null.

Checked through `POST /api/auth/signup` and `POST /api/auth/google`:

- No UTM fields: 201, all five columns null, `createdAt` set.
- `  <script>alert(1)</script>  ` stored as `scriptalert(1)/script`. `<img src=x onerror=alert(1)>` stored as `img src=x onerror=alert(1)`. Fullwidth `\uFF1Cscript\uFF1E` stored as `scriptalert(1)/script`. No stored value contained `<` or `>`.
- `line\nbreak` plus a null byte stored as `line break tail`. 200 emoji stored at length 128. A 5000-character string stored at length 128.
- `utm_source: ["a","b"]` and `utm_medium: { nested: true }` stored null. `utm_term: true` stored null.
- Camel-case `utmSource` on the body was ignored. `utm_source: "snake-ok"` was what landed in the column.
- `plan: "UNLIMITED"` on signup returned 400 `plan cannot be set` and created no user (`server/src/utils/validation.js:3` and `:108-117`).
- Signup again with the same email, plus new UTM fields, returned 201 and left the existing organization at `utmSource: "original"`.
- Google signup stored `utm_source` / `utm_medium`. A second Google sign-in for the same account, sending `utm_source: "other"` and `utm_campaign`, left the row at `greateratl` / `partner` with `utmCampaign` still null (`server/src/routes/auth.js:234-248` writes attribution only inside `organization.create`).
- Google sign-in that links an existing password user left that organization's UTM columns null.
- `PUT /api/organization` with `utmSource`, `utm_source`, `plan: "UNLIMITED"`, and the other organization's id updated the name only. Plan stayed `FREE`. UTM columns stayed as they were. The other organization's name and `utmSource` stayed as they were (`server/src/routes/organization.js:29-36`).
- `PUT /api/settings` with `utmSource` and `utm_source` returned 200 and did not change the organization row.
- `GET /api/organization` returned the caller's row, including that caller's `utmSource`. `GET /api/organization?id=<other>` still returned the caller's row. `GET /api/apply/:slug` returned `name` and `slug` only.
- A UTM value of `'; DROP TABLE "Organization"; --` was stored as text and the signup returned 201. The table was still there afterward.
- The signup page keeps the five query params in `sessionStorage` and appends them to the sign-in link (`client/src/utils/signupAttribution.js:30-58`, `client/src/pages/Signup.jsx:22` and `:142`, `client/src/pages/Login.jsx:18` and `:74`). A round trip through `signupUtmSearch()` preserved all five. A later visit with only `utm_medium` kept the earlier `utm_source`. `utm_source=a&utm_source=b` kept `a`. `utm_source[]=a&utm_source[]=b` did not set `utm_source` (the key is `utm_source[]`, which this code does not read). Clearing storage removes them.

The client sanitizer (`client/src/utils/signupAttribution.js:9-13`) is thinner than the server: it deletes C0 controls instead of turning them into spaces, and it leaves `<`, `>`, and zero-width characters in `sessionStorage`. The server runs again before insert, which is why the stored script payload has no tags. The values are not rendered anywhere in `client/src` (the only `utm_` matches are the capture helper). U+202E (right-to-left override) is not in the server's strip set, so `safe\u202Eevil` is stored with that character still in it. Nothing in the app prints the column.

## Recommendation

The cap number, the copy, the "keep everyone already over 10" behavior, and signup attribution match the request on a single request. The cap is not enforced against parallel adds, parallel CSV imports, or parallel public applications. Treat the vendor cap as open until the count and the insert share a lock or run in one transaction on all three paths (`planLimits.js`, `apply.js`, `import.js`). The UTM notes above are separate and small.
