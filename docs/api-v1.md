# Proof Public API (v1)

Versioned, org-scoped, service-to-service API for external integrations
(Quill, Core, and future consumers). This is the **as-built** reference for
`/api/v1`.

Design goal: this is a general integration surface, not a single-consumer
endpoint. Every consumer authenticates with its own token, and the conventions
below (pagination, envelopes, errors, serializers) are shared by every route so
new endpoints drop in without bespoke plumbing.

---

## Conventions

- **Base path**: `/api/v1/orgs/:orgSlug/...`. `:orgSlug` accepts an org **slug
  or id** (many orgs have no slug).
- **JSON** in and out.
- **Single resource**: the resource itself, unwrapped — `{ "id": ..., ... }`.
  Only lists carry a `data` envelope, because they have pagination to carry
  alongside the rows.
- **Lists** (cursor pagination):
  ```json
  { "data": [ ... ], "nextCursor": "opaque-or-null", "hasMore": true }
  ```
  Query params: `cursor` (opaque, from the previous `nextCursor`), `limit`
  (default 50, max 200). Cursors are opaque — do not parse them.
- **Errors**: `{ "error": { "code": "...", "message": "...", "details": {} } }`

| Status | When |
|--------|------|
| `400` / `422` | validation error (bad body/params) |
| `401` | missing/invalid token (`unauthorized`) |
| `403` | token valid but not authorized for this org, or missing scope (`forbidden`) |
| `404` | org / vendor not found, or no such endpoint (`organization_not_found`, `vendor_not_found`, `route_not_found`) |
| `409` | conflict, e.g. a COI request is already open (`coi_request_conflict`) |
| `5xx` | Proof-side failure (`internal_error`) |

## Authentication

`Authorization: Bearer <token>`. Tokens are minted per consumer and stored only
as a SHA-256 hash (raw value shown once at creation).

- A token is scoped to **one org** (`orgId`) **or** flagged as a **platform
  token** (`allOrgs`) that can access any org, validated against the `:orgSlug`
  in the path.
- Tokens carry **scopes**: `vendors:read`, `vendors:write`,
  `coi-requests:read`, `coi-requests:write` (or `*` for all).
- **Dev bypass** (non-production only): send `x-helm-test-org-slug: <slug>` with
  no bearer token to talk to a local Proof without minting tokens.

Mint a token:

```bash
# Scoped to one org
node scripts/create-api-client.js --name "Quill" --org buildco

# Platform token across all orgs
node scripts/create-api-client.js --name "Quill" --all-orgs

# Read-only
node scripts/create-api-client.js --name "Reporting" --org buildco --scopes vendors:read
```

Rate limit: 600 requests / 15 min, keyed per token.

---

## Data shapes

### Vendor

```json
{
  "id": "9c4e...-uuid",
  "name": "Apex Electrical LLC",
  "trade": "Electrical",
  "email": "bids@apexelectrical.com",
  "phone": "+16155551234",
  "coreVendorId": "core_vendor_abc",
  "externalId": "myproject-vendor-123",
  "coi": {
    "status": "compliant",
    "expiresAt": "2026-09-30",
    "lastRequestedAt": "2026-06-01T14:22:00Z",
    "coverages": [
      { "type": "general_liability", "status": "compliant", "expiresAt": "2026-09-30", "limit": 2000000 }
    ]
  }
}
```

- `id` — Proof's opaque, stable vendor id (a UUID). Store as `proofVendorId`.
- `coreVendorId` — present only when the vendor is linked to Core.
- `externalId` — the calling system's own id for this vendor, if it supplied
  one on create. Unique per org.
- `coi.expiresAt` — earliest expiration among coverages (drives the badge).
  Calendar date (`YYYY-MM-DD`); timestamps like `lastRequestedAt` are full ISO.
- `coi.coverages` — returned by the **detail** endpoint only. `limit` is in
  **whole dollars**. Only coverage lines with data are included.

### COI status enum

`coi.status` and each coverage `status` is one of: `compliant`,
`expiring_soon`, `expired`, `pending`, `none`. Proof owns this computation.
`expiring_soon` uses a 30-day window. Internally, a vendor whose coverage is
below the org's required limits (`NON_COMPLIANT`) surfaces as `expired`
("not acceptable, needs a new COI").

### COI request

```json
{
  "id": "3f21...-uuid",
  "vendorId": "9c4e...-uuid",
  "status": "requested",
  "coverageTypes": ["general_liability", "workers_comp"],
  "additionalInsured": "Mark Allan Contracting",
  "requestedBy": "system",
  "requestedByEmail": "estimator@buildco.com",
  "dueDate": "2026-10-03T00:00:00Z",
  "requestedAt": "2026-07-21T16:40:00Z"
}
```

`requestedBy` is a free-form actor label (`"system"`, a username);
`requestedByEmail` is the address a human would be written to at. They are
separate fields — only the latter is validated as an email.

