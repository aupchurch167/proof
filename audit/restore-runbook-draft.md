# Restore runbook (DRAFT — untested)

Status: **Draft from repo evidence only.** No restore has been executed in this audit. Fill the `OWNER:` blanks before treating this as a procedure.

Related: A3-01, A3-09, `/audit/server-checklist.md`.

## What we believe exists

| Layer | What the repo shows | What we do not know |
|---|---|---|
| Postgres | Prisma + `DATABASE_URL`. Host unnamed. | Neon vs other. PITR window. Latest snapshot. |
| Objects | DigitalOcean Spaces, bucket default `proof-coi-uploads`, private ACL in code | Versioning? Replication? Separate backup? |
| App | Nginx → `127.0.0.1:4000`. `prisma migrate deploy` in `docs/migrations.md` | PM2 vs systemd. How many instances. |
| Secrets | env on the box / Railway | Who can rotate. Last rotation. |

**Honest RPO:** unknown (minutes if Neon PITR is on; **infinity** if it is not).
**Honest RTO:** unknown. A practiced Neon PITR + app reboot is typically hours; a from-scratch rebuild is a business day.

## Pre-conditions (do these before the first incident)

1. OWNER: Confirm host (Neon project ID / other) and paste PITR retention here: `________`.
2. OWNER: Enable Spaces versioning on `DO_SPACES_BUCKET`. Record region: `________`.
3. OWNER: Store `DATABASE_URL`, Spaces keys, `JWT_*`, Resend, Anthropic, Google in a password manager **and** a sealed ops note. JWT rotation logs everyone out (no server-side session).
4. Take a named snapshot today. Write the snapshot ID: `________`.
5. Rehearse section “Test restore” on a Friday that is not a launch Friday.

## Incident: database corruption or bad migration

1. Stop writes: `pm2 stop` / disable Nginx location (do **not** keep cron emailing).
2. Record the time of last known good (`date -u`).
3. If Neon: create a PITR branch at T-ε. Point a **throwaway** `DATABASE_URL` at it. `cd server && npx prisma migrate diff` vs `schema.prisma`.
4. If not Neon: restore the last `pg_dump` to a new instance. Same diff.
5. Spot-check: one Organization, one Vendor, one Coi `pdfPath` → `getSignedUrl` works.
6. Only then swap production `DATABASE_URL` and start the app.
7. If the bad migration is already applied: **do not** `migrate resolve` until you understand `docs/migrations.md` path A vs B.

## Incident: Spaces object loss

1. If versioning on: restore keys from prior version. Prefixes: `cois/`, `w9s/`, `master-agreements/`, `reply-attachments/`.
2. If versioning off: objects are gone. DB rows still point at keys. Tell customers. This is why A3-01 is High.

## Incident: stolen JWT_SECRET

1. Rotate `JWT_SECRET` and `JWT_REFRESH_SECRET`.
2. All users are logged out (good). Portal upload JWTs signed with the old secret still work **until Sunday cron** because the portal does not verify JWT (A1-13) — **immediately** run the token-refresh loop (`generateUploadToken` for every vendor) after rotation.
3. Revoke all `ApiClient` rows (`revokedAt=now()`) and re-issue to Quill.

## Incident: stolen Spaces keys

1. Rotate the DO access key.
2. Objects remain; signed URLs already issued die at ≤15m.
3. Audit Spaces access logs if enabled.

## Test restore (rehearsal)

- [ ] PITR (or dump) from 24h ago restored to a non-prod URL
- [ ] `npx prisma migrate diff` empty
- [ ] Login as a fixture user
- [ ] Open one signed COI PDF
- [ ] Time taken: `________` (this is your RTO sample)
- [ ] Date rehearsed: `________` by `________`

## Do not

- Point Jest at this database (`cleanupTestData` deletes everything — A9-05).
- `prisma db push` on production (`docs/migrations.md` history).
- Cascade-delete an Organization to “clean up” (A3-03).
