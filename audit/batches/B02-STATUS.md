# B02 status

Audit files live on `cursor/audit-pre-launch-30f7` (PR #9) and were not all on `main` when this batch started. Finding text used as source of truth from that branch. A1-05 (boot JWT validation) was already fixed in B01 and was not re-done.

**Status: Fixed — pending verification**

| ID | Status |
|---|---|
| A1-01 | **Fixed — pending verification** — `Session` table (hash + family + expiry). Logout revokes family. Password reset revokes all sessions. `/auth/refresh` rotates and rejects revoked/unknown tokens. |
| A1-02 | **Fixed — pending verification** — `requireVerified` on session APIs except auth, portal, apply, webhooks, health, import templates, and v1. Unverified → 403 `EMAIL_NOT_VERIFIED`. `/auth/me` and resend-verify still work. |
| A1-03 | **Fixed — pending verification** — Email-link only if `emailVerified` is already true (bare `googleId` is not enough). A `googleId` hit requires `profile.email` to still equal the current `user.email` (normalized); otherwise 409 and no auto-verify. Prompt V hole: leftover googleId after PUT /me email change no longer re-verifies the squatted address. |
| A1-04 | **Fixed — pending verification** — Invites hashed at rest, 48h expiry. `GET /users` and invite create no longer return `inviteToken`. Accept after expiry → 404. |
| A1-06 | **Fixed — pending verification** — Signup existing email → 201 generic message (no tokens). Residual: body shape still differs for new vs existing. |
| A1-09 | **Fixed — pending verification** — Accept-invite sets `emailVerified: true`. |
| A1-10 | **Fixed — pending verification** — Seed exits 1 when `NODE_ENV=production`. Password from `SEED_PASSWORD`. |
| A1-11 | **Fixed — pending verification** — `validate('updateProfile')` on PUT `/me`. Email change requires current password, sets `emailVerified=false`, sends a new verify email. |
| A1-12 | **Fixed — pending verification** — `algorithms: ['HS256']` on every `jwt.verify` / `jwt.sign`. |
| A1-13 | **Fixed — pending verification** — Portal calls `verifyUploadToken`; 401 on expiry/purpose/UUID; lookup by `payload.vendorId`. |
| A2-04 | **Fixed — pending verification** — `uploadToken` omitted from vendor list/detail/create/update. Usage does not return stored tokens; ADMIN-only 15m mint. |
| A2-05 | **Fixed — pending verification** — Apply resolves slug only (UUID-looking ids 404). Plan vendor limit enforced (`PLAN_LIMIT_EXCEEDED`). |

**Prompt V:** run `audit/tenant-isolation-tests.md` cases X-02–X-04, T-02, L-02, V-01, O-03 against this branch.

Backlog (`audit/backlog.md`) is only on PR #9; not copied onto this branch. Update those rows when #9 lands.
