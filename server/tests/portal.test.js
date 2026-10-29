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

let org, user, vendor, token;

beforeAll(async () => {
  await cleanupTestData();
  org = await createTestOrg();
  user = await createTestUser(org.id, { email: 'portaltest@test.com' });
  vendor = await createTestVendor(org.id);
  token = getAuthToken(user);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe('GET /api/portal/:uploadToken', () => {
  it('returns vendor data with a valid upload token', async () => {
    const res = await request(app)
      .get(`/api/portal/${vendor.uploadToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(vendor.id);
    expect(res.body.name).toBe(vendor.name);
    expect(res.body).toHaveProperty('organization');
    expect(res.body.organization).toHaveProperty('name');
  });

  it('returns 401 with an invalid token', async () => {
    const res = await request(app)
      .get('/api/portal/invalid-token-string');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/expired|invalid/i);
  });

  it('returns 401 for a UUID token that is not a JWT', async () => {
    const res = await request(app)
      .get('/api/portal/11111111-2222-3333-4444-555555555555');

    expect(res.status).toBe(401);
  });

  it('returns 401 when the JWT is expired', async () => {
    const jwt = require('jsonwebtoken');
    const expired = jwt.sign(
      { vendorId: vendor.id, purpose: 'upload' },
      process.env.JWT_SECRET,
      { expiresIn: '0s', algorithm: 'HS256' }
    );
    await new Promise((r) => setTimeout(r, 20));

    const res = await request(app).get(`/api/portal/${expired}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 when the JWT purpose is not upload', async () => {
    const jwt = require('jsonwebtoken');
    const wrong = jwt.sign(
      { vendorId: vendor.id, purpose: 'preview' },
      process.env.JWT_SECRET,
      { expiresIn: '7d', algorithm: 'HS256' }
    );

    const res = await request(app).get(`/api/portal/${wrong}`);
    expect(res.status).toBe(401);
  });

  it('returns 404 when token is valid JWT but vendor not found', async () => {
    // Generate a valid JWT for a non-existent vendor ID
    const { generateUploadToken } = require('../src/utils/tokens');
    const fakeToken = generateUploadToken('00000000-0000-0000-0000-000000000000');

    const res = await request(app)
      .get(`/api/portal/${fakeToken}`);

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/portal/:uploadToken/info', () => {
  it('updates vendor info via portal', async () => {
    const res = await request(app)
      .put(`/api/portal/${vendor.uploadToken}/info`)
      .send({ name: 'Updated Portal Name' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Portal Name');
  });

  it('returns 401 with invalid token', async () => {
    const res = await request(app)
      .put('/api/portal/invalid-token/info')
      .send({ name: 'Should Fail' });

    expect(res.status).toBe(401);
  });
});

describe('admin portal preview', () => {
  it('opens from the admin session and puts no JWT in the URL', async () => {
    const res = await request(app)
      .get('/api/portal/preview')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(vendor.id);
    expect(JSON.stringify(res.body)).not.toMatch(/eyJ/);
  });

  it('rejects a caller who is not signed in', async () => {
    const res = await request(app).get('/api/portal/preview');
    expect(res.status).toBe(401);
  });

  it('rejects a non-PDF upload with a clear error', async () => {
    const res = await request(app)
      .post(`/api/portal/${vendor.uploadToken}/upload`)
      .attach('pdf', Buffer.from('not a pdf'), { filename: 'notes.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PDF/i);
  });
});
