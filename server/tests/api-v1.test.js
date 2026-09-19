const request = require('supertest');
const app = require('../src/app');
const { generateToken, hashToken, tokenPrefix } = require('../src/lib/apiTokens');
const { ALL_SCOPES, SCOPES } = require('../src/middleware/apiAuth');
const { prisma, createTestVendor, createTestCoi, cleanupTestData } = require('./setup');

const DAY = 24 * 60 * 60 * 1000;

async function createApiClient({ orgId = null, allOrgs = false, scopes = ALL_SCOPES }) {
  const token = generateToken('test');
  await prisma.apiClient.create({
    data: {
      name: 'test-client',
      tokenHash: hashToken(token),
      tokenPrefix: tokenPrefix(token),
      scopes,
      orgId,
      allOrgs,
    },
  });
  return token;
}

function createOrg(slug) {
  return prisma.organization.create({
    data: { name: `Org ${slug}`, email: `${slug}@test.com`, slug, settings: { create: {} } },
  });
}

let orgA, orgB, vendorWithCoi, vendorNoCoi;
let tokenA, tokenB, tokenReadOnly, tokenAll;

beforeAll(async () => {
  await cleanupTestData();

  const ts = Date.now();
  orgA = await createOrg(`org-a-${ts}`);
  orgB = await createOrg(`org-b-${ts}`);

  // Vendor with an approved COI: GL $2M (compliant), Auto expiring within 30d.
  vendorWithCoi = await createTestVendor(orgA.id, { name: 'Apex Electrical', email: 'bids@apex.com' });
  await prisma.vendor.update({ where: { id: vendorWithCoi.id }, data: { coiStatus: 'COMPLIANT', trade: 'Electrical', phone: '+16155551234' } });
  await createTestCoi(vendorWithCoi.id, orgA.id, {
    status: 'APPROVED',
    glCoverageAmount: 200000000, // $2,000,000 in cents
    glExpirationDate: new Date(Date.now() + 90 * DAY),
    autoCoverageAmount: 100000000,
    autoExpirationDate: new Date(Date.now() + 10 * DAY), // expiring soon
  });

  // Vendor with no COI (for the request flow).
  vendorNoCoi = await createTestVendor(orgA.id, { name: 'Zenith Plumbing', email: 'z@zenith.com' });
  await prisma.vendor.update({ where: { id: vendorNoCoi.id }, data: { coiStatus: 'NO_COI' } });

  tokenA = await createApiClient({ orgId: orgA.id });
  tokenB = await createApiClient({ orgId: orgB.id });
  tokenReadOnly = await createApiClient({ orgId: orgA.id, scopes: [SCOPES.VENDORS_READ] });
  tokenAll = await createApiClient({ allOrgs: true });
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

describe('API v1 auth', () => {
  it('401 without a token', async () => {
    const res = await request(app).get(`/api/v1/orgs/${orgA.slug}/vendors`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('401 with an invalid token', async () => {
    const res = await request(app).get(`/api/v1/orgs/${orgA.slug}/vendors`).set(auth('prf_test_bogus'));
    expect(res.status).toBe(401);
  });

  it('404 for an unknown org (valid token)', async () => {
    const res = await request(app).get('/api/v1/orgs/does-not-exist/vendors').set(auth(tokenA));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('organization_not_found');
  });

  it("403 when a token is used against another org", async () => {
    const res = await request(app).get(`/api/v1/orgs/${orgA.slug}/vendors`).set(auth(tokenB));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('allows a platform (all-orgs) token', async () => {
    const res = await request(app).get(`/api/v1/orgs/${orgA.slug}/vendors`).set(auth(tokenAll));
    expect(res.status).toBe(200);
  });

  it('accepts the dev-bypass header when no token is present', async () => {
    const res = await request(app)
      .get(`/api/v1/orgs/${orgA.slug}/vendors`)
      .set('x-helm-test-org-slug', orgA.slug);
    expect(res.status).toBe(200);
  });

  it('resolves an org by id as well as slug', async () => {
    const res = await request(app).get(`/api/v1/orgs/${orgA.id}/vendors`).set(auth(tokenA));
    expect(res.status).toBe(200);
  });
});

describe('GET /vendors', () => {
  it('returns a paginated envelope with mapped COI status', async () => {
    const res = await request(app).get(`/api/v1/orgs/${orgA.slug}/vendors`).set(auth(tokenA));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('nextCursor');
    expect(res.body).toHaveProperty('hasMore');

    const apex = res.body.data.find((v) => v.name === 'Apex Electrical');
    expect(apex.coi.status).toBe('compliant');
    expect(apex.trade).toBe('Electrical');
    // Earliest expiration across coverages drives expiresAt (the auto policy).
    expect(apex.coi.expiresAt).toBe(new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10));
    // List form omits coverages.
    expect(apex.coi.coverages).toBeUndefined();
  });

  it('filters by coiStatus', async () => {
    const res = await request(app).get(`/api/v1/orgs/${orgA.slug}/vendors?coiStatus=none`).set(auth(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.data.every((v) => v.coi.status === 'none')).toBe(true);
    expect(res.body.data.some((v) => v.name === 'Zenith Plumbing')).toBe(true);
  });

  it('422 on an unknown coiStatus filter', async () => {
    const res = await request(app).get(`/api/v1/orgs/${orgA.slug}/vendors?coiStatus=bogus`).set(auth(tokenA));
    expect(res.status).toBe(422);
  });

  it('paginates with an opaque cursor without dupes', async () => {
    const pgOrg = await createOrg(`org-pg-${Date.now()}`);
    for (const name of ['Alpha', 'Bravo', 'Charlie']) {
      await createTestVendor(pgOrg.id, { name, email: `${name}@pg.com` });
    }
    const token = await createApiClient({ orgId: pgOrg.id });

    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const url = `/api/v1/orgs/${pgOrg.slug}/vendors?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await request(app).get(url).set(auth(token));
      expect(res.status).toBe(200);
      res.body.data.forEach((v) => seen.push(v.name));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor && pages < 5);

    expect(seen).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(new Set(seen).size).toBe(3);
  });
});

describe('GET /vendors/:id', () => {
  it('returns full coverages with dollar limits and per-coverage status', async () => {
    const res = await request(app).get(`/api/v1/orgs/${orgA.slug}/vendors/${vendorWithCoi.id}`).set(auth(tokenA));
    expect(res.status).toBe(200);
    const v = res.body.data;
    expect(Array.isArray(v.coi.coverages)).toBe(true);

    const gl = v.coi.coverages.find((c) => c.type === 'general_liability');
    expect(gl.limit).toBe(2000000); // cents -> dollars
    expect(gl.status).toBe('compliant');

    const auto = v.coi.coverages.find((c) => c.type === 'auto');
    expect(auto.status).toBe('expiring_soon');
  });

  it('404 for a vendor not in this org', async () => {
    const res = await request(app).get(`/api/v1/orgs/${orgA.slug}/vendors/00000000-0000-0000-0000-000000000000`).set(auth(tokenA));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('vendor_not_found');
  });
});

describe('POST /vendors/:id/coi-requests', () => {
  it('creates a request, returns 201, and flips a NO_COI vendor to pending', async () => {
    const res = await request(app)
      .post(`/api/v1/orgs/${orgA.slug}/vendors/${vendorNoCoi.id}/coi-requests`)
      .set(auth(tokenA))
      .send({ coverageTypes: ['general_liability'], note: 'Needed to award', requestedByEmail: 'est@buildco.com' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('requested');
    expect(res.body.data.coverageTypes).toEqual(['general_liability']);
    expect(res.body.data.vendorId).toBe(vendorNoCoi.id);

    const vendor = await prisma.vendor.findUnique({ where: { id: vendorNoCoi.id } });
    expect(vendor.coiStatus).toBe('PENDING');
  });

  it('409 when a request is already open', async () => {
    const res = await request(app)
      .post(`/api/v1/orgs/${orgA.slug}/vendors/${vendorNoCoi.id}/coi-requests`)
      .set(auth(tokenA))
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('coi_request_conflict');
    expect(res.body.error.details.request).toHaveProperty('id');
  });

  it('422 on unknown coverage types', async () => {
    const res = await request(app)
      .post(`/api/v1/orgs/${orgA.slug}/vendors/${vendorWithCoi.id}/coi-requests`)
      .set(auth(tokenA))
      .send({ coverageTypes: ['not_a_real_coverage'] });
    expect(res.status).toBe(422);
  });

  it('403 when the token lacks the write scope', async () => {
    const res = await request(app)
      .post(`/api/v1/orgs/${orgA.slug}/vendors/${vendorWithCoi.id}/coi-requests`)
      .set(auth(tokenReadOnly))
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('GET /vendors/:id/coi-requests', () => {
  it('lists prior requests newest-first', async () => {
    const res = await request(app)
      .get(`/api/v1/orgs/${orgA.slug}/vendors/${vendorNoCoi.id}/coi-requests`)
      .set(auth(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].vendorId).toBe(vendorNoCoi.id);
  });
});

describe('COI request auto-resolves when the vendor becomes compliant', () => {
  it('marks open requests FULFILLED via updateVendorStatus', async () => {
    const { updateVendorStatus } = require('../src/services/compliance');
    // vendorNoCoi has an open REQUESTED row from the POST test. Give it an
    // approved, in-force COI meeting all required minimums so status computes to
    // COMPLIANT, and recompute status.
    await createTestCoi(vendorNoCoi.id, orgA.id, {
      status: 'APPROVED',
      glCoverageAmount: 200000000,
      glExpirationDate: new Date(Date.now() + 120 * DAY),
      wcCoverageAmount: 100000000,
      wcExpirationDate: new Date(Date.now() + 120 * DAY),
      umbCoverageAmount: 200000000,
      umbExpirationDate: new Date(Date.now() + 120 * DAY),
      autoCoverageAmount: 200000000,
      autoExpirationDate: new Date(Date.now() + 120 * DAY),
    });
    await updateVendorStatus(prisma, vendorNoCoi.id, orgA.id);

    const open = await prisma.coiRequest.findFirst({ where: { vendorId: vendorNoCoi.id, status: 'REQUESTED' } });
    expect(open).toBeNull();
  });
});
