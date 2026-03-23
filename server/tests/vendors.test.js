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
    expect(res.body).toHaveProperty('uploadToken');
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

describe('Free plan vendor limit', () => {
  it('returns 403 when Free plan limit of 20 vendors is reached', async () => {
    // Clean vendors first, then create 20
    await prisma.coi.deleteMany({ where: { orgId: org.id } });
    await prisma.vendor.deleteMany({ where: { orgId: org.id } });

    const vendorPromises = [];
    for (let i = 0; i < 20; i++) {
      vendorPromises.push(
        prisma.vendor.create({
          data: {
            orgId: org.id,
            name: `Limit Vendor ${i}`,
            email: `limit${i}-${Date.now()}@test.com`,
          },
        })
      );
    }
    await Promise.all(vendorPromises);

    const res = await request(app)
      .post('/api/vendors')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Over Limit', email: 'over@test.com' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PLAN_LIMIT_EXCEEDED');
  });
});
