jest.mock('../src/services/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('test/mock.pdf'),
  getSignedUrl: jest.fn().mockResolvedValue('https://mock/test.pdf'),
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('pdf')),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/email', () => ({
  sendUploadRequestEmail: jest.fn().mockResolvedValue(undefined),
  sendChaseEmail: jest.fn().mockResolvedValue(undefined),
  sendUploadNotificationEmail: jest.fn().mockResolvedValue(undefined),
  sendExpirationReminderEmail: jest.fn().mockResolvedValue(undefined),
  sendWeeklySummaryEmail: jest.fn().mockResolvedValue(undefined),
  sendRejectionEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const app = require('../src/app');
const {
  prisma, createTestOrg, createTestUser, createTestVendor, createTestCoi,
  createTestNotification, daysAgo, daysFromNow, getAuthToken, cleanupTestData,
} = require('./setup');

let org, admin, token;

beforeAll(async () => {
  await cleanupTestData();
  org = await createTestOrg();
  admin = await createTestUser(org.id, { email: `screens-${Date.now()}@test.com` });
  token = getAuthToken(admin);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('GET /api/vendors — coverage chips', () => {
  it('returns a verdict for all four coverage lines on every vendor', async () => {
    const vendor = await createTestVendor(org.id, { name: 'Chip Co' });
    await createTestCoi(vendor.id, org.id, {
      status: 'APPROVED',
      glCoverageAmount: 200000000,
      glExpirationDate: daysFromNow(200),
    });

    const res = await request(app).get('/api/vendors').set(auth());

    expect(res.status).toBe(200);
    const row = res.body.find((v) => v.name === 'Chip Co');
    expect(row.coverages.map((c) => c.chip)).toEqual(['GL', 'Auto', 'WC', 'Umb']);
    expect(row.coverages.find((c) => c.key === 'gl').verdict).toBe('meets');
    // Defaults require WC, and this COI has none.
    expect(row.coverages.find((c) => c.key === 'wc').verdict).toBe('missing');
    expect(row.statusReason).toBeTruthy();
  });

  it('ignores a rejected certificate when judging coverage', async () => {
    const vendor = await createTestVendor(org.id, { name: 'Rejected Only' });
    await createTestCoi(vendor.id, org.id, {
      status: 'REJECTED',
      glCoverageAmount: 500000000,
      glExpirationDate: daysFromNow(300),
    });

    const res = await request(app).get('/api/vendors').set(auth());
    const row = res.body.find((v) => v.name === 'Rejected Only');
    expect(row.coverages.find((c) => c.key === 'gl').verdict).toBe('missing');
  });
});

describe('GET /api/reports/coverage', () => {
  it('builds a timeline with segments the client can draw', async () => {
    const vendor = await createTestVendor(org.id, { name: 'Timeline Co' });
    await prisma.vendor.update({ where: { id: vendor.id }, data: { createdAt: daysAgo(300) } });
    await createTestCoi(vendor.id, org.id, {
      status: 'APPROVED',
      submittedAt: daysAgo(300),
      glExpirationDate: daysFromNow(100),
    });

    const from = daysAgo(200).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const res = await request(app).get(`/api/reports/coverage?from=${from}&to=${to}&type=gl`).set(auth());

    expect(res.status).toBe(200);
    expect(res.body.days).toBe(200);
    const row = res.body.rows.find((r) => r.name === 'Timeline Co');
    expect(row.full).toBe(true);
    expect(row.segments.every((s) => typeof s.fraction === 'number')).toBe(true);
  });

  it('400s without a date range', async () => {
    const res = await request(app).get('/api/reports/coverage').set(auth());
    expect(res.status).toBe(400);
  });

  it('400s on an unknown coverage type', async () => {
    const res = await request(app)
      .get('/api/reports/coverage?from=2026-01-01&to=2026-06-01&type=flood')
      .set(auth());
    expect(res.status).toBe(400);
  });
});

describe('GET /api/reminders/upcoming', () => {
  it('schedules the next chase step for a vendor who never replied', async () => {
    const vendor = await createTestVendor(org.id, { name: 'Silent Co' });
    await createTestNotification(org.id, vendor.id, {
      type: 'UPLOAD_REQUEST',
      recipientEmail: vendor.email,
      sentAt: daysAgo(4),
    });

    const res = await request(app).get('/api/reminders/upcoming').set(auth());

    expect(res.status).toBe(200);
    expect(res.body.chaseDays).toEqual([3, 7, 14]);
    const row = res.body.scheduled.find((s) => s.vendorName === 'Silent Co');
    expect(row).toBeTruthy();
    expect(row.kind).toBe('chase');
  });

  it('moves a vendor past the whole ladder into "not responding"', async () => {
    const vendor = await createTestVendor(org.id, { name: 'Gone Quiet' });
    await createTestNotification(org.id, vendor.id, {
      type: 'UPLOAD_REQUEST', recipientEmail: vendor.email, sentAt: daysAgo(30),
    });
    for (const step of [3, 7, 14]) {
      await createTestNotification(org.id, vendor.id, {
        type: 'UPLOAD_CHASE', recipientEmail: vendor.email, sentAt: daysAgo(30 - step), meta: { step },
      });
    }

    const res = await request(app).get('/api/reminders/upcoming').set(auth());
    const row = res.body.notResponding.find((v) => v.vendorName === 'Gone Quiet');
    expect(row).toBeTruthy();
    expect(row.chasesSent).toBe(3);
  });

  it('stops scheduling once the vendor uploads', async () => {
    const vendor = await createTestVendor(org.id, { name: 'Responded Co' });
    await createTestNotification(org.id, vendor.id, {
      type: 'UPLOAD_REQUEST', recipientEmail: vendor.email, sentAt: daysAgo(10),
    });
    await createTestCoi(vendor.id, org.id, { submittedAt: daysAgo(1) });

    const res = await request(app).get('/api/reminders/upcoming').set(auth());
    expect(res.body.scheduled.find((s) => s.vendorName === 'Responded Co' && s.kind === 'chase')).toBeUndefined();
  });
});

describe('Requirements', () => {
  it('exposes the default template built from the org coverage minimums', async () => {
    const res = await request(app).get('/api/requirements').set(auth());

    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(1);
    const tpl = res.body.templates[0];
    expect(tpl.coverages.map((c) => c.key)).toEqual(['gl', 'auto', 'wc', 'umb']);
    expect(tpl.coverages.find((c) => c.key === 'gl').minLimit).toBe(1000000);
    // The UI needs to know not to offer a button that cannot work yet.
    expect(res.body.multiTemplateSupported).toBe(false);
  });

  it('saves a changed minimum and reflects it back', async () => {
    const res = await request(app)
      .put('/api/requirements/default')
      .set(auth())
      .send({ coverages: [{ key: 'gl', required: true, minLimit: 2000000 }] });

    expect(res.status).toBe(200);
    expect(res.body.coverages.find((c) => c.key === 'gl').minLimit).toBe(2000000);

    const settings = await prisma.organizationSettings.findUnique({ where: { orgId: org.id } });
    expect(settings.minGeneralLiability).toBe(200000000);
  });

  it('stores a coverage switched off as no requirement at all', async () => {
    const res = await request(app)
      .put('/api/requirements/default')
      .set(auth())
      .send({ coverages: [{ key: 'umb', required: false, minLimit: 2000000 }] });

    expect(res.status).toBe(200);
    expect(res.body.coverages.find((c) => c.key === 'umb').required).toBe(false);
  });

  it('rejects a required coverage with no limit', async () => {
    const res = await request(app)
      .put('/api/requirements/default')
      .set(auth())
      .send({ coverages: [{ key: 'gl', required: true, minLimit: 0 }] });

    expect(res.status).toBe(400);
  });

  it('404s for a template that needs the model that does not exist yet', async () => {
    const res = await request(app)
      .put('/api/requirements/hvac-template')
      .set(auth())
      .send({ coverages: [] });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('dry-runs a limit change and counts who would newly fail', async () => {
    // Pin the current minimum so this test doesn't inherit one an earlier test
    // raised — "newly failing" is meaningless without a known starting point.
    await request(app)
      .put('/api/requirements/default')
      .set(auth())
      .send({ coverages: [{ key: 'gl', required: true, minLimit: 1000000 }] });

    const vendor = await createTestVendor(org.id, { name: 'Impact Co' });
    await createTestCoi(vendor.id, org.id, {
      status: 'APPROVED',
      glCoverageAmount: 150000000, // $1.5M
      glExpirationDate: daysFromNow(200),
      autoCoverageAmount: 150000000,
      autoExpirationDate: daysFromNow(200),
      wcCoverageAmount: 150000000,
      wcExpirationDate: daysFromNow(200),
    });

    const res = await request(app)
      .post('/api/requirements/impact')
      .set(auth())
      .send({ coverages: [{ key: 'gl', required: true, minLimit: 5000000 }] }); // $5M

    expect(res.status).toBe(200);
    expect(res.body.wouldFail).toBeGreaterThanOrEqual(res.body.currentlyFailing);
    expect(res.body.examples.some((e) => e.name === 'Impact Co')).toBe(true);
  });

  it('saves the coverage period', async () => {
    const res = await request(app)
      .put('/api/requirements/coverage-period/set')
      .set(auth())
      .send({ mode: 'Custom', start: '2026-01-01', end: '2026-12-31', warnInPeriod: true });

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('Custom');
    expect(res.body.start).toBe('2026-01-01');
  });

  it('rejects a period that ends before it starts', async () => {
    const res = await request(app)
      .put('/api/requirements/coverage-period/set')
      .set(auth())
      .send({ start: '2026-12-31', end: '2026-01-01' });

    expect(res.status).toBe(400);
  });

  it('saves the holder switch and a zero-day expiring window', async () => {
    const res = await request(app)
      .put('/api/requirements/default')
      .set(auth())
      .send({ requireHolderMatch: false, expiringWindowDays: 0 });

    expect(res.status).toBe(200);
    expect(res.body.requireHolderMatch).toBe(false);
    expect(res.body.expiringWindowDays).toBe(0);
  });

  it('rejects an expiring window outside 0 to 365', async () => {
    const res = await request(app)
      .put('/api/requirements/default')
      .set(auth())
      .send({ expiringWindowDays: 400 });

    expect(res.status).toBe(400);
  });

  it('recomputes the vendor badge when a required line is switched off', async () => {
    const vendor = await createTestVendor(org.id, { name: 'Optional After Save' });
    await createTestCoi(vendor.id, org.id, {
      status: 'APPROVED',
      certificateHolderName: org.name,
      glCoverageAmount: 200000000,
      glExpirationDate: daysFromNow(200),
      wcCoverageAmount: 100000000,
      wcExpirationDate: daysFromNow(200),
      autoCoverageAmount: 200000000,
      autoExpirationDate: daysFromNow(200),
    });

    const required = await request(app)
      .put('/api/requirements/default')
      .set(auth())
      .send({
        coverages: [{ key: 'umb', required: true, minLimit: 1000000 }],
        requireHolderMatch: true,
        expiringWindowDays: 30,
      });
    expect(required.status).toBe(200);
    expect((await prisma.vendor.findUnique({ where: { id: vendor.id } })).coiStatus).toBe('NON_COMPLIANT');

    const optional = await request(app)
      .put('/api/requirements/default')
      .set(auth())
      .send({
        coverages: [{ key: 'umb', required: false }],
        requireHolderMatch: true,
        expiringWindowDays: 30,
      });
    expect(optional.status).toBe(200);
    expect((await prisma.vendor.findUnique({ where: { id: vendor.id } })).coiStatus).toBe('COMPLIANT');
  });
});

describe('GET /api/audit', () => {
  it('merges what people did with what Proof sent, newest first', async () => {
    const vendor = await createTestVendor(org.id, { name: 'Audited Co' });
    await createTestNotification(org.id, vendor.id, {
      type: 'UPLOAD_REQUEST', recipientEmail: vendor.email, sentAt: daysAgo(1),
    });
    await prisma.auditLog.create({
      data: { orgId: org.id, userId: admin.id, action: 'approve', entity: 'coi', entityId: 'x', details: { vendorName: 'Audited Co' } },
    });

    const res = await request(app).get('/api/audit?range=30').set(auth());

    expect(res.status).toBe(200);
    expect(res.body.events.length).toBeGreaterThan(0);
    expect(res.body.counts.All).toBe(res.body.events.length);
    expect(res.body.events.some((e) => e.type === 'Approved' && e.by.includes('Test'))).toBe(true);
    expect(res.body.events.some((e) => e.type === 'Reminder' && e.by === 'Proof')).toBe(true);

    const times = res.body.events.map((e) => new Date(e.at).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('filters by actor without changing the tile counts', async () => {
    const all = await request(app).get('/api/audit?range=30').set(auth());
    const proofOnly = await request(app).get('/api/audit?range=30&actor=Proof (automatic)').set(auth());

    expect(proofOnly.body.events.every((e) => e.by === 'Proof')).toBe(true);
    expect(proofOnly.body.events.length).toBeLessThanOrEqual(all.body.events.length);
  });

  it('narrows to one event type', async () => {
    const res = await request(app).get('/api/audit?range=30&type=Approved').set(auth());
    expect(res.body.events.every((e) => e.type === 'Approved')).toBe(true);
  });

  it('searches the detail line', async () => {
    const res = await request(app).get('/api/audit?range=30&search=Audited Co').set(auth());
    expect(res.body.events.every((e) => e.detail.includes('Audited Co'))).toBe(true);
  });
});

describe('GET /api/organization/usage', () => {
  it('reports the plan meter and a portal preview token', async () => {
    const res = await request(app).get('/api/organization/usage').set(auth());

    expect(res.status).toBe(200);
    expect(res.body.planLabel).toBe('Free');
    expect(res.body.vendors.limit).toBe(20);
    expect(typeof res.body.vendors.percent).toBe('number');
    expect(res.body.portalPreviewToken).toBeTruthy();
  });
});
