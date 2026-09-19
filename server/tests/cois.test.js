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
const { extractCoiData } = require('../src/services/coiExtractor');
const {
  prisma,
  createTestOrg,
  createTestUser,
  createTestVendor,
  createTestCoi,
  getAuthToken,
  cleanupTestData,
} = require('./setup');

let org, user, token, vendor, coi;

beforeAll(async () => {
  await cleanupTestData();
  org = await createTestOrg();
  user = await createTestUser(org.id, { email: 'coitest@test.com' });
  token = getAuthToken(user);
  vendor = await createTestVendor(org.id);
  coi = await createTestCoi(vendor.id, org.id);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe('GET /api/cois', () => {
  it('returns COI list for the authenticated user org', async () => {
    const res = await request(app)
      .get('/api/cois')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toHaveProperty('vendor');
  });

  it('filters by vendorId', async () => {
    const res = await request(app)
      .get(`/api/cois?vendorId=${vendor.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.every((c) => c.vendorId === vendor.id)).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/cois');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/cois/:id', () => {
  it('returns a single COI', async () => {
    const res = await request(app)
      .get(`/api/cois/${coi.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(coi.id);
    expect(res.body).toHaveProperty('vendor');
  });

  it('returns 404 for non-existent COI', async () => {
    const res = await request(app)
      .get('/api/cois/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/cois/:id', () => {
  it('deletes a COI', async () => {
    const coiToDelete = await createTestCoi(vendor.id, org.id);

    const res = await request(app)
      .delete(`/api/cois/${coiToDelete.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);

    // Verify it's gone
    const getRes = await request(app)
      .get(`/api/cois/${coiToDelete.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(404);
  });

  it('returns 404 when deleting non-existent COI', async () => {
    const res = await request(app)
      .delete('/api/cois/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/cois/:id', () => {
  it('accepts the full COI object the client echoes back (extra keys stripped)', async () => {
    const full = await prisma.coi.findUnique({ where: { id: coi.id } });
    const res = await request(app)
      .put(`/api/cois/${coi.id}`)
      .set('Authorization', `Bearer ${token}`)
      // Mirror the real client payload: the whole COI plus nested relations and
      // a null coverageType — the exact shape that used to 400.
      .send({
        ...full,
        vendor: { id: vendor.id, name: 'X' },
        organization: { name: 'Y' },
        reviewedBy: null,
        coverageType: null,
        glPolicyNumber: 'GL-123',
        glCoverageAmount: 200000000,
      });

    expect(res.status).toBe(200);
    expect(res.body.glPolicyNumber).toBe('GL-123');
    expect(res.body.glCoverageAmount).toBe(200000000);
  });

  it('accepts a null coverageType', async () => {
    const res = await request(app)
      .put(`/api/cois/${coi.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ coverageType: null });

    expect(res.status).toBe(200);
  });

  it('still rejects an invalid value for a known field', async () => {
    const res = await request(app)
      .put(`/api/cois/${coi.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ glCoverageAmount: 'not-a-number' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/cois/:id/reanalyze', () => {
  it('re-runs extraction and overwrites the COI fields', async () => {
    extractCoiData.mockResolvedValueOnce({
      coverageType: 'GENERAL_LIABILITY',
      glPolicyNumber: 'GL-REANALYZED',
      glCoverageAmount: 150000000,
      glExpirationDate: '2027-03-01',
    });

    const res = await request(app)
      .post(`/api/cois/${coi.id}/reanalyze`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.glPolicyNumber).toBe('GL-REANALYZED');
    expect(res.body.glCoverageAmount).toBe(150000000);
    expect(res.body.coverageType).toBe('GENERAL_LIABILITY');
  });

  it('returns 422 (with the reason) when extraction yields no data', async () => {
    extractCoiData.mockRejectedValueOnce(new Error('ANTHROPIC_API_KEY is not set — AI extraction is disabled'));

    const res = await request(app)
      .post(`/api/cois/${coi.id}/reanalyze`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('returns 404 for a non-existent COI', async () => {
    const res = await request(app)
      .post('/api/cois/00000000-0000-0000-0000-000000000000/reanalyze')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post(`/api/cois/${coi.id}/reanalyze`);
    expect(res.status).toBe(401);
  });
});
