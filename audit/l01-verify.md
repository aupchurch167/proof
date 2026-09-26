# L01 verification (Prompt V)

**Final verdict: PASS WITH NOTES**

**Implementation under test:** [PR #25](https://github.com/aupchurch167/proof/pull/25), commit `8fcd64a` (second follow-up, on top of `2ad214c` and `0d71571`), branch `cursor/l01-requirement-compliance-6c4e`.
**Spec:** `audit/launch-batches.md`, section L01.
**Checked against:** `origin/main` at `6b87de5`.
**Product code changed by this verification:** none.

The second follow-up makes a legal suffix optional and ignores the usual certificate boilerplate after the company name. "Acme Construction, LLC" matches "Acme Construction". Ltd matches Limited. A street number, ISAOA/ATIMA, "d/b/a", or "its subsidiaries" after the name is ignored, including when the name is on a later line of the holder block. "Acme Construction Services" does not match "Acme Construction", and "Smith Plumbing Supply" does not match "Smith Plumbing". A name in the middle of a line, or tucked inside another word, does not match. The vendor page now says why a holder failed, and it escapes that text. Server tests: 27 suites, 329 passed. Client production build passed.

One clause still fails on real certificates: "AND/OR ISAOA/ATIMA" written on the company-name line. A few address words ("floor", "FL", "suite", "unit") also cut the comparison short, so a longer different name that starts with those words can match. Details are in the second re-verify section. The sections below it are the record of `2ad214c` and `0d71571`.

## Re-verify (commit `8fcd64a`)

Follow-up commit `8fcd64a` ("L01 follow-up: loosen holder matching and explain it on the vendor page"). Re-checked on that commit. No product code was changed by this review. The diff is five files: `complianceRules.js`, `coverage.js`, `vendors.js`, `VendorDetail.jsx`, and `compliance.test.js`.

### What was run

- `npm test` in `server`: **27 suites, 329 tests, passed** (15.3s). One test was added since `2ad214c` ("shows the holder text and other failures on the vendor page").
- `npm run build` (`vite build`): **passed** (`dist/assets/index-CDwMtk2y.js`).
- A direct probe of `holderMatches`, `holderDetailReason`, and `evaluateCompliance`: about 100 holder strings, including shared prefixes, mid-line names, a match that exists only on a later line, names of one to three characters, Ltd/Limited, and ACORD 25 holder blocks.
- React `renderToStaticMarkup` of the vendor-page paragraph with a holder that contains `<img onerror>` and `<script>`.
- The follow-up diff does not touch `planLimits.js`, `requirements.js`, `webhooks.js`, `cois.js`, `webhookDispatcher.js`, `import.js`, or `server/scripts/recompute-vendor-status.js`. `server/src/index.js` still starts cron only and does not load the script. The full suite, which covers caps, tenant-scoped requirement saves, and webhook delivery, passed on this commit.

### Holder matching

`holderMatches` (`server/src/services/complianceRules.js:147-152`) splits the holder on newlines and accepts the certificate when any line starts with the company's name. Trailing legal suffixes are removed from the company name before that comparison (`stripTrailingSuffixes`, lines 109-112). After the name, `remainderIsExtra` (lines 125-132) allows another suffix, a token that starts with a digit, a word in `TRAILING_STARTERS` (lines 68-71), or the words "and its".

Checked pairs that must stay apart, and did:

- "Acme Construction Services" versus "Acme Construction", with or without LLC / Inc on either side.
- "Smith Plumbing Supply" versus "Smith Plumbing", including "Smith Plumbing Supply Co".
- "Acme Constructional", "AcmeConstruction LLC", and "Holdings of Acme Construction LLC" versus "Acme Construction".
- "Additional Insured: Acme Construction LLC" and "Jones Electric and Acme Construction LLC" (same line) versus "Acme Construction".
- "Company Store" versus "Co Store". The old rewrite of "company" in the middle of a name is gone.
- "The Acme Construction LLC" and "The Home Depot" versus the name without "The".
- A shorter holder versus a longer company: "Smith Plumbing" versus "Smith Plumbing Supply", "Acme" versus "Acme Construction".

Checked pairs that should match, and did:

- Suffix optional on either side: "Acme Construction, LLC" matches "Acme Construction", and the reverse.
- Ltd and Limited, Inc and Incorporated, Co and Company, Corp and Corporation, "L.L.C.", "&" and "and", apostrophes, "A.B.C." and "ABC".
- A later line only: "Jones Electric LLC\\nAcme Construction LLC" matches "Acme Construction". It also matches "Jones Electric", because each line is tried on its own. A certificate that names two companies, one per line, satisfies either of those companies.
- A label on its own line, then the name: "CERTIFICATE HOLDER\\nAcme Construction, LLC" and "Additional Insured\\nAcme Construction, LLC\\n123 Main".
- Realistic blocks with the name on its own line: "PROOF CONSTRUCTION, LLC" / "ISAOA/ATIMA" / "100 Congress Ave, Suite 200" / "Austin, TX 78701" matches "Proof Construction". The same shape with "PO Box", "P.O. Box", "Suite", "Attn:", "d/b/a Ace Builders", and "its subsidiaries and affiliates" matches. "d/b/a Ace Builders" does not match "Ace Builders".
- A blank holder, whitespace, or null still fails while the switch is on (`NON_COMPLIANT`). The same blank holder passes when the switch is off (`COMPLIANT`).

### Findings

**1. Medium — "AND/OR ISAOA/ATIMA" on the name line does not match.** `remainderIsExtra` (`complianceRules.js:131`) treats "and" as boilerplate only when the next word is "its". "and/or" becomes the tokens "and" and "or", so the line fails.

Reproduce with `holderMatches` (both return false, and `evaluateCompliance` returns `NON_COMPLIANT` when General Liability is otherwise ample):

- Holder `Acme Construction, LLC and/or ISAOA/ATIMA`, company `Acme Construction`.
- Holder `ACME CONSTRUCTION LLC AND/OR` on the first line, then `ISAOA/ATIMA` and `123 MAIN STREET`, company `Acme Construction`.
- The same failure for "and/or its subsidiaries".

A name line with nothing after it, and ISAOA on the next line, matches. So does "Acme Construction LLC ISAOA/ATIMA" with no "and/or", and "Acme Construction, LLC, its subsidiaries and affiliates". The miss is the "and/or" conjunction, which is a common way the certificate-holder box is filled in.

**2. Low — A few boilerplate words end the comparison immediately, so a different company can match.** `TRAILING_STARTERS` (`complianceRules.js:68-71`) includes `floor`, `fl`, `suite`, `unit`, `ste`, `apt`, `its`, `po`, and `attn`. Line 130 returns a match as soon as one of those words appears, and ignores everything after it.

Reproduce (`holderMatches` true, status `COMPLIANT` with an ample limit):

- "Acme Construction Floor Care LLC" versus "Acme Construction".
- "Acme Construction FL LLC" and "Smith Plumbing FL" versus the name without "FL".
- "North Suite LLC" versus "North". "Smith Floor Designs" versus "Smith".

"Acme Construction Flooring LLC" does not match, because the token is "flooring", not "floor". "Acme Construction Florida LLC" does not match. The shared-prefix cases in the request ("Services", "Supply") do not match.

**3. Low — The same words with a different legal suffix match.** Suffixes are stripped from both sides (`SUFFIX_OF`, `complianceRules.js:54-64`). That is what makes "Acme Construction, LLC" match "Acme Construction". It also makes "Acme Construction, Inc." match "Acme Construction LLC", "Acme Ltd" match "Acme LLC", and "Baker Co" match "Baker Inc". Those are different entities. PLLC, LP, LLP, and PC are not in the suffix list, so "Acme Construction LP" still fails against "Acme Construction".

**4. Low — A company core shorter than three characters never matches.** `isBareOrFragment` (`complianceRules.js:115-119`). Exact "GE" versus "GE", "G.E." versus "GE", "3M" versus "3M", and "3M Company" versus "3M Company" are all non-matches. Stripping the trailing word "Company" leaves "3m", which is still too short. "IBM" and "ABC" match. "AA Plumbing" matches "AA Plumbing".

**5. Low — A few realistic tails are still a mismatch.** Same function, lines 125-132.

- "subsidiaries" or "and subsidiaries" without the word "its" fails. "its subsidiaries" and "and its subsidiaries" match.
- "Acme Construction c/o Risk Management" fails. "c/o" collapses to the token "co", which is eaten as a suffix, and "Risk" is then treated as a different company.
- "Acme Construction, Austin, TX 78701" on one line fails, because "Austin" is not an address marker. The same city on the next line matches, because the name line itself is exact. "One Congress Avenue" on the same line as the name fails; a line break before "One Congress Avenue" matches.
- "(a Texas limited liability company)" after the name fails.

The extractor is still told to put the entity name and the address in separate fields (`server/src/services/coiExtractor.js:195-196`). These tails matter when the model leaves them in `certificateHolderName`.

### Vendor page reason

`GET /api/vendors/:id` builds `statusReason` from `holderDetailReason` plus every failed coverage line (`server/src/routes/vendors.js:247-259`). A mismatch reads `Certificate holder doesn't match your company name (found: …)`, with newlines in the holder collapsed to ` / ` (`complianceRules.js:297-310`). A blank holder reads `Certificate holder name is missing`. The new test stores "Somebody Else LLC" and a short general-liability limit and expects both phrases in the response. That test passed.

The page renders that string as a text child of a paragraph (`client/src/pages/VendorDetail.jsx:186-187`). There is no `dangerouslySetInnerHTML` on this page. Rendering the same paragraph with React's server renderer, using a holder of `Acme <img src=x onerror=alert(1)>` plus a `<script>` tag, produced `&lt;img` and `&lt;script`. The raw tags were not in the HTML. Quotes became `&quot;` and `&` became `&amp;`.

The vendor list still copies only the first coverage-chip sentence (`vendors.js:99`). A holder-only failure can show "Non-compliant" in the list with an empty reason. The dashboard queue still uses the shorter `complianceIssue` text ("Certificate holder does not match") and does not include the holder body. Any reason on the detail page, including an expiring line, uses the red `text-bad-text` class.

### Spot-check

Caps still count `deletedAt: null` (`server/src/middleware/planLimits.js:39`). `DELETE /api/cois/:id` still hard-deletes the row and the file (`server/src/routes/cois.js:320-323`); that path is unchanged and is L10. The recompute script is still absent from boot. Unchanged residuals from the earlier passes: inbound email can create a certificate without the cap check; the reports table still colors dates at 30 days; CSV import still omits the holder; webhook `expiresAt` still uses the earliest date on any line; a required line with no amount, date, or policy is still omitted from partner-API `coverages[]` while the vendor badge follows the shared rule.

### Recommendation

Merge PR #25. The prefix cases that were likely to mark the wrong company compliant do not. Before the one-time script, know that a holder line ending in "and/or ISAOA/ATIMA" will come back non-compliant even when the company name is right, and that "Floor", "FL", "Suite", or "Unit" immediately after the name will be treated as boilerplate.

## Re-verify (commit `2ad214c`)

This section is the record of `2ad214c`. The suffix-on-both-sides warning in it is superseded by the `8fcd64a` re-verify above.

Follow-up commit `2ad214c` ("L01 follow-up: align holder names, weekly email, queue, and API lines"). Re-checked on that commit. No product code was changed by this review.

### What was run

- `npm test` in `server`: **27 suites, 328 tests, passed** (14.5s). Six tests were added since `0d71571`.
- `npm run build` (`vite build`): **passed**.
- A direct probe of `holderMatches`, `evaluateCompliance`, and `coveragesFromCoi` for suffix variants, shared roots, blank holders, optional lines, and short limits.
- A two-company HTTP save: only the saving company's vendors were recomputed, webhooks went only to that company's endpoint, and saving the same settings again sent nothing.
- Usage meter with one removed certificate and one still on file: `cois.used` was 1.
- `node scripts/recompute-vendor-status.js` twice: certificate count stayed 5, file paths and `deletedAt` were unchanged. `server/src/index.js` still does not reference the script. The follow-up diff does not touch `planLimits.js`, `requirements.js`, `webhooks.js`, `cois.js`, or the recompute script.

### The three notes

**1. Holder normalization — fixed, with a deliberate strict edge.** `normalizePartyName` and `holderMatches` in `server/src/services/complianceRules.js:70-112`.

Punctuation, case, repeated spaces, `&` versus "and", and suffix spelling match: "Acme Construction, LLC" matches "Acme Construction LLC" and "Acme Construction, L.L.C."; "Acme, Inc." matches "Acme Incorporated"; "Smith & Sons" matches "Smith and Sons"; "Baker Co" matches "Baker Company"; "Best Corp." matches "Best Corporation".

A blank holder still fails while the switch is on, and passes when it is off. "LLC", "Inc.", and "A" do not match a longer company name. "Acme" does not match "Acme Construction". "Smith Plumbing" does not match "Smith Plumbing LLC" or "Smith Plumbing Inc", and "Smith Plumbing LLC" does not match "Smith Plumbing Inc". "Baker Co" does not match "Baker Corp". Those shared-root pairs are not false positives.

The suffix stays part of the name (`complianceRules.js:52-53`). Their test locks this in (`server/tests/compliance.test.js:405`): "Acme Construction, LLC" versus "Acme Construction" is a non-match. A company that stores its name without the legal suffix, while every certificate includes ", LLC", will come back non-compliant. That is the remaining false negative that will show up in real data. Extra words also fail: a street address, "ISAOA/ATIMA", or "d/b/a" on the holder line does not match the bare company name. The extractor is told to put the entity name and the address in separate fields (`server/src/services/coiExtractor.js:195-196`), so this is safe when extraction follows that split.

Smaller leftovers, not enough to reject the rule:

- "Ltd" does not match "Limited", and "PLLC" does not match "LLC" (`complianceRules.js:54-62` only folds llc/inc/incorporated/co/company/corp/corporation).
- A name of one or two characters never matches, including an exact "GE" versus "GE" (`isBareOrFragment`, `complianceRules.js:102-104`). "IBM" does match.
- The word "company" is rewritten wherever it sits, not only as a trailing suffix, so "Company Store" matches "Co Store".

**2. Weekly email and the attention queue — fixed.** `runWeeklySummary` calls `evaluateCompliance` (`server/src/services/cron.js:460`) and counts a holder mismatch or a short limit as `nonCompliant`, not covered. The email adds a "Not compliant" row and prints that reason (`server/src/services/email.js`). The dashboard queue lists `overview.buckets.nonCompliant` first, with `statusReason` from `complianceIssue` (`client/src/pages/Dashboard.jsx:102-109`, `server/src/services/complianceOverview.js:163-170`). A covered vendor with a far-off date stays out of that list. The new tests in `server/tests/compliance.test.js` ("counts a holder mismatch and a short limit as non-compliant") passed.

**3. Partner API lines — fixed for the case that was asked.** `coveragesFromCoi` (`server/src/http/serializers.js:90-120`) uses `verdictForLine`. A $0 minimum is omitted, including when that line expires soon. A required amount under the minimum is `expired`, which is the same public word `mapCoiStatus` uses for `NON_COMPLIANT`. `expiresAt` on the vendor and on historical certificates uses the earliest required line, not an optional one (`coverageExpiresAt`, `serializers.js:123-126`). The new API test passed.

A required line with no amount, no date, and no policy is still left out of `coverages[]` (`serializers.js:97`) rather than listed as not acceptable. The vendor-level status still follows the badge. That is a smaller gap than a short limit being called compliant.

### Spot-check of the earlier checks

On this commit, saving requirements for company A with the holder switch on marked A's blank-holder vendor `NON_COMPLIANT`, left A's matching vendor `COMPLIANT`, and did not recompute company B. Two `coi.updated` posts went to A's endpoint only (one per vendor whose badge changed from the default). A second identical save sent nothing. The usage meter ignored the soft-deleted certificate. The recompute script did not delete rows or change file paths.

Unchanged from the first pass, and not part of this follow-up: inbound email can still create a certificate without the cap check (`server/src/routes/webhooks.js:148`); `DELETE /api/cois/:id` still hard-deletes a row and its file (`server/src/routes/cois.js:318-325`, L10); the reports table still colors dates at 30 days (`client/src/pages/Reports.jsx:19`); CSV import still omits the holder when it flags a row (`server/src/routes/import.js:316-327`); the vendor page reason still comes from coverage chips, so a holder-only failure can show "Non-compliant" with no explanation there (`server/src/routes/vendors.js:98` and `:251`) even though the dashboard queue now explains it; webhook `expiresAt` still uses the earliest date on any line (`server/src/services/webhookDispatcher.js:97`).

### Recommendation (commit `2ad214c`, superseded)

This recommendation applied to `2ad214c` only. The current recommendation is in the `8fcd64a` re-verify above. At this commit, the advice was: store each company name the way it appears on the certificate, including LLC / Inc / Corp, because a missing suffix was a mismatch on purpose. Blank holders still failed while the switch was on.

## First pass (commit `0d71571`)

The sections below were written against `0d71571`, before the follow-up. Findings 1 through 3 in that pass are addressed by `2ad214c`. They are not the current result.

## Plain-language summary for the owner (first pass)

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

## Recommendation (first pass, superseded)

This recommendation applied to `0d71571` only. The follow-up at `2ad214c` is what to merge. See the re-verify section above.
