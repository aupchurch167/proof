# Tenant isolation tests — two-org matrix

Prefix: `proof-2026-09-20`. These cases are **not implemented** (Prompt F is out of scope). Each case assumes:

- `orgA` + `adminA` / `memberA` / optional `viewerA`
- `orgB` + `adminB`
- `vendorA` / `coiA` in A; `vendorB` / `coiB` in B
- Optional: `vendorA` and `vendorB` share email `shared@sub.com`
- Tokens: `tokenA`, `tokenB`, `apiTokenA`, `apiTokenB`

Helpers already exist: `server/tests/setup.js` `createTestOrg`, `createTestUser`, `createTestVendor`, `createTestCoi`, `getAuthToken`.

Assertion rule: org A credentials never see org B **bodies**. Prefer 404 over 403 on IDs to avoid oracles (current code already 404s most IDOR).

---

## Session API

| ID | Route | Setup | Call | Expect |
|---|---|---|---|---|
| V-01 | GET /api/vendors | vendorA, vendorB | tokenA | only vendorA; **no** `uploadToken` after A2-04 |
| V-02 | GET /api/vendors/:id | | tokenA + vendorB.id | 404 |
| V-03 | PUT /api/vendors/:id | | tokenA + vendorB.id `{name:'x'}` | 404; vendorB.name unchanged |
| V-04 | DELETE /api/vendors/:id | | tokenA + vendorB.id | 404; vendorB.deletedAt null |
| V-05 | DELETE /api/vendors/bulk | | tokenA `{ids:[vendorB.id]}` | 200 count 0; vendorB intact; **no** Spaces delete of B |
| V-06 | POST /api/vendors/:id/coi/upload | | tokenA + vendorB.id + pdf | 404; no Coi row |
| V-07 | POST /api/vendors/:id/request-coi | | tokenA + vendorB.id | 404; no email to B |
| V-08 | POST /api/vendors/:id/documents | | tokenA + vendorB.id | 404 |
| V-09 | POST /api/vendors | | tokenA `{name,email}` | orgId === orgA.id |
| C-01 | GET /api/cois | coiA, coiB | tokenA | only coiA |
| C-02 | GET /api/cois/:id | | tokenA + coiB.id | 404 |
| C-03 | GET /api/cois/:id/pdf | | tokenA + coiB.id | 404; no signed URL |
| C-04 | PUT /api/cois/:id | | tokenA + coiB.id | 404 |
| C-05 | POST /api/cois/:id/approve | | tokenA + coiB.id | 404; coiB.status unchanged |
| C-06 | POST /api/cois/:id/reject | | tokenA + coiB.id | 404 |
| C-07 | POST /api/cois/:id/reanalyze | | tokenA + coiB.id | 404; Anthropic not called |
| C-08 | DELETE /api/cois/:id | | tokenA + coiB.id | 404 |
| R-01 | GET /api/reports/compliance | | tokenA | counts from A only |
| R-02 | GET /api/reports/coverage | | tokenA | vendorB absent |
| R-03 | GET /api/reports/cois | | tokenA | coiB absent |
| R-04 | GET /api/reports/expiring | | tokenA | coiB absent |
| R-05 | POST /api/reports/export-pdfs | | tokenA `{coiIds:[coiB.id]}` | 404 empty / no B pages |
| U-01 | GET /api/users | user in B | tokenA | B emails absent |
| U-02 | PUT /api/users/:id/role | | tokenA + adminB.id | 404; adminB.role unchanged |
| U-03 | DELETE /api/users/:id | | tokenA + adminB.id | 404 |
| U-04 | POST /api/users/invite | | tokenA `{email: adminB.email}` | 409 (global unique) — document, not isolation fail |
| O-01 | GET /api/organization | | tokenA | id === orgA.id |
| O-02 | PUT /api/organization | | tokenA `{name:'Hacked'}` as adminA | orgB.name unchanged |
| O-03 | GET /api/organization/usage | | tokenA | no portal token of B; after fix, no token at all for non-admin |
| S-01 | GET /api/settings | | tokenA | settings.orgId A |
| S-02 | PUT /api/settings | | tokenA `{minUmbrella:1}` | B settings unchanged |
| Q-01 | GET /api/requirements | | tokenA | orgName of A |
| Q-02 | PUT /api/requirements/default | | tokenA | B settings unchanged |
| Q-03 | PUT /api/requirements/coverage-period/set | | tokenA | B coveragePeriod unchanged |
| Q-04 | POST /api/requirements/impact | | tokenA | vendorCount of A |
| K-01 | GET /api/compliance/overview | | tokenA | vendorB absent |
| K-02 | POST /api/compliance/vendors/:id/contacted | | tokenA + vendorB.id | 404 (**exists** `compliance.test.js`) |
| N-01 | GET /api/notifications | logs in both | tokenA | only A |
| A-01 | GET /api/audit | | tokenA | only A |
| A-02 | GET /api/audit?vendorId=vendorB.id | | tokenA | empty / no B entities |
| A-03 | GET /api/audit/week | | tokenA | counts A |
| M-01 | GET /api/reminders/upcoming | | tokenA | vendorB absent |
| P-01 | GET /api/replies | reply audits both | tokenA | only A |
| P-02 | GET /api/replies/vendor/:vendorId | | tokenA + vendorB.id | 404 |
| I-01 | POST /api/import/vendors | | tokenA CSV | created.orgId A |
| I-02 | POST /api/import/cois | vendorB.email in CSV | tokenA | skipped “no vendor”; no Coi on B |
| G-01 | GET /api/integrations/api-keys | keys both | tokenA | only A; no hashes |
| G-02 | DELETE /api/integrations/api-keys/:id | | tokenA + keyB.id | 404; keyB usable |
| G-03 | GET /api/integrations/webhooks | | tokenA | only A; no secrets |
| G-04 | PUT/DELETE /api/integrations/webhooks/:id | | tokenA + epB.id | 404 |

