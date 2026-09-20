# Proof system map — `proof-2026-09-20`

Source of truth: repo at `71021a4` on `main`. Flags that could not be confirmed from the repo are listed as **open questions**.

---

## 1. Architecture

Two packages, one process in production:

| Piece | Path | Runtime |
|---|---|---|
| API + cron + static SPA | `server/` | Node / Express, `PORT` default 4000 |
| SPA | `client/` | Vite 6 + React 18. Built assets served by Express when `NODE_ENV=production` (`server/src/app.js:125-127`, `163-166`) |

Frontend talks to the API via `fetch` in `client/src/utils/api.js`. `VITE_API_BASE_URL` is prepended at build time; locally Vite proxies `/api` and `/uploads` to `localhost:4000` (`client/vite.config.js`).

**Auth header:** `Authorization: Bearer <accessToken>` from `localStorage`. Refresh is a JSON POST of `refreshToken` (also localStorage), not a cookie.

**Third-party services (from code + `.env.example`):**

| Service | Used for | Evidence |
|---|---|---|
| PostgreSQL (Prisma) | System of record. Host implied Neon by product lore; **not named in code**. URL is `DATABASE_URL`. | `server/prisma/schema.prisma:5-8` |
| DigitalOcean Spaces (S3 API) | Private PDF / W9 / master-agreement / reply-attachment blobs | `server/src/services/storage.js` |
| Anthropic Claude | COI PDF extraction | `server/src/services/coiExtractor.js` |
| Resend | Transactional email + inbound reply webhook | `server/src/services/email.js`, `server/src/routes/webhooks.js` |
| Google Identity Services | Sign-in (ID token) | `server/src/lib/google.js`, `client/src/components/GoogleSignInButton.jsx` |
| Helm Core | Optional vendor mirror. Dev-bypass headers, no real auth | `server/src/lib/core.js` |
| Airtable | One-time import scripts only | `server/scripts/import-airtable-*.js` |
| Railway | Hard-coded CORS origin `https://proof.up.railway.app`; Core default URL `helmcore.up.railway.app` | `server/src/app.js:57`, `server/src/lib/core.js:12` |
| Nginx / Let's Encrypt | TLS terminator on droplet (`nginx/proof.conf`) | repo |
| Stripe / QBO / payments | **Not present** | grep |

`nodemailer` is in `server/package.json` but is never `require`d. Email goes through Resend.

Open questions: is production on the droplet behind `nginx/proof.conf`, Railway, or both? Is the database Neon?

---

## 2. Data model

Prisma models in `server/prisma/schema.prisma`. Tenant key is `Organization.id` (`orgId` on child tables). There is **no** Postgres RLS and **no** Prisma client extension that injects `orgId`.

| Model | Tenant field | Relations | PII / sensitive | Notes |
|---|---|---|---|---|
| Organization | self | settings, users, vendors, cois, notifications, auditLogs, apiClients, coiRequests, webhookEndpoints | name, email, phone, address | `plan` enum FREE/STARTER/UNLIMITED; `slug` unique nullable; `onDelete: Cascade` to children |
| OrganizationSettings | `orgId` unique | org | coverage dollar minimums (cents, Int) | one template per org today |
| User | `orgId` + index | org; reviewedCois | email (**globally unique**), name, `passwordHash`, `googleId`, `emailVerifyToken`, `inviteToken`, `resetToken`, `resetTokenExpiry` | Roles: ADMIN, MEMBER, REVIEWER, VIEWER. Default role ADMIN. Tokens stored **plaintext** |
| Vendor | `orgId` + `(orgId, deletedAt)` index | org, cois, notifications, coiRequests | name, contact, email, phone, address, additionalEmails, notes, `w9Path`, `masterAgreementPath`, `uploadToken` (unique) | Soft-delete `deletedAt`. `uploadToken` is the public portal secret. No unique `(orgId, email)` |
| Coi | `orgId` + indexes | vendor, org, reviewedBy | policy numbers, limits, expirations, agent contact, certificate holder, `pdfPath`, `aiExtractedData` JSON | Hard-deleted with vendor. `pdfPath` required (empty string used for CSV imports) |
| NotificationLog | `orgId` | org, vendor?, coi? | `recipientEmail`, `meta` JSON | |
| AuditLog | `orgId` + indexes | org | `ipAddress`, `details` JSON (includes inbound email preview + attachment keys) | |
| ApiClient | `orgId` nullable | org?, coiRequests | `tokenHash` (SHA-256), `tokenPrefix` | `allOrgs=true` is a platform super-token |
| CoiRequest | `orgId` | org, vendor, apiClient? | note, requestedByEmail | |
| WebhookEndpoint | `orgId` nullable | org? | **`secret` plaintext**, destination `url` | `allOrgs=true` receives every tenant's `coi.updated` |

