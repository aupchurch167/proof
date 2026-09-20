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
- **Single resource**: `{ "data": { ... } }`.
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
| `404` | org / vendor / COI / document not found (`organization_not_found`, `vendor_not_found`, `coi_not_found`, `coi_document_not_found`) |
| `409` | conflict, e.g. a COI request is already open (`coi_request_conflict`) |
| `5xx` | Proof-side failure (`internal_error`) |

## Authentication

`Authorization: Bearer <token>`. Tokens are minted per consumer and stored only
as a SHA-256 hash (raw value shown once at creation).

- A token is scoped to **one org** (`orgId`) **or** flagged as a **platform
  token** (`allOrgs`) that can access any org, validated against the `:orgSlug`
  in the path.
- Tokens carry **scopes**: `vendors:read`, `coi-requests:read`,
  `coi-requests:write` (or `*` for all).
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
  "requestedAt": "2026-07-21T16:40:00Z"
}
```

`status` is `requested`, `fulfilled`, or `cancelled`. A request auto-resolves to
`fulfilled` when the vendor next becomes compliant.

### Historical COI

```json
{
  "id": "7a1c...-uuid",
  "vendorId": "9c4e...-uuid",
  "vendorName": "Apex Electrical LLC",
  "submittedAt": "2025-06-01T14:22:00.000Z",
  "expiresAt": "2026-09-30",
  "document": {
    "url": "https://…signed…",
    "expiresInSeconds": 900,
    "contentType": "application/pdf",
    "filename": "abc123.pdf",
    "expiresAt": "2026-09-20T00:00:00.000Z"
  },
  "coverages": [
    { "type": "general_liability", "status": "compliant", "expiresAt": "2026-09-30", "limit": 2000000 }
  ],
  "agentName": "Jordan Lee",
  "agentEmail": "jordan@broker.com",
  "agentPhone": "+16155550100",
  "insuranceCompany": "Travelers"
}
```

- `expiresAt` — earliest coverage expiration (`YYYY-MM-DD`), or `null` when no
  expiration is on file. This is **not** invented from `submittedAt`.
- `coverages` — same shape as vendor detail (`GET /vendors/:id`). Only lines
  with a limit, expiration, or policy number are included.
- `document` — short-lived signed download (same fields as
  `GET /vendors/:id/coi/document`). Fetch promptly; do not persist the URL.

---

## Endpoints

### `GET /vendors`

List/search vendors. Optional query params: `search` (name/email), `trade`,
`coiStatus` (the enum above), `cursor`, `limit`. Returns paginated `Vendor`
(list form omits `coverages`). Scope: `vendors:read`.

### `GET /vendors/:vendorId`

One vendor with full `coi.coverages`. `404` if not in this org. Scope:
`vendors:read`.

### `GET /vendors/:vendorId/coi/document`

Temporary signed URL for the vendor's latest **APPROVED** COI PDF — the same
COI the detail endpoint uses for `coi.coverages` / `coi.expiresAt` (newest
`APPROVED` row by `submittedAt`). Scope: `vendors:read`.

```json
{
  "data": {
    "url": "https://…signed…",
    "expiresInSeconds": 900,
    "contentType": "application/pdf",
    "filename": "abc123.pdf",
    "coiId": "7a1c...-uuid",
    "expiresAt": "2026-09-20T00:00:00.000Z"
  }
}
```

- `url` — short-lived download URL from `getSignedUrl(coi.pdfPath)` (15-minute
  TTL). Fetch it promptly; do not persist it.
- `expiresInSeconds` / `expiresAt` — how long that URL remains valid (not the
  policy expiration on the vendor's `coi.expiresAt`).
- `filename` — basename of the stored object key.
- `404 vendor_not_found` if the vendor is missing from this org.
- `404 coi_document_not_found` if there is no approved COI, or the latest
  approved COI has no `pdfPath`.

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

Request history, newest first (paginated). Scope: `coi-requests:read`.

### `GET /cois`

Historical **APPROVED** COI documents for the org whose coverage was active
anytime in `[activeFrom, activeTo]`. This is every matching certificate — not
just each vendor's latest. Scope: `vendors:read`.

Query params:

| Param | Default | Notes |
|-------|---------|-------|
| `activeFrom` | `2025-03-22` | ISO date (`YYYY-MM-DD`) or ISO datetime. Date-only is the UTC start of that day. |
| `activeTo` | now | ISO date or datetime. Date-only is the UTC end of that day so the last day is inclusive. |
| `cursor`, `limit` | same as vendors | Opaque cursor pagination. |

**Overlap rule** (also documented in `server/src/http/coiCoverageWindow.js`):

Include a `Coi` where `status === APPROVED` and `pdfPath` is set, and coverage
overlaps `[activeFrom, activeTo]`:

- Coverage **start** is `submittedAt` (best available; the model has no
  separate effective date).
- Coverage **end** is the earliest non-null among `glExpirationDate` /
  `wcExpirationDate` / `umbExpirationDate` / `autoExpirationDate`. If all four
  are null, use `submittedAt` as a degenerate end so we do not invent an expiry.
- Overlap: `start <= activeTo AND end >= activeFrom`.

Returns a paginated list of `Historical COI` (newest `submittedAt` first, then
`id`). `422` if a date is invalid or `activeFrom` is after `activeTo`.

### `GET /cois/:coiId/document`

Temporary signed URL for one approved COI PDF in this org. Scope:
`vendors:read`. Response matches `GET /vendors/:id/coi/document` (plus
`coiId`). `404 coi_not_found` if the COI is missing, belongs to another org,
is not `APPROVED`, or has no `pdfPath`.

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
