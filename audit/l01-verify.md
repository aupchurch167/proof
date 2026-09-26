# L01 verification (Prompt V)

**Verdict: PASS WITH NOTES**

**Implementation under test:** [PR #25](https://github.com/aupchurch167/proof/pull/25), commit `0d71571`, branch `cursor/l01-requirement-compliance-6c4e`.
**Spec:** `audit/launch-batches.md`, section L01.
**Checked against:** `origin/main` at `6b87de5`.
**Product code changed by this verification:** none.

The badge a contractor sees on the dashboard tiles, the vendor list, and the vendor page follows the requirements switches. Optional lines, the holder switch, the warn window (including 0), and the certificate cap all behave the way L01 describes. The notes below are real disagreements on a few other screens, plus a holder-name rule that will move a lot of badges the first time it runs. Read those before running `server/scripts/recompute-vendor-status.js`.

## Plain-language summary for the owner

The switches on the Requirements page now actually change who looks covered.

- A coverage line you set to $0 is ignored. A line you require still fails the vendor when the amount is missing or too low.
- "Certificate holder must match" is on unless you turn it off. A blank holder, or a holder that does not match your company name, makes that vendor non-compliant. Turning the switch off stops that check.
- The number of days you save replaces the old fixed 30. A certificate that expires inside that window is "expiring." Setting the number to 0 turns "expiring" off. A date that has already passed is still expired.
- Certificates you have removed no longer count against the Free or Starter certificate limit. The ones still on file do.

Three things to know before you run the one-time update:

1. **Names have to line up more carefully than people expect, and also less carefully.** "ACME Construction" matches "acme construction". "Acme Construction, LLC" does not match "Acme Construction LLC" because of the comma. At the same time, a holder that only says "LLC" or even "A" counts as a match for a longer company name that contains those letters. With the switch on by default, the one-time update will mark blank holders, and holders that differ by a comma or an "&", as not compliant.
2. **The vendor badge is the number to trust.** The Monday email's "compliant" count, and the dashboard "needs you" list, still look only at dates. A vendor who fails because the holder is wrong, or a required limit is short, can still be called covered in that email if the expiration date is far away.
3. **The one-time script does not delete certificates or files.** It rewrites the saved badge. The first run sends one "certificate updated" webhook for each vendor whose badge actually changes, and only to that company's webhook addresses. Running it again does not send those again.

Server tests: 27 suites, 322 tests, all passed. The client production build passed.

## What was run

On commit `0d71571`, with a local Postgres database `proof_test` and the existing Prisma migrations applied:

- `npm test` in `server` (Jest, full suite): **27 suites, 322 tests, passed** (15.7s).
- `npm run build` at the repo root (`vite build`): **passed**.
- A direct probe of `evaluateCompliance`, `holderMatches`, `daysUntil`, `coveragesFromCoi`, and `coverageFor` for holder variants, day boundaries, optional lines, and the API-versus-badge split. Results are in the findings.
- An HTTP check with two companies: saving requirements on company A changed only A's vendor, and the webhook went only to A's endpoint. Saving the same settings again sent nothing.
- `GET /api/organization/usage` with one removed certificate and one still on file: the meter counted 1.
- `node scripts/recompute-vendor-status.js` run twice: certificate count and file paths unchanged, badge stable on the second run, webhook attempted only for the company that owned the vendor, and the second run did not deliver again.
- `server/src/index.js` starts the cron jobs only. It does not call the recompute script. `package.json` `start` is `node src/index.js`.

## Findings

### 1. Medium — Holder matching will move real badges, in both directions

`server/src/services/complianceRules.js:52-57` (`holderMatches`), applied at `:142-161` when `requireHolderMatch !== false` (`:92`). The column default is on (`server/prisma/schema.prisma:112`).

The check lowercases and trims the ends of both names, then accepts a match if either name contains the other. It does not ignore commas, periods, ampersands, or repeated spaces inside the name.

Observed with the switch on and the company name as the first value:

| Certificate holder | Company name | Result |
| --- | --- | --- |
| `  ACME CONSTRUCTION  ` | Acme Construction | match |
| `acme construction` | Acme Construction | match |
| `Acme Construction, LLC` | Acme Construction | match (the shorter name sits inside the longer one) |
| `Acme Construction, LLC` | Acme Construction LLC | **no match** |
| `Acme Inc` | `Acme, Inc.` | **no match** |
| `Acme Construction` | `Acme  Construction` (two spaces) | **no match** |
| `Smith and Sons` | `Smith & Sons` | **no match** |
| `Acme` | Acme Construction | match |
| `LLC` | Acme Construction LLC | match |
| `A` | Acme Construction | match |
| blank or spaces | Acme Construction | no match, badge `NON_COMPLIANT` |

With the switch off, a blank holder and a different holder both stay `COMPLIANT` when the coverage lines pass.

This is strict enough to mark many real certificates non-compliant when the only difference is ", LLC" versus "LLC", and loose enough to accept a holder of "LLC" or a single letter. The old code used the same comparison but did not let it change the badge. L01 does, and the switch starts on. The one-time script applies it to every active vendor.

**Reproduce**

```bash
cd server
node -e "
const { evaluateCompliance, holderMatches } = require('./src/services/complianceRules');
const settings = {
  minGeneralLiability: 100000000, minWorkersComp: 50000000,
  minUmbrella: 0, minAutomobile: 100000000,
  requireHolderMatch: true, expiringWindowDays: 30,
};
const now = new Date('2026-09-26T15:00:00Z');
const later = new Date('2026-12-26T00:00:00Z');
const cert = (holder) => ({
  certificateHolderName: holder,
  glCoverageAmount: 200000000, glExpirationDate: later,
  wcCoverageAmount: 100000000, wcExpirationDate: later,
  autoCoverageAmount: 200000000, autoExpirationDate: later,
});
console.log(holderMatches('Acme Construction, LLC', 'Acme Construction LLC'));
console.log(evaluateCompliance(cert('Acme Construction, LLC'), settings, 'Acme Construction LLC', { now }).status);
console.log(evaluateCompliance(cert('LLC'), settings, 'Acme Construction LLC', { now }).status);
console.log(evaluateCompliance(cert('   '), settings, 'Acme Construction LLC', { now }).status);
console.log(evaluateCompliance(cert(null), { ...settings, requireHolderMatch: false }, 'Acme Construction LLC', { now }).status);
"
```

Expected from this run: `false`, `NON_COMPLIANT`, `COMPLIANT`, `NON_COMPLIANT`, `COMPLIANT`.

### 2. Medium — Monday email and the dashboard queue do not use the badge

The vendor badge comes from `evaluateCompliance` (`server/src/services/compliance.js:72`). Dashboard tile counts come from that saved badge (`server/src/routes/reports.js:24-31`, `client/src/pages/Dashboard.jsx:157-164`).

The Monday email does not. `server/src/services/cron.js:430-453` classifies each vendor from the earliest required expiration date only. A future date outside the window increments `compliant`, even when the badge is `NON_COMPLIANT` because the holder is wrong or a required limit is short. A required line with no date at all is counted as "no COI".

The dashboard attention queue has the same split. `server/src/services/complianceOverview.js:148-151` puts a vendor in Expired or Expiring from that date alone. A non-compliant vendor whose dates are far out is in the Gaps tile and absent from the queue. A non-compliant vendor whose date falls inside the window shows up on the expiring list even though the Expiring tile, which reads the badge, does not count them.

L01's spec asked the cron change to cover the expiring-soon bucket, and that bucket does use the saved window and skips optional lines (`cron.js:423`, `cron.js:434-435`). The covered count beside it still tells a different story than the badge. That gap gets wider once holder matching starts failing vendors who have healthy dates.

**Reproduce**

```bash
cd server
node -e "
const { evaluateCompliance, earliestRequiredExpiration, daysUntil, expiringWindowDays, isExpiringSoon } = require('./src/services/complianceRules');
const now = new Date('2026-09-26T15:00:00Z');
const settings = {
  minGeneralLiability: 100000000, minWorkersComp: 50000000,
  minUmbrella: 0, minAutomobile: 100000000,
  requireHolderMatch: true, expiringWindowDays: 30,
};
const coi = {
  certificateHolderName: 'Somebody Else',
  glCoverageAmount: 200000000, glExpirationDate: new Date('2026-12-26T00:00:00Z'),
  wcCoverageAmount: 100000000, wcExpirationDate: new Date('2026-12-26T00:00:00Z'),
  autoCoverageAmount: 200000000, autoExpirationDate: new Date('2026-12-26T00:00:00Z'),
};
const badge = evaluateCompliance(coi, settings, 'Acme Construction', { now }).status;
const earliest = earliestRequiredExpiration(coi, settings);
const days = daysUntil(earliest, now);
const windowDays = expiringWindowDays(settings);
const weekly = days < 0 ? 'expired' : isExpiringSoon(earliest, windowDays, now) ? 'expiringSoon' : 'compliant';
console.log(badge, weekly);
"
```

Expected: `NON_COMPLIANT compliant`.

### 3. Medium — Partner API line status ignores optional lines and dollar minimums

Vendor-level `coi.status` in the API is the saved badge, and the warn window passed into the serializer is the saved window (`server/src/http/serializers.js:113-121`).

Each coverage line is a second rule. `coverageStatus` at `serializers.js:68-72` looks only at the date. `coveragesFromCoi` at `:77-91` includes any line that has an amount, a date, or a policy number, including a line whose minimum is $0. An optional umbrella that expires inside the window is `expiring_soon` on the API while the badge is `COMPLIANT` and the on-screen chips say `skipped` (`server/src/services/coverage.js:29-37`). A line under the dollar minimum with a far-off date is `compliant` on that API line.

**Reproduce**

```bash
cd server
node -e "
const { evaluateCompliance } = require('./src/services/complianceRules');
const { coveragesFromCoi } = require('./src/http/serializers');
const { coverageFor } = require('./src/services/coverage');
const now = new Date('2026-09-26T15:00:00Z');
const settings = {
  minGeneralLiability: 100000000, minWorkersComp: 50000000,
  minUmbrella: 0, minAutomobile: 100000000,
  requireHolderMatch: true, expiringWindowDays: 30,
};
const coi = {
  certificateHolderName: 'Acme Construction',
  glCoverageAmount: 200000000, glExpirationDate: new Date('2026-12-26T00:00:00Z'),
  wcCoverageAmount: 100000000, wcExpirationDate: new Date('2026-12-26T00:00:00Z'),
  autoCoverageAmount: 200000000, autoExpirationDate: new Date('2026-12-26T00:00:00Z'),
  umbCoverageAmount: 500000000, umbExpirationDate: new Date('2026-10-01T00:00:00Z'), umbPolicyNumber: 'UMB',
};
console.log(evaluateCompliance(coi, settings, 'Acme Construction', { now }).status);
console.log(coveragesFromCoi(coi, { windowDays: 30, now }).map(l => l.type + ':' + l.status).join(', '));
console.log(coverageFor(coi, settings, { now }).map(c => c.key + ':' + c.verdict).join(', '));
"
```

Expected: badge `COMPLIANT`; API includes `umbrella:expiring_soon`; chips include `umb:skipped`.

### 4. Low — "Today" and "yesterday" follow UTC midnight, so US evenings flip early

`daysUntil` (`server/src/services/reminders.js:28-29`) is `Math.ceil` of the exact millisecond gap. `isExpiredDate` is `daysUntil < 0` (`complianceRules.js:36-40`). `isExpiringSoon` is `days >= 0 && days <= window` (`:44-49`). A window of 0 never matches.

Checked at `now = 2026-09-26T15:00:00Z`:

| Expiration | Window | daysUntil | Badge effect |
| --- | --- | --- | --- |
| exactly 14 × 24h later | 14 | 14 | expiring |
| 1 ms past that | 14 | 15 | not expiring |
| same UTC calendar day, stored at 00:00Z ("today") | 14 | 0 | expiring, not expired |
| that same "today" | 0 | 0 | compliant (not expired, not expiring) |
| previous UTC day 00:00Z ("yesterday") | 0 or 14 | -1 | expired |

A certificate stored as `2026-09-26T00:00:00Z` is already expired at `2026-09-27T01:00:00Z`, which is 6:00pm Pacific on September 26. For a US company, the certificate drops off during the evening of the printed expiration date, not at local midnight.

**Reproduce**

```bash
cd server
node -e "
const { daysUntil, isExpiredDate, isExpiringSoon, evaluateCompliance } = require('./src/services/complianceRules');
const now = new Date('2026-09-26T15:00:00Z');
const today = new Date('2026-09-26T00:00:00Z');
const yesterday = new Date('2026-09-25T00:00:00Z');
const exact = new Date(now.getTime() + 14 * 86400000);
console.log('today', daysUntil(today, now), isExpiredDate(today, now), isExpiringSoon(today, 14, now), isExpiringSoon(today, 0, now));
console.log('yesterday', daysUntil(yesterday, now), isExpiredDate(yesterday, now));
console.log('day N', daysUntil(exact, now), isExpiringSoon(exact, 14, now));
console.log('day N+1ms', isExpiringSoon(new Date(exact.getTime() + 1), 14, now));
const evening = new Date('2026-09-27T01:00:00Z');
console.log('6pm PT on the expiration date', isExpiredDate(today, evening), evening.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
"
```

### 5. Low — A 30-day color is still hardcoded on the reports table

`client/src/pages/Reports.jsx:19` paints a date yellow when it is within 30 days. That color is not the compliance badge. The expiring report API (`server/src/routes/reports.js:191-234`) uses the saved window and skips lines whose minimum is not above zero. The PR describes the reports-page color as left out on purpose. Grep also finds a display fallback of 30 in `client/src/pages/Dashboard.jsx:93` (`overview?.expiringSoonDays ?? 30`), used only when the overview payload is missing, and a label fallback of 30 in `server/src/services/email.js:203` when the number passed in is not finite. The live Monday job passes the saved window, including 0.

Reminder emails still use `reminderDaysBefore`. That is what L01 said to leave alone. `warnInPeriod` and `retainForPeriod` are still labeled stored and not enforced (`client/src/pages/Requirements.jsx:319-320`).

### 6. Low — Inbound email can still add certificates past the cap

Staff upload, the vendor portal, public apply, and CSV import all go through `evaluatePlanLimit`, which counts `deletedAt: null` (`server/src/middleware/planLimits.js:38-40`). The usage meter uses the same filter (`server/src/routes/organization.js:63`).

`server/src/routes/webhooks.js:147-148` creates a certificate from an inbound attachment and does not call `evaluatePlanLimit`. That path is unchanged by PR #25. A company already at its cap can still grow through emailed PDFs.

There is no route that clears `deletedAt`. Soft-delete is only `softDeleteVendorsAndCois` in `server/src/routes/vendors.js`. A removed certificate cannot be switched back on to sneak past the cap. Rejected and pending certificates still count, which matches the spec (only `deletedAt` is excluded).

**Reproduce:** create one certificate, set `deletedAt`, call `GET /api/organization/usage`. This run returned `cois.used: 1` after a second, non-deleted certificate existed, and `evaluatePlanLimit` returned `current: 0` when the only certificate was soft-deleted (cap mocked to 1).

### 7. Low — CSV import's compliance check drops the holder

`server/src/routes/import.js:316-327` calls `checkCompliance` without `certificateHolderName` and without policy numbers. The CSV template has no holder column (`server/src/utils/csv.js:100-118`). With the switch on, every row that asks for a compliance check is flagged for a missing holder. The import still saves the row as `PENDING` (`import.js:338-341`) rather than writing the badge. After someone approves it, the blank holder fails the badge, which is the rule. The flag at import time cannot be cleared by a holder column, because there isn't one.

The reports CSV export (`client/src/pages/Reports.jsx` `exportCsv`) writes certificate fields and review status. It does not recompute the vendor badge.

### 8. Low — A holder failure has no explanation on the vendor page

Chips use the shared line rule and do not know about the holder (`coverageFor`). `coverageReason` (`server/src/services/coverage.js:77-85`) only mentions a missing, short, or expired line. The vendor list copies that into `statusReason` (`server/src/routes/vendors.js:98`). The vendor page prints it (`client/src/pages/VendorDetail.jsx:183`). When every required line is fine and the holder is blank or different, the pill says non-compliant and the reason is empty.

### 9. Low — The one-time script is safe to re-run, and it does send webhooks the first time

`server/scripts/recompute-vendor-status.js` loads active vendors only (`deletedAt: null`, lines 23-27) and calls `updateVendorStatus`. It does not delete rows. It is not imported from `server/src/index.js:19-21`.

Checked on the test database:

- First run changed a vendor from a stale `COMPLIANT` to `NON_COMPLIANT` (blank holder, switch on) and attempted delivery only to that company's endpoint. The other company's endpoint stayed untouched (`lastDeliveryStatus` remained null).
- Second run left the badge at `NON_COMPLIANT` and did not deliver again.
- Certificate count stayed the same. `pdfPath` stayed `files/keep.pdf`. `deletedAt` stayed null.

`updateVendorStatus` also fulfills open COI requests and mirrors status to Core on every call, including a second run where the badge did not change (`server/src/services/compliance.js:85-97`). That is a write, not a delete.

Saving requirements re-checks `where: { orgId: req.user.orgId }` only (`server/src/routes/requirements.js:187-193`). In the two-company HTTP check, company A's save marked A's blank-holder vendor `NON_COMPLIANT`, left A's other vendor `COMPLIANT`, left company B's vendor `COMPLIANT`, and posted one `coi.updated` to `https://example.com/a`. A repeat save posted nothing.

## Checks that passed

- One function, `evaluateCompliance` in `server/src/services/complianceRules.js`, produces the badge. `checkCompliance` returns its flags. Coverage chips call `verdictForLine` from that same file. Dashboard tile counts read the badge. The expiring report, the overview's expiring bucket, and the Monday expiring bucket use `expiringWindowDays` / `isExpiringSoon` / `earliestRequiredExpiration` from that file rather than a literal `days <= 30`.
- Optional minimum `0` (and any minimum that is not above zero) is `skipped` and cannot set `NON_COMPLIANT`. A required line with no amount, no date, and no policy is `MISSING`. A required amount below the minimum is `INSUFFICIENT`. An amount equal to the minimum passes.
- Warn window 14 versus 45 changes who is `EXPIRING_SOON`. Window 0 does not use `EXPIRING_SOON`. A past date is `EXPIRED` at window 0. The day-N boundary is inside the window; 1 ms past it is outside.
- One required line that has already lapsed sets the vendor to `EXPIRED` even when another required line is still in force (`complianceRules.js:172-173`). The PR discloses this. It is the right reading of "a required line that has lapsed fails," and it will move badges that used to stay compliant because every date had to be past.
- Soft-deleted certificates are excluded from the cap helper, portal upload, apply, import, staff upload, and the usage meter. No product route sets `deletedAt` back to null.
- L01 does not delete certificate rows or files. `git diff 6b87de5..0d71571` does not touch `deleteFile` or `prisma.coi.delete`. The existing `DELETE /api/cois/:id` still hard-deletes the row and the file (`server/src/routes/cois.js:318-325`). That behavior is unchanged and belongs to L10, not this batch.

## Recommendation

Merge PR #25. Before the one-time script in production, turn holder matching off for any company that has not reviewed how their name is stored, or expect blank holders and ", LLC" versus "LLC" to become gaps. Treat the vendor badge and the Gaps tile as the compliance answer. Treat the Monday email's covered count as a date count until it calls `evaluateCompliance`.
