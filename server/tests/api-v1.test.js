jest.mock('../src/services/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('test/mock-file.pdf'),
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-signed-url.com/test.pdf'),
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('mock-pdf')),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const app = require('../src/app');
const { getSignedUrl } = require('../src/services/storage');
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

  it('uses the saved expiring window for per-coverage status', async () => {
    await prisma.organizationSettings.update({
      where: { orgId: orgA.id },
      data: { expiringWindowDays: 5 },
    });
    try {
      const res = await request(app)
        .get(`/api/v1/orgs/${orgA.slug}/vendors/${vendorWithCoi.id}`)
        .set(auth(tokenA));
      expect(res.status).toBe(200);
      const auto = res.body.data.coi.coverages.find((c) => c.type === 'auto');
      // Auto expires in 10 days. A 5-day window must not call that expiring soon.
      expect(auto.status).toBe('compliant');
    } finally {
      await prisma.organizationSettings.update({
        where: { orgId: orgA.id },
        data: { expiringWindowDays: 30 },
      });
    }
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

describe('GET /vendors/:id/coi/document', () => {
  it('returns a signed URL for the latest approved COI PDF', async () => {
    const vendor = await createTestVendor(orgA.id, {
      name: 'Doc Vendor',
      email: `doc-${Date.now()}@apex.com`,
    });
    await createTestCoi(vendor.id, orgA.id, {
      status: 'APPROVED',
      pdfPath: 'cois/older.pdf',
      submittedAt: new Date(Date.now() - DAY),
    });
    // Newer but not approved — must not win over the latest APPROVED row.
    await createTestCoi(vendor.id, orgA.id, {
      status: 'PENDING_REVIEW',
      pdfPath: 'cois/pending.pdf',
      submittedAt: new Date(),
    });
    const latest = await createTestCoi(vendor.id, orgA.id, {
      status: 'APPROVED',
      pdfPath: 'cois/latest-approved.pdf',
      submittedAt: new Date(Date.now() - 60 * 1000),
    });

    getSignedUrl.mockClear();
    const before = Date.now();
    const res = await request(app)
      .get(`/api/v1/orgs/${orgA.slug}/vendors/${vendor.id}/coi/document`)
      .set(auth(tokenReadOnly));

    expect(res.status).toBe(200);
    expect(getSignedUrl).toHaveBeenCalledWith('cois/latest-approved.pdf');
    expect(res.body.data).toMatchObject({
      url: 'https://mock-signed-url.com/test.pdf',
      expiresInSeconds: 900,
      contentType: 'application/pdf',
      filename: 'latest-approved.pdf',
      coiId: latest.id,
    });
    const expiresAtMs = new Date(res.body.data.expiresAt).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + 900 * 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(Date.now() + 900 * 1000);
  });

  it('404 when the vendor is missing', async () => {
    const res = await request(app)
      .get(`/api/v1/orgs/${orgA.slug}/vendors/00000000-0000-0000-0000-000000000000/coi/document`)
      .set(auth(tokenA));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('vendor_not_found');
  });

  it('404 when there is no approved COI with a pdfPath', async () => {
    const noDoc = await createTestVendor(orgA.id, {
      name: 'No Doc Vendor',
      email: `nodoc-${Date.now()}@apex.com`,
    });
    const emptyPdf = await createTestVendor(orgA.id, {
      name: 'Empty PDF Vendor',
      email: `emptypdf-${Date.now()}@apex.com`,
    });
    await createTestCoi(emptyPdf.id, orgA.id, { status: 'APPROVED', pdfPath: '' });

    const missing = await request(app)
      .get(`/api/v1/orgs/${orgA.slug}/vendors/${noDoc.id}/coi/document`)
      .set(auth(tokenA));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('coi_document_not_found');

    const empty = await request(app)
      .get(`/api/v1/orgs/${orgA.slug}/vendors/${emptyPdf.id}/coi/document`)
      .set(auth(tokenA));
    expect(empty.status).toBe(404);
    expect(empty.body.error.code).toBe('coi_document_not_found');
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

describe('GET /cois', () => {
  let histOrg, histToken, histVendor, overlapping, expiredBefore, submittedAfter, pending, emptyPdf, degenerate;

  beforeAll(async () => {
    histOrg = await createOrg(`org-hist-${Date.now()}`);
    histToken = await createApiClient({ orgId: histOrg.id, scopes: [SCOPES.VENDORS_READ] });
    histVendor = await createTestVendor(histOrg.id, {
      name: 'Historical Electric',
      email: `hist-${Date.now()}@apex.com`,
    });

    overlapping = await createTestCoi(histVendor.id, histOrg.id, {
      status: 'APPROVED',
      pdfPath: 'cois/overlapping.pdf',
      submittedAt: new Date('2025-01-15T12:00:00.000Z'),
      glCoverageAmount: 200000000,
      glExpirationDate: new Date('2025-12-01T00:00:00.000Z'),
      agentName: 'Jordan Lee',
      agentEmail: 'jordan@broker.com',
      agentPhone: '+16155550100',
      insuranceCompany: 'Travelers',
    });
    expiredBefore = await createTestCoi(histVendor.id, histOrg.id, {
      status: 'APPROVED',
      pdfPath: 'cois/expired-before.pdf',
      submittedAt: new Date('2024-01-01T00:00:00.000Z'),
      glExpirationDate: new Date('2025-01-01T00:00:00.000Z'),
    });
    submittedAfter = await createTestCoi(histVendor.id, histOrg.id, {
      status: 'APPROVED',
      pdfPath: 'cois/submitted-after.pdf',
      submittedAt: new Date('2026-06-01T00:00:00.000Z'),
      glExpirationDate: new Date('2027-01-01T00:00:00.000Z'),
    });
    pending = await createTestCoi(histVendor.id, histOrg.id, {
      status: 'PENDING_REVIEW',
      pdfPath: 'cois/pending.pdf',
      submittedAt: new Date('2025-06-01T00:00:00.000Z'),
      glExpirationDate: new Date('2026-01-01T00:00:00.000Z'),
    });
    emptyPdf = await createTestCoi(histVendor.id, histOrg.id, {
      status: 'APPROVED',
      pdfPath: '',
      submittedAt: new Date('2025-06-01T00:00:00.000Z'),
      glExpirationDate: new Date('2026-01-01T00:00:00.000Z'),
    });
    degenerate = await createTestCoi(histVendor.id, histOrg.id, {
      status: 'APPROVED',
      pdfPath: 'cois/degenerate.pdf',
      submittedAt: new Date('2025-06-15T00:00:00.000Z'),
    });
  });

  const window = 'activeFrom=2025-03-22&activeTo=2026-03-22';

  it('returns approved COIs whose coverage overlapped the activity window', async () => {
    getSignedUrl.mockClear();
    const res = await request(app)
      .get(`/api/v1/orgs/${histOrg.slug}/cois?${window}`)
      .set(auth(histToken));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('nextCursor');
    expect(res.body).toHaveProperty('hasMore');

    const ids = res.body.data.map((c) => c.id);
    expect(ids).toContain(overlapping.id);
    expect(ids).toContain(degenerate.id);
    expect(ids).not.toContain(expiredBefore.id);
    expect(ids).not.toContain(submittedAfter.id);
    expect(ids).not.toContain(pending.id);
    expect(ids).not.toContain(emptyPdf.id);

    const row = res.body.data.find((c) => c.id === overlapping.id);
    expect(row.vendorId).toBe(histVendor.id);
    expect(row.vendorName).toBe('Historical Electric');
    expect(row.submittedAt).toBe('2025-01-15T12:00:00.000Z');
    expect(row.expiresAt).toBe('2025-12-01');
    expect(row.agentName).toBe('Jordan Lee');
    expect(row.agentEmail).toBe('jordan@broker.com');
    expect(row.agentPhone).toBe('+16155550100');
    expect(row.insuranceCompany).toBe('Travelers');
    expect(row.document).toMatchObject({
      url: 'https://mock-signed-url.com/test.pdf',
      expiresInSeconds: 900,
      contentType: 'application/pdf',
      filename: 'overlapping.pdf',
    });
    const gl = row.coverages.find((c) => c.type === 'general_liability');
    expect(gl.limit).toBe(2000000);
    expect(getSignedUrl).toHaveBeenCalledWith('cois/overlapping.pdf');

    const deg = res.body.data.find((c) => c.id === degenerate.id);
    expect(deg.expiresAt).toBeNull();
  });

  it('defaults activeFrom to 2025-03-22 and activeTo to now', async () => {
    const res = await request(app)
      .get(`/api/v1/orgs/${histOrg.slug}/cois`)
      .set(auth(histToken));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((c) => c.id);
    expect(ids).toContain(overlapping.id);
    expect(ids).not.toContain(expiredBefore.id);
  });

  it('paginates stably by submittedAt desc then id without dupes', async () => {
    const pgOrg = await createOrg(`org-cois-pg-${Date.now()}`);
    const token = await createApiClient({ orgId: pgOrg.id, scopes: [SCOPES.VENDORS_READ] });
    const vendor = await createTestVendor(pgOrg.id, { name: 'Pager', email: `pg-${Date.now()}@pg.com` });
    const stamps = [
      new Date('2025-08-01T00:00:00.000Z'),
      new Date('2025-07-01T00:00:00.000Z'),
      new Date('2025-06-01T00:00:00.000Z'),
    ];
    const created = [];
    for (const submittedAt of stamps) {
      created.push(await createTestCoi(vendor.id, pgOrg.id, {
        status: 'APPROVED',
        pdfPath: `cois/${submittedAt.toISOString()}.pdf`,
        submittedAt,
        glExpirationDate: new Date('2026-01-01T00:00:00.000Z'),
      }));
    }

    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const url = `/api/v1/orgs/${pgOrg.slug}/cois?activeFrom=2025-03-22&activeTo=2026-03-22&limit=2${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await request(app).get(url).set(auth(token));
      expect(res.status).toBe(200);
      res.body.data.forEach((c) => seen.push(c.id));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor && pages < 5);

    expect(seen).toEqual([created[0].id, created[1].id, created[2].id]);
    expect(new Set(seen).size).toBe(3);
  });

  it('422 on an invalid or inverted window', async () => {
    const bad = await request(app)
      .get(`/api/v1/orgs/${histOrg.slug}/cois?activeFrom=not-a-date`)
      .set(auth(histToken));
    expect(bad.status).toBe(422);

    const inverted = await request(app)
      .get(`/api/v1/orgs/${histOrg.slug}/cois?activeFrom=2026-01-01&activeTo=2025-01-01`)
      .set(auth(histToken));
    expect(inverted.status).toBe(422);
  });

  it('403 when the token lacks vendors:read', async () => {
    const writeOnly = await createApiClient({
      orgId: histOrg.id,
      scopes: [SCOPES.COI_REQUESTS_WRITE],
    });
    const res = await request(app)
      .get(`/api/v1/orgs/${histOrg.slug}/cois?${window}`)
      .set(auth(writeOnly));
    expect(res.status).toBe(403);
  });
});

describe('GET /cois/:id/document', () => {
  it('returns a signed URL for an approved COI in this org', async () => {
    const vendor = await createTestVendor(orgA.id, {
      name: 'Hist Doc Vendor',
      email: `histdoc-${Date.now()}@apex.com`,
    });
    const coi = await createTestCoi(vendor.id, orgA.id, {
      status: 'APPROVED',
      pdfPath: 'cois/specific.pdf',
    });

    getSignedUrl.mockClear();
    const res = await request(app)
      .get(`/api/v1/orgs/${orgA.slug}/cois/${coi.id}/document`)
      .set(auth(tokenReadOnly));

    expect(res.status).toBe(200);
    expect(getSignedUrl).toHaveBeenCalledWith('cois/specific.pdf');
    expect(res.body.data).toMatchObject({
      url: 'https://mock-signed-url.com/test.pdf',
      expiresInSeconds: 900,
      contentType: 'application/pdf',
      filename: 'specific.pdf',
      coiId: coi.id,
    });
  });

  it('404 when the COI is missing, not approved, or in another org', async () => {
    const missing = await request(app)
      .get(`/api/v1/orgs/${orgA.slug}/cois/00000000-0000-0000-0000-000000000000/document`)
      .set(auth(tokenA));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('coi_not_found');

    const vendor = await createTestVendor(orgA.id, {
      name: 'Pending Doc',
      email: `penddoc-${Date.now()}@apex.com`,
    });
    const pending = await createTestCoi(vendor.id, orgA.id, {
      status: 'PENDING_REVIEW',
      pdfPath: 'cois/not-approved.pdf',
    });
    const notApproved = await request(app)
      .get(`/api/v1/orgs/${orgA.slug}/cois/${pending.id}/document`)
      .set(auth(tokenA));
    expect(notApproved.status).toBe(404);
    expect(notApproved.body.error.code).toBe('coi_not_found');

    const otherVendor = await createTestVendor(orgB.id, {
      name: 'Other Org Vendor',
      email: `other-${Date.now()}@b.com`,
    });
    const otherCoi = await createTestCoi(otherVendor.id, orgB.id, {
      status: 'APPROVED',
      pdfPath: 'cois/other-org.pdf',
    });
    const wrongOrg = await request(app)
      .get(`/api/v1/orgs/${orgA.slug}/cois/${otherCoi.id}/document`)
      .set(auth(tokenA));
    expect(wrongOrg.status).toBe(404);
    expect(wrongOrg.body.error.code).toBe('coi_not_found');
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
      certificateHolderName: orgA.name,
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