Money is stored as integer cents. Dates are DateTime. No floating-point currency columns.

---

## 3. Route inventory

Middleware applied globally (`server/src/app.js`): `trust proxy = 1`, `helmet` (CSP with `'unsafe-inline'` styles + Google GIS), `cors` (allowlist + credentials), `express.json` 1mb (webhooks 10mb raw), `morgan`, `/api` general limiter 100/15m (skips `/v1`), auth limiter 10/15m on login/signup/google/accept-invite/forgot/reset, v1 limiter 600/15m keyed by token hash.

`Auth` = session JWT via `authenticate`. `Role` = `authorize(...)`. `Tenant` = query constrained by `req.user.orgId` or `req.org.id`. `Valid` = zod `validate()` or equivalent schema.

### `/api/auth` — `routes/auth.js`

| Method | Path | Chain | Auth | Role | Tenant | Valid |
|---|---|---|---|---|---|---|
| GET | /config | — | N | — | N | N |
| POST | /signup | authLimiter, validate('signup') | N | — | creates org | Y |
| POST | /login | authLimiter, validate('login') | N | — | N | Y |
| POST | /google | authLimiter | N | — | creates or links | N |
| POST | /refresh | — | refresh JWT | — | N | N |
| GET | /me | authenticate | Y | any | own user | N |
| POST | /accept-invite | authLimiter, validate('acceptInvite') | N | — | N | Y |
| GET | /invite-info | — | N | — | N | N |
| PUT | /me | authenticate | Y | any | own user | partial (password only) |
| POST | /forgot-password | authLimiter | N | — | N | N |
| POST | /reset-password | authLimiter | N | — | N | passwordSchema |
| GET | /verify-email | — | N | — | N | N |
| POST | /resend-verification | authenticate | Y | any | own user | N |

### `/api/settings` — `routes/settings.js`

| Method | Path | Chain | Auth | Role | Tenant | Valid |
|---|---|---|---|---|---|---|
| GET | / | authenticate | Y | any | Y | N |
| PUT | / | authenticate, authorize('ADMIN') | Y | ADMIN | Y | partial arrays |

### `/api/users` — `routes/users.js`

| Method | Path | Chain | Auth | Role | Tenant | Valid |
|---|---|---|---|---|---|---|
| GET | / | authenticate, authorize('ADMIN') | Y | ADMIN | Y | N |
| POST | /invite | authenticate, authorize('ADMIN') | Y | ADMIN | Y | N |
| PUT | /:id/role | authenticate, authorize('ADMIN') | Y | ADMIN | Y | N |
| DELETE | /:id | authenticate, authorize('ADMIN') | Y | ADMIN | Y | N |

### `/api/vendors` — `routes/vendors.js`

| Method | Path | Chain | Auth | Role | Tenant | Valid |
|---|---|---|---|---|---|---|
| GET | / | authenticate | Y | any | Y | N |
| GET | /trades | authenticate | Y | any | N (static) | N |
| POST | / | authenticate, authorize(ADMIN,MEMBER,REVIEWER), enforcePlanLimit('vendor'), validate('createVendor') | Y | A/M/R | Y | Y |
| GET | /:id | authenticate | Y | any | Y | N |
| PUT | /:id | authenticate, authorize(A,M,R) | Y | A/M/R | Y | N |
| DELETE | /bulk | authenticate, authorize(A,M) | Y | A/M | Y | N |
| DELETE | /:id | authenticate, authorize(A,M) | Y | A/M | Y | N |
| POST | /:id/coi/upload | authenticate, authorize(A,M,R), enforcePlanLimit('coi'), multer PDF 10MB | Y | A/M/R | Y | MIME |
| POST | /:id/request-coi | authenticate, authorize(A,M,R) | Y | A/M/R | Y | N |
| POST | /:id/documents | authenticate, authorize(A,M,R), multer | Y | A/M/R | Y | MIME |

