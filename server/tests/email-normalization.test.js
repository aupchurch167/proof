const request = require('supertest');
const app = require('../src/app');
const { emailFieldError } = require('../src/utils/emailAddress');
const {
  prisma,
  TEST_PASSWORD,
  createTestOrg,
  createTestUser,
  getAuthToken,
  cleanupTestData,
} = require('./setup');

let org, adminToken;

beforeAll(async () => {
  await cleanupTestData();
  org = await createTestOrg({ name: 'Email Org', email: 'ops@email-org.test' });
  const admin = await createTestUser(org.id, { email: `admin-${Date.now()}@email-org.test` });
  adminToken = getAuthToken(admin);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe('email field messages', () => {
  it('rejects empty, non-emails, and partial addresses', () => {
    expect(emailFieldError('')).toBe('Email is required');
    expect(emailFieldError('   ')).toBe('Email is required');
    expect(emailFieldError('not-an-email')).toBe('Enter a valid email address');
    expect(emailFieldError('a@b')).toBe('Enter a full email address, like name@company.com');
    expect(emailFieldError('ada@company.com')).toBeNull();
  });

  it.each(['', 'not-an-email', 'a@b'])('login rejects %j', async (email) => {
    const res = await request(app).post('/api/auth/login').send({ email, password: 'whatever' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(emailFieldError(email));
  });

  it.each(['', 'not-an-email', 'a@b'])('invite rejects %j', async (email) => {
    const res = await request(app)
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, role: 'MEMBER' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(emailFieldError(email));
  });
});

describe('case-insensitive account emails', () => {
  it('will not invite a second account that differs only by case', async () => {
    const existing = await createTestUser(org.id, { email: `Admin.Mixed.${Date.now()}@email-org.test` });
    const res = await request(app)
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: existing.email.toUpperCase(), role: 'MEMBER' });

    expect(res.status).toBe(409);
    const rows = await prisma.user.findMany({
      where: { email: { equals: existing.email, mode: 'insensitive' } },
    });
    expect(rows).toHaveLength(1);
  });

  it('logs in when the typed address differs only by case', async () => {
    const email = `Case.Login.${Date.now()}@email-org.test`;
    await createTestUser(org.id, { email });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: email.toUpperCase(), password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
  });

  it('stores a signup address in lowercase', async () => {
    const email = `New.Person.${Date.now()}@signup-org.test`;
    const res = await request(app).post('/api/auth/signup').send({
      orgName: 'Signup Case Org',
      email: email.toUpperCase(),
      password: 'Password1',
      firstName: 'New',
      lastName: 'Person',
      acceptTerms: true,
    });

    expect(res.status).toBe(201);
    const row = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    expect(row.email).toBe(email.toLowerCase());
  });
});

describe('company name', () => {
  it('rejects an empty name and a name past the limit, and shows the error', async () => {
    const empty = await request(app)
      .put('/api/organization')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toBe('Company name is required');

    const huge = await request(app)
      .put('/api/organization')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'A'.repeat(201) });
    expect(huge.status).toBe(400);
    expect(huge.body.error).toMatch(/200/);

    const ok = await request(app)
      .put('/api/organization')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '  Kept Name  ' });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe('Kept Name');
  });
});
