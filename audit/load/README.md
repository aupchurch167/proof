# Load scripts — five hottest endpoints

From the code, the endpoints that do the most work on every operator session:

1. `GET /api/vendors` — all vendors + all COIs, then JS slice (`routes/vendors.js`)
2. `GET /api/compliance/overview` — cockpit aggregation
3. `GET /api/cois` — unpaginated include vendor+reviewer
4. `GET /api/reminders/upcoming` — all vendors + per-vendor `coi.count`
5. `GET /api/auth/me` — plus `POST /api/auth/login` for unauth mix

Also included as a sixth optional: `GET /api/v1/orgs/:slug/vendors` (integration traffic, already paginated).

**Do not point these at production.** Use local or a Neon branch. `cleanupTestData` is unrelated but `DATABASE_URL` must be disposable.

## k6

```bash
# from repo root, after `k6` is installed (https://k6.io)
export BASE_URL=http://localhost:4000
export PROOF_EMAIL=admin@example.com
export PROOF_PASSWORD='your-local-password'
k6 run audit/load/hot-endpoints.k6.js
```

## autocannon (no k6)

```bash
# login once, export TOKEN
export TOKEN=eyJ...
export BASE=http://localhost:4000
node audit/load/hot-endpoints.autocannon.js
```

Pass criteria (local, 1 Node process, ~100 vendors): p95 < 300ms on `/auth/me`, p95 < 1s on `/vendors` and `/compliance/overview`, error rate < 1%, no process restart. If `/vendors` p95 exceeds 2s at 20 rps, A6-05 is confirmed.
