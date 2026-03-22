const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  TEST_PASSWORD,
  createTestOrg,
  createTestUser,
  getAuthToken,
  cleanupTestData,
} = require('./setup');

let org, user, token;

beforeAll(async () => {
  await cleanupTestData();
  org = await createTestOrg();
  user = await createTestUser(org.id, { email: 'authtest@test.com' });
  token = getAuthToken(user);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe('POST /api/auth/login', () => {
  it('returns a token with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'authtest@test.com', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user.email).toBe('authtest@test.com');
  });

  it('returns 401 with invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'authtest@test.com', password: 'WrongPass1' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 with missing email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: TEST_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 with invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: TEST_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('POST /api/auth/signup', () => {
  it('creates a new org and user with valid data', async () => {
    const email = `signup-${Date.now()}@test.com`;
    const res = await request(app)
      .post('/api/auth/signup')
      .send({
        orgName: 'New Org',
        email,
        password: 'StrongPass1',
        firstName: 'Jane',
        lastName: 'Doe',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.role).toBe('ADMIN');
  });

  it('returns 400 with weak password (no uppercase)', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({
        orgName: 'Org',
        email: `weak-${Date.now()}@test.com`,
        password: 'weakpass1',
        firstName: 'Jane',
        lastName: 'Doe',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uppercase/i);
  });

  it('returns 400 with weak password (no number)', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({
        orgName: 'Org',
        email: `weak2-${Date.now()}@test.com`,
        password: 'WeakPassword',
        firstName: 'Jane',
        lastName: 'Doe',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/number/i);
  });

  it('returns 400 with short password', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({
        orgName: 'Org',
        email: `short-${Date.now()}@test.com`,
        password: 'Ab1',
        firstName: 'Jane',
        lastName: 'Doe',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 characters/i);
  });

  it('returns 400 with missing org name', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({
        email: `noorg-${Date.now()}@test.com`,
        password: 'StrongPass1',
        firstName: 'Jane',
        lastName: 'Doe',
      });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 with an invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token');

    expect(res.status).toBe(401);
  });

  it('returns user data with a valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('authtest@test.com');
    expect(res.body).toHaveProperty('orgName');
  });
});