## Portal / apply / webhook (shared-secret surfaces)

| ID | Route | Setup | Call | Expect |
|---|---|---|---|---|
| T-01 | GET /api/portal/:token | tokenB | unauth GET tokenB | 200 of vendorB only (by design) |
| T-02 | GET /api/portal/:token | | tokenA string | not vendorB |
| T-03 | PUT /api/portal/:tokenA/info | | `{email: vendorB.email}` | updates A only |
| T-04 | POST /api/portal/:tokenB/upload | tokenA session unused | pdf | Coi.orgId === orgB (**must not** land on A) |
| L-01 | GET /api/apply/:slug | slugB | GET | name of B only |
| L-02 | GET /api/apply/:orgB.id | | GET | **404 after A2-05** (today 200 — this is the regression test) |
| L-03 | POST /api/apply/:slugA | | body email of vendorB | creates in A, does not mutate B |
| WH-1 | POST /api/webhooks/resend-inbound | shared email, A sent last request | signed inbound from that email + pdf | **Coi + audit only on A** (today fails — A2-01) |
| WH-2 | same | unsigned, secret set | | 401, zero rows |
| WH-3 | bounce | shared recipient, recent SENT on A and B | | only correlated org flips (today may flip the newest globally — A2-08) |

## v1 API (several already written)

| ID | Route | Call | Expect | Existing? |
|---|---|---|---|---|
| V1-01 | GET /api/v1/orgs/:slugB/vendors | apiTokenA | 403 | yes `api-v1.test.js` / `integrations.test.js` |
| V1-02 | GET /api/v1/orgs/:slugA/vendors/:vendorB | apiTokenA | 404 | yes pattern |
| V1-03 | GET .../vendors/:vendorB/coi/document | apiTokenA | 404 | |
| V1-04 | GET .../cois/:coiB/document | apiTokenA | 404 | yes `api-v1.test.js:518` |
| V1-05 | POST .../vendors/:vendorB/coi-requests | apiTokenA | 404 | |
| V1-06 | GET .../cois | apiTokenA | no coiB | |
| V1-07 | allOrgs token + slugA | platform token | 200 A data only in that path | add |
| V1-08 | revoked token | | 401 | yes integrations |

## Auth / identity

| ID | Route | Setup | Expect |
|---|---|---|---|
| X-01 | POST /api/auth/refresh | refreshA after adminB deletes userA | 401 |
| X-02 | GET /api/auth/me | tokenA | orgId A |
| X-03 | PUT /api/auth/me email | email of adminB | 409; adminB unchanged |
| X-04 | POST /api/auth/google | Google email = unverified userA | **must not** attach (A1-03) |

## Cron / jobs

| ID | Job | Setup | Expect |
|---|---|---|---|
| J-01 | runExpirationSweep | expiring COI in A and B | emails and NotificationLog.orgId match; no cross |
| J-02 | emitCoiUpdated | endpoint on A only | no POST to B URL | exists `webhook-dispatch.test.js` |
| J-03 | Core mirror | flag on, CORE slug = A | create vendor in B → no Core call (A2-03) |

## Structural (after A2-06)

| ID | Action | Expect |
|---|---|---|
| Z-01 | `prisma.vendor.findMany({ where: { email } })` without orgId | throws in tests |