### `/api/cois` — `routes/cois.js`

| Method | Path | Chain | Auth | Role | Tenant | Valid |
|---|---|---|---|---|---|---|
| GET | / | authenticate | Y | any | Y | N |
| GET | /:id | authenticate | Y | any | Y | N |
| GET | /:id/pdf | authenticate | Y | any | Y | N |
| PUT | /:id | authenticate, authorize(A,M,R), coiUpdateSchema | Y | A/M/R | Y | Y |
| POST | /:id/reanalyze | authenticate, authorize(A,M,R) | Y | A/M/R | Y | N |
| POST | /:id/approve | authenticate, authorize(A,M,R) | Y | A/M/R | Y | N |
| DELETE | /:id | authenticate, authorize(A,M) | Y | A/M | Y | N |
| POST | /:id/reject | authenticate, authorize(A,M,R) | Y | A/M/R | Y | reason required |

### `/api/portal` — public vendor portal (`routes/portal.js`)

| Method | Path | Chain | Auth | Role | Tenant | Valid |
|---|---|---|---|---|---|---|
| GET | /:uploadToken | — | uploadToken lookup | — | vendor row | N |
| PUT | /:uploadToken/info | — | uploadToken | — | vendor row | N |
| POST | /:uploadToken/upload | multer PDF 10MB | uploadToken | — | vendor row | MIME |

`verifyUploadToken()` exists in `utils/tokens.js` and is **never called**. Lookup is a string equality on `Vendor.uploadToken`.

### `/api/reports` — `routes/reports.js`

All `authenticate`, any role, tenant via `req.user.orgId`. `GET /coverage` validates dates. `POST /export-pdfs` takes `coiIds[]` and filters by orgId.

### `/api/audit`, `/api/reminders/upcoming`, `/api/notifications`, `/api/replies`

All `authenticate`, any role, tenant via `orgId`. Replies vendor path 404s cross-org.

### `/api/requirements` — `routes/requirements.js`

| Method | Path | Auth | Role | Tenant | Valid |
|---|---|---|---|---|---|
| GET | / | Y | any | Y | N |
| POST | /impact | Y | any | Y | coverages array |
| PUT | /:templateId | Y | ADMIN | Y | Y |
| PUT | /coverage-period/set | Y | ADMIN | Y | dates |

### `/api/compliance`

| GET | /overview | Y | any | Y |
| POST | /vendors/:id/contacted | Y | A/M/R | Y |

### `/api/organization`

| GET | / | Y | any | Y — returns **full org row** including `plan`, `slug` |
| PUT | / | Y | ADMIN | Y — name/email/phone/address/note only (not `plan`/`slug`) |
| GET | /usage | Y | any | Y — returns **`portalPreviewToken`** |

### `/api/import`

| GET | /template/vendors | **N** | static sample |
| GET | /template/cois | **N** | static sample |
| POST | /preview | Y | A/M/R |
| POST | /vendors | Y | A/M/R |
| POST | /cois | Y | A/M/R |

### `/api/apply` — public vendor application

| GET | /:slug | N | org by slug **or UUID** |
| POST | /:slug | applyLimiter 20/hour + multer | creates Vendor (+ optional COI). **No plan-limit middleware** |

### `/api/webhooks` — mounted **before** JSON 1mb + **before** rate limiter

| POST | /resend-inbound | Svix verify **only if** `RESEND_WEBHOOK_SECRET` is set |

### `/api/integrations` — `router.use(authenticate, authorize('ADMIN'))`

API keys and webhook endpoints scoped to `req.user.orgId`, `allOrgs` forced false.

### `/api/v1/orgs/:orgSlug` — `routes/v1` + `middleware/apiAuth.js`

