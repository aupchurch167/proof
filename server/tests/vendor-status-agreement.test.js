const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../src/app');
const { mergeApprovedCois } = require('../src/services/effectiveCoverage');
const {
  prisma,
  createTestOrg,
  createTestUser,
  createTestVendor,
  createTestCoi,
  daysAgo,
  daysFromNow,
  getAuthToken,
  cleanupTestData,
} = require('./setup');

let org, token;

function auth() {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  await cleanupTestData();
  org = await createTestOrg({ name: 'Status Agreement Co' });
  const user = await createTestUser(org.id, { email: `status-${Date.now()}@test.com` });
  token = getAuthToken(user);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

function approved(vendorId, overrides) {
  return createTestCoi(vendorId, org.id, {
    status: 'APPROVED',
    certificateHolderName: org.name,
    ...overrides,
  });
}

describe('effective coverage across several approved certificates', () => {
  it('keeps a line from an older certificate when the newer one omits it', () => {
    const merged = mergeApprovedCois([
      {
        id: 'new', status: 'APPROVED', submittedAt: new Date('2026-02-01'),
        autoCoverageAmount: 100, autoExpirationDate: new Date('2026-12-01'),
      },
      {
        id: 'old', status: 'APPROVED', submittedAt: new Date('2026-01-01'),
        glCoverageAmount: 200, glExpirationDate: new Date('2026-11-01'),
      },
    ]);
    expect(merged.glCoverageAmount).toBe(200);
    expect(merged.autoCoverageAmount).toBe(100);
    expect(merged.id).toBe('new');
  });

  it('lets a newer certificate replace the same line', () => {
    const merged = mergeApprovedCois([
      {
        id: 'new', status: 'APPROVED', submittedAt: new Date('2026-03-01'),
        glCoverageAmount: 50, glExpirationDate: new Date('2026-01-01'),
      },
      {
        id: 'old', status: 'APPROVED', submittedAt: new Date('2026-01-01'),
        glCoverageAmount: 500, glExpirationDate: new Date('2027-01-01'),
      },
    ]);
    expect(merged.glCoverageAmount).toBe(50);
    expect(new Date(merged.glExpirationDate).toISOString()).toBe(new Date('2026-01-01').toISOString());
  });
});

describe('badge, chips, dashboard gaps, and requirements agree', () => {
  it('reports a live gap when the stored badge still says covered', async () => {
    const vendor = await createTestVendor(org.id, {
      name: 'Split Plumbing',
      email: `split-${Date.now()}@test.com`,
    });
    await approved(vendor.id, {
      submittedAt: daysAgo(30),
      glPolicyNumber: 'GL-OLD',
      glCoverageAmount: 200000000,
      glExpirationDate: daysAgo(10),
    });
    await approved(vendor.id, {
      submittedAt: daysAgo(1),
      wcPolicyNumber: 'WC',
      wcCoverageAmount: 100000000,
      wcExpirationDate: daysFromNow(120),
      autoPolicyNumber: 'AU',
      autoCoverageAmount: 200000000,
      autoExpirationDate: daysFromNow(120),
      umbPolicyNumber: 'UMB',
      umbCoverageAmount: 200000000,
      umbExpirationDate: daysFromNow(120),
    });
    await prisma.vendor.update({
      where: { id: vendor.id },
      data: { coiStatus: 'COMPLIANT' },
    });

    const list = await request(app).get('/api/vendors').set(auth());
    const row = list.body.find((v) => v.id === vendor.id);
    expect(row.coverages.find((c) => c.key === 'gl').verdict).toBe('expired');
    expect(row.coverages.find((c) => c.key === 'wc').verdict).toBe('meets');
    expect(row.coiStatus).toBe('EXPIRED');
    expect(row.nextExpiration).toBeTruthy();

    const summary = await request(app).get('/api/reports/compliance').set(auth());
    const gapsOnList = list.body.filter((v) => v.coiStatus === 'NON_COMPLIANT' || v.coiStatus === 'EXPIRED').length;
    expect(summary.body.nonCompliant + summary.body.expired).toBe(gapsOnList);

    const overview = await request(app).get('/api/compliance/overview').set(auth());
    expect(overview.body.buckets.expired.map((v) => v.id)).toContain(vendor.id);

    const detail = await request(app).get(`/api/vendors/${vendor.id}`).set(auth());
    expect(detail.body.coiStatus).toBe('EXPIRED');
    expect(detail.body.coverages.find((c) => c.key === 'gl').verdict).toBe('expired');
  });

  it('counts a fully split book as covered when every required line is healthy', async () => {
    const vendor = await createTestVendor(org.id, {
      name: 'Four Policies',
      email: `four-${Date.now()}@test.com`,
    });
    const later = daysFromNow(180);
    await approved(vendor.id, {
      submittedAt: daysAgo(4),
      glCoverageAmount: 200000000, glExpirationDate: later, glPolicyNumber: 'G',
    });
    await approved(vendor.id, {
      submittedAt: daysAgo(3),
      wcCoverageAmount: 100000000, wcExpirationDate: later, wcPolicyNumber: 'W',
    });
    await approved(vendor.id, {
      submittedAt: daysAgo(2),
      autoCoverageAmount: 200000000, autoExpirationDate: later, autoPolicyNumber: 'A',
    });
    await approved(vendor.id, {
      submittedAt: daysAgo(1),
      umbCoverageAmount: 200000000, umbExpirationDate: later, umbPolicyNumber: 'U',
    });
    await prisma.vendor.update({ where: { id: vendor.id }, data: { coiStatus: 'NO_COI' } });

    const list = await request(app).get('/api/vendors').set(auth());
    const row = list.body.find((v) => v.id === vendor.id);
    expect(row.coverages.map((c) => c.verdict)).toEqual(['meets', 'meets', 'meets', 'meets']);
    expect(row.coiStatus).toBe('COMPLIANT');
  });

  it('requirements impact uses the same merged coverage', async () => {
    const vendor = await createTestVendor(org.id, {
      name: 'Impact Split',
      email: `impact-${Date.now()}@test.com`,
    });
    const later = daysFromNow(180);
    await approved(vendor.id, {
      submittedAt: daysAgo(2),
      glCoverageAmount: 200000000, glExpirationDate: later, glPolicyNumber: 'G',
      wcCoverageAmount: 100000000, wcExpirationDate: later, wcPolicyNumber: 'W',
      autoCoverageAmount: 200000000, autoExpirationDate: later, autoPolicyNumber: 'A',
      umbCoverageAmount: 200000000, umbExpirationDate: later, umbPolicyNumber: 'U',
    });

    const res = await request(app)
      .post('/api/requirements/impact')
      .set(auth())
      .send({
        coverages: [
          { key: 'gl', required: true, minLimit: 5000000 },
          { key: 'wc', required: true, minLimit: 500000 },
          { key: 'auto', required: true, minLimit: 1000000 },
          { key: 'umb', required: true, minLimit: 1000000 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.examples.map((v) => v.id)).toContain(vendor.id);
  });
});

describe('seed dates', () => {
  it('uses relative dates and recomputes status instead of hardcoding it', () => {
    const src = fs.readFileSync(path.join(__dirname, '../prisma/seed.js'), 'utf8');
    expect(src).toMatch(/updateVendorStatus/);
    expect(src).toMatch(/daysFromNow/);
    expect(src).not.toMatch(/2026-09-15/);
    expect(src).not.toMatch(/coiStatus:/);
  });
});