`status` is `requested`, `fulfilled`, or `cancelled`. A request auto-resolves to
`fulfilled` when the vendor next becomes compliant.

---

## Endpoints

### `GET /vendors`

List/search vendors. Optional query params: `search` (name/email), `trade`,
`coiStatus` (the enum above), `cursor`, `limit`. Returns paginated `Vendor`
(list form omits `coverages`). Scope: `vendors:read`.

### `POST /vendors`

Create a vendor. Body:

```json
{
  "name": "Apex Electrical LLC",
  "trade": "ELECTRICAL",
  "email": "bids@apexelectrical.com",
  "phone": "+16155551234",
  "externalId": "myproject-vendor-123"
}
```

Only `name` is required. Scope: `vendors:write`.

- **Idempotent on `externalId`**: if one is supplied and already maps to a
  vendor in this org, returns `200` with that vendor instead of creating a
  second. Without an `externalId` every call creates a new vendor.
- **`trade`** is mapped onto Proof's canonical trade list, so callers can send
  their own vocabulary (`ELECTRICAL` → `Electrical`). A trade Proof doesn't
  recognise is stored as `null` rather than failing the create — the field is
  optional and an unfamiliar trade is not worth losing a vendor over.
- **`email`** is optional. A vendor created without one gets a non-routable
  `@no-email.proofcoi.local` placeholder (the same convention the Airtable
  importer uses), so the record exists and can be corrected later.
- `403 forbidden` if the org is at its plan's vendor limit.
- `201` with the created `Vendor` (unwrapped, `coverages` included).

### `GET /vendors/:vendorId`

One vendor with full `coi.coverages`. `404` if not in this org. Scope:
`vendors:read`.

### `POST /vendors/:vendorId/coi-requests`

Trigger a COI request (rotates the upload token, emails the vendor, logs it).
Body (all optional):

```json
{ "coverageTypes": ["general_liability"], "note": "...", "requestedByEmail": "estimator@buildco.com" }
```

- **Idempotent-ish**: if a request is already open for the vendor, returns
  `409 coi_request_conflict` with the existing request in `details.request`.
  Never creates duplicate open requests.
- Sets the vendor to `pending` unless a valid COI already exists.
- `201` with the created `COI request`. Scope: `coi-requests:write`.

### `GET /vendors/:vendorId/coi-requests`

Request history for one vendor, newest first (paginated). Scope:
`coi-requests:read`.

### `POST /coi-requests`

Create a COI request for the vendor named in the body — the collection-style
form an external system calls right after creating a vendor. Same side effects
as the vendor-nested route above. Scope: `coi-requests:write`.

```json
{
  "vendorId": "9c4e...-uuid",
  "additionalInsured": "Mark Allan Contracting",
  "requestedBy": "system",
  "dueDate": "2026-10-03T00:00:00.000Z"
}
```

Only `vendorId` is required; `coverageTypes` and `note` are also accepted.

- **Idempotent**: if a request is already open for the vendor, returns `200`
  with that request rather than `409`. This is the machine-to-machine path, so
  a caller retrying a half-finished onboarding job converges instead of
  failing forever. (The vendor-nested route keeps its `409` — that one backs an
  interactive "Request COI" button, where "already open" is the useful answer.)
- `201` with the created `COI request`, or `200` with the open one.

### `GET /coi-requests`

Request history across the org, newest first (paginated). Optional
`vendorId` and `status` filters. Scope: `coi-requests:read`.

---

## Webhooks (live COI freshness)

Instead of polling, a consumer can subscribe an endpoint and receive a signed
callback whenever a vendor's COI status changes.

Register an endpoint (prints the signing secret once):

```bash
node scripts/create-webhook-endpoint.js \
  --name "Quill" --url https://quill.example.com/api/webhooks/proof/coi \
  --all-orgs --events coi.updated
```

Endpoints are scoped per-org or `--all-orgs`, exactly like tokens. On a status
change Proof POSTs:

```
POST <your url>
X-Proof-Event: coi.updated
X-Proof-Signature: <hex HMAC-SHA256 of the raw body, using the endpoint secret>

{
  "event": "coi.updated",
  "orgSlug": "buildco",
  "vendorId": "9c4e...-uuid",
  "coi": { "status": "expired", "expiresAt": "2026-07-20" },
  "sentAt": "2026-07-21T16:40:00Z"
}
```

Verify the signature by recomputing `HMAC-SHA256(secret, rawBody)` and comparing
to `X-Proof-Signature`. Delivery is best-effort (single attempt, 5s timeout);
the last delivery outcome is recorded on the endpoint. Events fire only on an
actual status transition, not on every recompute.

`coi.updated` is the only event today; the subscription model is general, so new
event types slot in without new plumbing. Consumers that prefer not to wire
webhooks can still re-fetch (`GET /vendors/:id`) or re-list to refresh.

## Not built

- **Bid pricing / vendor portal** — out of scope; the consumer owns that.
