# Database migrations

Proof uses Prisma Migrate. Apply pending migrations with:

```bash
cd server && npx prisma migrate deploy
```

## Schema-drift reconciliation (20260721120000_reconcile_schema_drift)

Historically some schema changes were applied with `prisma db push` instead of a
migration, so several columns/indexes/enum values lived in `schema.prisma` (and
in production) but were absent from the migration history. That made
`migrate deploy` against a fresh database produce a schema that didn't match
Prisma Client.

`20260721120000_reconcile_schema_drift` captures those objects (User invite/reset
token columns, Coi certificate-holder columns, several indexes, and the `MEMBER`
/ `WEEKLY_SUMMARY` enum values). Every statement uses `IF NOT EXISTS`, so it is
safe whether or not the objects already exist.

Verified:
- **Fresh DB**: all migrations apply and `prisma migrate diff` reports
  "No difference detected" against `schema.prisma`.
- **Existing DB** (objects already present via db push): the migration no-ops
  every statement, inside or outside a transaction — no errors.

## Applying to production

Which path you need depends on whether production already tracks migrations
(i.e. whether a `_prisma_migrations` table with rows exists).

**A. Production already tracks migrations (most likely).**
`migrate deploy` applies the new migrations. The reconcile migration no-ops the
objects that already exist; the Google-auth and API-client migrations add genuinely
new objects. Nothing else to do:

```bash
npx prisma migrate deploy
```

**B. Production was only ever `db push`-ed (no migration history).**
`migrate deploy` would try to replay the very first migration (`CREATE TABLE ...`,
which is not idempotent) and fail because the tables already exist. Baseline the
database first by marking every migration that predates the current DB state as
already applied, then deploy the genuinely new ones:

```bash
# Mark all pre-existing migrations as applied (baseline). Do this for each
# migration folder up to and including 20260721120000_reconcile_schema_drift.
npx prisma migrate resolve --applied 20260318140246_init
# ... repeat for each existing migration ...
npx prisma migrate resolve --applied 20260721120000_reconcile_schema_drift

# Then apply anything genuinely new.
npx prisma migrate deploy
```

Because the reconcile migration is idempotent, if you are unsure whether a
specific object exists you can also `migrate resolve --applied` it safely and
move on. Take a database backup before baselining.