All routes: `apiAuth` then `requireScope`. Tenant = resolved org. Dev bypass `x-helm-test-org-slug` when `NODE_ENV !== 'production'`.

| Method | Path | Scope |
|---|---|---|
| GET | /vendors | vendors:read |
| GET | /vendors/:vendorId | vendors:read |
| GET | /vendors/:vendorId/coi/document | vendors:read |
| GET | /vendors/:vendorId/coi-requests | coi-requests:read |
| POST | /vendors/:vendorId/coi-requests | coi-requests:write |
| GET | /cois | vendors:read |
| GET | /cois/:coiId/document | vendors:read |

### Other

| GET | /api/health | N | Prisma `$queryRaw\`SELECT 1\`` |

---

## 4. Auth flow

**Identity:** email+password (bcryptjs cost 12) or Google ID token (`google-auth-library`, audience = `GOOGLE_CLIENT_ID`, requires `email_verified` on the Google payload).

**Tokens:** HS256 JWTs (`jsonwebtoken`), algorithm not pinned in `verify()`.

| Token | Secret | Claims | TTL | Storage | Revocation |
|---|---|---|---|---|---|
| Access | `JWT_SECRET` | id, orgId, email, **role** | 15m | localStorage `accessToken` | none (wait out TTL) |
| Refresh | `JWT_REFRESH_SECRET` | id, orgId | 7d | localStorage `refreshToken` | none. Rotation issues a new pair; old refresh still verifies until 7d |
| Upload | `JWT_SECRET` | vendorId, purpose=upload | 7d on sign | `Vendor.uploadToken` column | string replaced on request-coi / cron; **expiry not checked** because `verifyUploadToken` is unused |
| Invite | n/a | UUID v4 | **none** | `User.inviteToken` plaintext | cleared on accept |
| Reset | n/a | 32 random bytes hex | 1h | `User.resetToken` plaintext | cleared on use |
| Email verify | n/a | 32 random bytes hex | **none** | `User.emailVerifyToken` plaintext | cleared on verify |
| API | n/a | `prf_live_<32B>` | none | SHA-256 hash only | `revokedAt` |

Signup and Google (new user) create an Organization + ADMIN user in a transaction and **immediately issue access+refresh**. `emailVerified` is false for password signup; the banner says "unlock all features" but **no server route checks `emailVerified`**.

`authorize()` reads `req.user.role` from the **access JWT**, not the database. Role changes take effect on next access-token refresh (≤15m).

Logout (`AuthContext.logout`) only clears localStorage.

No MFA. No session table. No CSRF cookies (Bearer-in-header; refresh is in JSON body).

---

## 5. File / blob storage

`server/src/services/storage.js` — AWS SDK v3 against DO Spaces. `ACL: 'private'`. Keys: `{prefix}/{uuid}{ext}` with prefixes `cois`, `w9s`, `master-agreements`, `reply-attachments`. Served only via 15-minute signed GET URLs.

Historical local `uploads/` is gitignored; `scripts/migrateToSpaces.js` exists. Current request paths do not write to disk.

Open question: is the Spaces bucket definitely private at the DO account ACL (code sets object ACL private; bucket policy is not in repo)?

---

## 6. Background work

In-process `cron` package, started from `server/src/index.js` after `listen`:

| Job | Schedule | Function |
|---|---|---|
| Expiration reminders | daily 08:00 | `runExpirationSweep` — per org, rotate upload token, email, NotificationLog |
| Chase | daily 09:00 | `runChaseSweep` — follow-ups + `chase_escalated` audit |
| Upload-token refresh | Sunday 00:00 | rewrite every live vendor `uploadToken` |
| Weekly summary | Monday 08:00 | email first ADMIN per org |

No queue, no job table, no leader election. A restart during the minute misses the tick. Two processes would double-send.

**Inbound webhook:** `POST /api/webhooks/resend-inbound` — matches vendors by **email across all orgs**, writes AuditLog + maybe creates Coi.

**Outbound webhook:** `webhookDispatcher.emitCoiUpdated` — HMAC-SHA256 hex, 5s timeout, **one attempt**.

---

## 7. Config (every `process.env` read)

