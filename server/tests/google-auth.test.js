// Mock Google token verification so tests don't hit Google's servers.
jest.mock('../src/lib/google', () => ({
  verifyGoogleIdToken: jest.fn(),
  isGoogleConfigured: jest.fn(() => true),
}));

const request = require('supertest');
const app = require('../src/app');
const { verifyGoogleIdToken, isGoogleConfigured } = require('../src/lib/google');
const {
  prisma,
  TEST_PASSWORD,
  createTestOrg,
  createTestUser,
  getAuthToken,
  cleanupTestData,
} = require('./setup');

beforeAll(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/auth/config', () => {
  it('reports whether Google sign-in is enabled', async () => {
    isGoogleConfigured.mockReturnValue(true);
    const res = await request(app).get('/api/auth/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ googleEnabled: true });
  });
});

describe('POST /api/auth/google', () => {
  it('returns 400 when the credential is missing', async () => {
    const res = await request(app).post('/api/auth/google').send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 when the credential is invalid', async () => {
    verifyGoogleIdToken.mockRejectedValue(new Error('bad token'));
    const res = await request(app).post('/api/auth/google').send({ credential: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('refuses to create a first-time Google user without acceptTerms', async () => {
    const email = `gnoaccept-${Date.now()}@test.com`;
    verifyGoogleIdToken.mockResolvedValue({
      googleId: `google-noaccept-${Date.now()}`,
      email,
      firstName: 'No',
      lastName: 'Accept',
    });

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'valid-token', orgName: 'No Accept Co' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/terms|privacy/i);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('creates a new org and admin user for a first-time Google user', async () => {
    const email = `gnew-${Date.now()}@test.com`;
    verifyGoogleIdToken.mockResolvedValue({
      googleId: `google-${Date.now()}`,
      email,
      firstName: 'Grace',
      lastName: 'Hopper',
    });

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'valid-token', orgName: 'Hopper Co', acceptTerms: true });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.role).toBe('ADMIN');
    expect(res.body.user.orgName).toBe('Hopper Co');
    expect(res.body.user.emailVerified).toBe(true);

    const dbUser = await prisma.user.findUnique({ where: { email } });
    expect(dbUser.passwordHash).toBeNull();
    expect(dbUser.googleId).toBeTruthy();
  });

  it('links Google to an existing verified password account matched by email', async () => {
    const org = await createTestOrg();
    const user = await createTestUser(org.id, {
      email: `glink-${Date.now()}@test.com`,
      emailVerified: true,
    });

    verifyGoogleIdToken.mockResolvedValue({
      googleId: `google-link-${Date.now()}`,
      email: user.email,
      firstName: 'Test',
      lastName: 'User',
    });

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'valid-token' });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser.googleId).toBeTruthy();
    expect(dbUser.emailVerified).toBe(true);
    // Existing password is preserved so the user can still log in either way.
    expect(dbUser.passwordHash).toBeTruthy();
  });

  it('refuses to attach Google to an unverified password account (X-04 / A1-03)', async () => {
    const org = await createTestOrg();
    const user = await createTestUser(org.id, {
      email: `gunverified-${Date.now()}@test.com`,
      emailVerified: false,
    });

    verifyGoogleIdToken.mockResolvedValue({
      googleId: `google-unverified-${Date.now()}`,
      email: user.email,
      firstName: 'Test',
      lastName: 'User',
    });

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'valid-token' });

    expect(res.status).toBe(409);
    expect(res.body).not.toHaveProperty('accessToken');

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser.googleId).toBeNull();
    expect(dbUser.emailVerified).toBe(false);
  });

  it('does not re-verify a changed email via leftover googleId (A1-03)', async () => {
    const org = await createTestOrg();
    const originalEmail = `gowner-${Date.now()}@gmail.com`;
    const victimEmail = `victim-${Date.now()}@gmail.com`;
    const googleId = `google-stale-${Date.now()}`;
    const user = await createTestUser(org.id, {
      email: originalEmail,
      emailVerified: true,
    });
    await prisma.user.update({ where: { id: user.id }, data: { googleId } });

    const change = await request(app)
      .put('/api/auth/me')
      .set('Authorization', `Bearer ${getAuthToken(user)}`)
      .send({ email: victimEmail, currentPassword: TEST_PASSWORD });
    expect(change.status).toBe(200);
    expect(change.body.email).toBe(victimEmail);
    expect(change.body.emailVerified).toBe(false);

    verifyGoogleIdToken.mockResolvedValue({
      googleId,
      email: originalEmail,
      firstName: 'Test',
      lastName: 'User',
    });

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'valid-token' });

    expect(res.status).toBe(409);
    expect(res.body).not.toHaveProperty('accessToken');

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser.email).toBe(victimEmail);
    expect(dbUser.emailVerified).toBe(false);
    expect(dbUser.googleId).toBe(googleId);
  });

  it('does not attach a new Google identity to an unverified squatted address (A1-03 leftover)', async () => {
    const org = await createTestOrg();
    const originalEmail = `gowner2-${Date.now()}@gmail.com`;
    const victimEmail = `victim2-${Date.now()}@gmail.com`;
    const attackerGoogleId = `google-attacker-${Date.now()}`;
    const victimGoogleId = `google-victim-${Date.now()}`;
    const user = await createTestUser(org.id, {
      email: originalEmail,
      emailVerified: true,
    });
    await prisma.user.update({ where: { id: user.id }, data: { googleId: attackerGoogleId } });

    const change = await request(app)
      .put('/api/auth/me')
      .set('Authorization', `Bearer ${getAuthToken(user)}`)
      .send({ email: victimEmail, currentPassword: TEST_PASSWORD });
    expect(change.status).toBe(200);

    verifyGoogleIdToken.mockResolvedValue({
      googleId: victimGoogleId,
      email: victimEmail,
      firstName: 'Victim',
      lastName: 'User',
    });

    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'valid-token' });

    expect(res.status).toBe(409);
    expect(res.body).not.toHaveProperty('accessToken');

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser.email).toBe(victimEmail);
    expect(dbUser.emailVerified).toBe(false);
    expect(dbUser.googleId).toBe(attackerGoogleId);
  });
});

describe('POST /api/auth/login (Google-only account)', () => {
  it('rejects password login for an account with no password', async () => {
    const org = await createTestOrg();
    const email = `gonly-${Date.now()}@test.com`;
    await prisma.user.create({
      data: {
        orgId: org.id,
        email,
        passwordHash: null,
        googleId: `google-only-${Date.now()}`,
        firstName: 'No',
        lastName: 'Password',
        role: 'ADMIN',
        emailVerified: true,
      },
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: TEST_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/google/i);
  });
});
