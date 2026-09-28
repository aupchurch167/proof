jest.mock('../src/services/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('test/mock-file.pdf'),
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-signed-url.com/test.pdf'),
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('mock-pdf')),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/email', () => ({
  sendUploadRequestEmail: jest.fn().mockResolvedValue(undefined),
  sendUploadNotificationEmail: jest.fn().mockResolvedValue(undefined),
  sendExpirationReminderEmail: jest.fn().mockResolvedValue(undefined),
  sendWeeklySummaryEmail: jest.fn().mockResolvedValue(undefined),
  sendRejectionEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/coiExtractor', () => ({
  extractCoiData: jest.fn().mockResolvedValue(null),
}));

const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  createTestOrg,
  createTestUser,
  createTestVendor,
  getAuthToken,
  cleanupTestData,
} = require('./setup');
const { sendUploadRequestEmail } = require('../src/services/email');

let org, user, token;

beforeAll(async () => {
  await cleanupTestData();
  org = await createTestOrg();
  user = await createTestUser(org.id, { email: 'vendortest@test.com' });
  token = getAuthToken(user);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe('POST /api/vendors', () => {
  it('creates a vendor with valid data', async () => {
    const res = await request(app)
      .post('/api/vendors')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme Corp', email: 'acme@test.com' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Acme Corp');
    expect(res.body.email).toBe('acme@test.com');
    expect(res.body).not.toHaveProperty('uploadToken');
  });

  it('returns 400 with missing name', async () => {
    const res = await request(app)
      .post('/api/vendors')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'noname@test.com' });

    expect(res.status).toBe(400);
  });

  it('returns 400 with invalid email', async () => {
    const res = await request(app)
      .post('/api/vendors')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad Email Vendor', email: 'not-an-email' });

    expect(res.status).toBe(400);
  });

  it('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/vendors')
      .send({ name: 'No Auth', email: 'noauth@test.com' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/vendors', () => {
  it('returns a list of vendors', async () => {
    const res = await request(app)
      .get('/api/vendors')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/vendors/:id', () => {
  it('returns a vendor by ID', async () => {
    const vendor = await createTestVendor(org.id);

    const res = await request(app)
      .get(`/api/vendors/${vendor.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(vendor.id);
  });

  it('returns 404 for non-existent vendor', async () => {
    const res = await request(app)
      .get('/api/vendors/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/vendors/:id', () => {
  it('updates a vendor', async () => {
    const vendor = await createTestVendor(org.id);

    const res = await request(app)
      .put(`/api/vendors/${vendor.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Vendor Name' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Vendor Name');
  });
});

describe('DELETE /api/vendors/:id', () => {
  it('soft-deletes a vendor', async () => {
    const vendor = await createTestVendor(org.id);

    const res = await request(app)
      .delete(`/api/vendors/${vendor.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);

    // Verify soft-deleted (not returned in list)
    const listRes = await request(app)
      .get(`/api/vendors/${vendor.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(404);
  });
});

describe('DELETE /api/vendors/bulk', () => {
  it('bulk soft-deletes vendors', async () => {
    const v1 = await createTestVendor(org.id, { name: 'Bulk Del 1' });
    const v2 = await createTestVendor(org.id, { name: 'Bulk Del 2' });

    const res = await request(app)
      .delete('/api/vendors/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [v1.id, v2.id] });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/2 vendor/i);
  });

  it('returns 400 with empty ids array', async () => {
    const res = await request(app)
      .delete('/api/vendors/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [] });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/vendors/:id/request-coi', () => {
  it('sends the request and logs it', async () => {
    const vendor = await createTestVendor(org.id, { email: `reachable-${Date.now()}@acme.com` });

    const res = await request(app)
      .post(`/api/vendors/${vendor.id}/request-coi`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(sendUploadRequestEmail).toHaveBeenCalled();

    const logs = await prisma.notificationLog.findMany({
      where: { vendorId: vendor.id, type: 'UPLOAD_REQUEST' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('SENT');
  });

  it('refuses a vendor whose address can never deliver, and logs the attempt', async () => {
    sendUploadRequestEmail.mockClear();
    const vendor = await createTestVendor(org.id, {
      email: `imported-${Date.now()}@no-email.proofcoi.local`,
    });

    const res = await request(app)
      .post(`/api/vendors/${vendor.id}/request-coi`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_EMAIL');
    expect(sendUploadRequestEmail).not.toHaveBeenCalled();

    const logs = await prisma.notificationLog.findMany({
      where: { vendorId: vendor.id, type: 'UPLOAD_REQUEST' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('FAILED');
    expect(logs[0].meta.reason).toBe('PLACEHOLDER_EMAIL');
  });
});

describe('Free plan vendor limit', () => {
  async function orgWithVendors({ plan = 'FREE', active = 0, deleted = 0, name = 'Cap Org' } = {}) {
    const capOrg = await createTestOrg({ name, plan });
    const capUser = await createTestUser(capOrg.id, { email: `cap-${plan}-${Date.now()}-${Math.random().toString(16).slice(2)}@test.com` });
    const rows = [];
    for (let i = 0; i < active + deleted; i++) {
      rows.push(prisma.vendor.create({
        data: {
          orgId: capOrg.id,
          name: `Limit Vendor ${i}`,
          email: `limit${i}-${capOrg.id}@test.com`,
          ...(i < deleted ? { deletedAt: new Date() } : {}),
        },
      }));
    }
    await Promise.all(rows);
    return { capOrg, token: getAuthToken(capUser) };
  }

  it('returns 403 when the Free plan limit of 10 vendors is reached', async () => {
    const { token: capToken } = await orgWithVendors({ active: 10, name: 'Free At Cap' });

    const res = await request(app)
      .post('/api/vendors')
      .set('Authorization', `Bearer ${capToken}`)
      .send({ name: 'Over Limit', email: `over-${Date.now()}@test.com` });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PLAN_LIMIT_EXCEEDED');
    expect(res.body.limit).toBe(10);
    expect(res.body.current).toBe(10);
    expect(res.body.plan).toBe('FREE');
    expect(res.body.error).toMatch(/Free plan includes 10 vendors/);
    expect(res.body.error).toMatch(/stay on file/i);
  });

  it('allows the 10th vendor on the Free plan', async () => {
    const { token: capToken } = await orgWithVendors({ active: 9, name: 'Free Under Cap' });

    const res = await request(app)
      .post('/api/vendors')
      .set('Authorization', `Bearer ${capToken}`)
      .send({ name: 'Tenth', email: `tenth-${Date.now()}@test.com` });

    expect(res.status).toBe(201);
  });

  it('keeps vendors already over 10 and only blocks adding more', async () => {
    const { capOrg, token: capToken } = await orgWithVendors({ active: 11, name: 'Free Over Cap' });

    const list = await request(app)
      .get('/api/vendors')
      .set('Authorization', `Bearer ${capToken}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(11);

    const blocked = await request(app)
      .post('/api/vendors')
      .set('Authorization', `Bearer ${capToken}`)
      .send({ name: 'Still Over', email: `still-${Date.now()}@test.com` });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PLAN_LIMIT_EXCEEDED');

    const remaining = await prisma.vendor.count({ where: { orgId: capOrg.id, deletedAt: null } });
    expect(remaining).toBe(11);
  });

  it('does not count soft-deleted vendors toward the Free cap', async () => {
    const { token: capToken } = await orgWithVendors({ active: 9, deleted: 5, name: 'Free Deleted' });

    const res = await request(app)
      .post('/api/vendors')
      .set('Authorization', `Bearer ${capToken}`)
      .send({ name: 'After Deletes', email: `afterdel-${Date.now()}@test.com` });

    expect(res.status).toBe(201);
  });

  it('does not apply the Free cap of 10 to Starter', async () => {
    const { token: capToken } = await orgWithVendors({ plan: 'STARTER', active: 11, name: 'Starter Over Free' });

    const res = await request(app)
      .post('/api/vendors')
      .set('Authorization', `Bearer ${capToken}`)
      .send({ name: 'Starter Vendor', email: `starter-${Date.now()}@test.com` });

    expect(res.status).toBe(201);
  });
});

describe('COI plan cap ignores soft-deleted certificates', () => {
  const TINY_PDF = Buffer.from('%PDF-1.4\n%EOF\n');

  it('allows an upload when the only certificate on file is soft-deleted, then blocks the next one', async () => {
    const plans = require('../src/config/plans');
    const spy = jest.spyOn(plans, 'getPlanLimits').mockReturnValue({ maxVendors: 20, maxCois: 1 });
    try {
      const capOrg = await createTestOrg({ name: 'Upload Cap Org', plan: 'FREE' });
      const capUser = await createTestUser(capOrg.id, { email: `capuser-${Date.now()}@test.com` });
      const capToken = getAuthToken(capUser);
      const vendor = await createTestVendor(capOrg.id, { email: `coicap-${Date.now()}@test.com` });
      await prisma.coi.create({
        data: {
          vendorId: vendor.id,
          orgId: capOrg.id,
          pdfPath: 'test/deleted.pdf',
          status: 'APPROVED',
          deletedAt: new Date(),
        },
      });

      const allowed = await request(app)
        .post(`/api/vendors/${vendor.id}/coi/upload`)
        .set('Authorization', `Bearer ${capToken}`)
        .attach('pdf', TINY_PDF, 'coi.pdf');
      expect(allowed.status).toBe(201);

      const blocked = await request(app)
        .post(`/api/vendors/${vendor.id}/coi/upload`)
        .set('Authorization', `Bearer ${capToken}`)
        .attach('pdf', TINY_PDF, 'coi.pdf');
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('PLAN_LIMIT_EXCEEDED');
      expect(blocked.body.current).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