| Var | Where | Fail-loud? |
|---|---|---|
| DATABASE_URL | Prisma schema | Prisma throws on first query, not at boot of `index.js` |
| JWT_SECRET | tokens.js, auth.js | silent; `jwt.sign/verify` throw at request time if missing |
| JWT_REFRESH_SECRET | tokens.js, auth.js refresh | same |
| GOOGLE_CLIENT_ID | google.js | Google sign-in disabled if blank |
| ANTHROPIC_API_KEY | coiExtractor.js | throws at extract time; upload still succeeds |
| ANTHROPIC_MODEL | coiExtractor.js | default `claude-sonnet-4-20250514` |
| RESEND_API_KEY | email.js | if missing, emails log to console and return |
| FROM_EMAIL | email.js | same |
| REPLY_TO_EMAIL | email.js | optional |
| RESEND_WEBHOOK_SECRET | webhooks.js | **optional — if unset, inbound webhook accepts anything** |
| APP_URL | many email/portal links | cron portal URLs become `undefined/portal/...` if unset |
| PORT | index.js | default 4000 |
| CORS_ORIGINS | app.js | extra origins |
| NODE_ENV | app.js, prisma, apiAuth, error handler | production gates static SPA, generic errors, v1 dev-bypass |
| DO_SPACES_* | storage.js | client constructed lazily; first upload fails if missing. Bucket defaults to `proof-coi-uploads` |
| HELM_CORE_INTEGRATION | core.js | must be string `'true'` |
| CORE_API_URL | core.js | default Railway URL |
| CORE_ORG_SLUG | core.js | **single slug for all mirrored vendors** |
| CORE_DEV_USER_ID | core.js | sent as `x-helm-test-user-id` |
| AIRTABLE_* / PROOF_ORG_ID | import scripts only | |

**Client public env:** `VITE_API_BASE_URL`, `VITE_GOOGLE_CLIENT_ID` only. No server secrets in `VITE_*`.

There is **no** boot-time env schema (no `envalid` / zod of process.env).

---

## 8. Deploy

In repo:

- `nginx/proof.conf` — HTTP→HTTPS, apex/www → `app.proofcoi.com`, TLS 1.2/1.3, HSTS, X-Frame-Options DENY, 12m body, proxy to `127.0.0.1:4000`.
- `docs/migrations.md` — `prisma migrate deploy`; notes historical `db push` drift and a reconcile migration. Mentions "take a database backup before baselining."
- `package.json` root: `dev` concurrently, `build` client, `start` server.

Not in repo: PM2 ecosystem file, Dockerfile, GitHub Actions, deploy script, systemd unit, `.github/`.

Open questions: process manager (PM2 vs systemd vs Railway)? Who runs `migrate deploy`? One Node process or cluster? Neon vs self-hosted Postgres?

---

## 9. Tests and CI

`server/package.json`: `jest --runInBand --forceExit --detectOpenHandles`. 16 test files under `server/tests/`. Strongest isolation coverage is `/api/v1` (`api-v1.test.js`) and integrations (`integrations.test.js`). App-route suites (`vendors`, `cois`, `auth`) are mostly happy-path single-org. `portal.test.js` expects **401** on a bad token; `portal.js` returns **404**.

No client tests. No `.github/workflows`. No coverage reporter.

`cleanupTestData()` deletes **all rows** in all models — unsafe against a shared DB.

---

## Open questions for the owner

1. Production host: droplet (`nginx/proof.conf`) and/or Railway (`proof.up.railway.app` still in CORS)?
2. Database: Neon? PITR window? Off-site snapshot? Last restore test date?
3. Is `RESEND_WEBHOOK_SECRET` set in production?
4. Is `HELM_CORE_INTEGRATION=true` in production? If yes, which `CORE_ORG_SLUG`?
5. Is `NODE_ENV=production` on the running process?
6. Staging environment?
7. Was `prisma/seed.js` ever applied to production (`admin@markallancont.com` / `password123`)?
8. Who holds Spaces / Neon / Resend / Anthropic / Google OAuth credentials, and is there a rotation log?
9. Uptime monitor + phone/SMS on `/api/health`?
10. Customer ToS / privacy policy URLs (none in repo)?
