# B02 status

Audit files live on `cursor/audit-pre-launch-30f7` (PR #9) and were not all on `main` when this batch started. Finding text used as source of truth from that branch. A1-05 (boot JWT validation) was already fixed in B01 and was not re-done.

Verification: `audit/verification/B02.md` (Prompt V against `16085a4`). App code was not changed by the verifier.

**Prompt V recommendation: send back PR #12** — A1-03 is only partially fixed (`googleId` path re-verifies after email squat).

| ID | Status |
|---|---|
| A1-01 | **Verified** — `Session` hash + family; logout / reset / rotation-reuse / user-delete → refresh 401. Residual: 15m access still works; `PUT /me` password change does not revoke. |
| A1-02 | **Verified** — `authenticateVerified` on session APIs. Unverified → 403 `EMAIL_NOT_VERIFIED` on vendors/import/integrations/etc. Session JWT on v1 → 401. Templates + health public. |
| A1-03 | **Partially fixed** — X-04 unverified password row is 409 / no attach. **Hole:** leftover `googleId` or `googleId` match after `PUT /me` email change issues tokens and sets `emailVerified: true` without proving the new inbox. Send back. |
| A1-04 | **Verified** — invites hashed, 48h expiry, `GET /users` and create omit `inviteToken`. Expired / consumed → 404. Residual: plaintext fallback for unexpired legacy rows. |
| A1-06 | **Verified** — existing email 201 + generic message, no tokens. Timing ±10ms vs new. Residual: body shape still enumerates (`user`/tokens vs `message` only). Invite stays 409. |
| A1-09 | **Verified** — accept-invite sets `emailVerified: true`. |
| A1-10 | **Verified** — seed exits 1 when `NODE_ENV=production`. Residual: `Production` / aliases still seed. |
| A1-11 | **Verified** — `validate('updateProfile')`; email change needs current password, sets unverified, sends mail; X-03 409. Residual: Google `googleId` path can flip verified back (A1-03). |
| A1-12 | **Verified** — `algorithms: ['HS256']` on every `jwt.verify` / `jwt.sign`. `alg=none` and HS384 → 401. |
| A1-13 | **Verified** — `verifyUploadToken`; 401 on expiry / purpose / UUID; lookup by `payload.vendorId`. Valid JWT still 200. |
| A2-04 | **Verified** — `uploadToken` omitted from vendor list/detail/create/update. Usage preview is ADMIN-only 15m mint; MEMBER/VIEWER get none. |
| A2-05 | **Verified** — apply slug only (UUID → 404). Slug POST works; FREE cap → `PLAN_LIMIT_EXCEEDED`. |

**Prompt V:** X-02–X-04 (password case), T-02, L-02, V-01, O-03 re-ran on this branch and passed. X-04 adjacent (`googleId` after email change) failed — see `audit/verification/B02.md`.

Backlog (`audit/backlog.md`) is only on PR #9; not copied onto this branch. Update those rows when #9 lands.
