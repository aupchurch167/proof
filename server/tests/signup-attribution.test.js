const request = require('supertest');
const app = require('../src/app');
const { sanitizeUtmValue, UTM_MAX_LENGTH } = require('../src/lib/signupAttribution');
const { PLAN_LIMITS, vendorLimitReachedMessage } = require('../src/config/plans');
const { verifyGoogleIdToken } = require('../src/lib/google');

jest.mock('../src/lib/google', () => ({
  verifyGoogleIdToken: jest.fn(),
  isGoogleConfigured: jest.fn(() => true),
}));

const {
  prisma,
  createTestOrg,
  createTestUser,
  cleanupTestData,
} = require('./setup');

beforeAll(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

function signupBody(overrides = {}) {
  return {
    orgName: 'Attribution Co',
    email: `attr-${Date.now()}-${Math.random().toString(16).slice(2)}@test.com`,
    password: 'StrongPass1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    acceptTerms: true,
    ...overrides,
  };
}

describe('signup UTM sanitizer', () => {
  it('trims, strips controls and angle brackets, and length-limits', () => {
    expect(sanitizeUtmValue('  greateratl  ')).toBe('greateratl');
    expect(sanitizeUtmValue('spring\u0000 sale')).toBe('spring sale');
    expect(sanitizeUtmValue('<script>alert(1)</script>')).toBe('scriptalert(1)/script');
    expect(sanitizeUtmValue('a'.repeat(UTM_MAX_LENGTH + 40))).toHaveLength(UTM_MAX_LENGTH);
    expect(sanitizeUtmValue('   ')).toBeNull();
    expect(sanitizeUtmValue({ bad: true })).toBeNull();
    expect(sanitizeUtmValue(['cpc'])).toBeNull();
  });
});

describe('free plan cap constant', () => {
  it('is 10 vendors and does not change Starter or Unlimited', () => {
    expect(PLAN_LIMITS.FREE.maxVendors).toBe(10);
    expect(PLAN_LIMITS.STARTER.maxVendors).toBe(50);
    expect(PLAN_LIMITS.UNLIMITED.maxVendors).toBe(Infinity);
    expect(vendorLimitReachedMessage('FREE', 10)).toMatch(/10 vendors/);
    expect(vendorLimitReachedMessage('FREE', 10)).toMatch(/stay on file/i);
    expect(vendorLimitReachedMessage('STARTER', 50)).toMatch(/50/);
    expect(vendorLimitReachedMessage('STARTER', 50)).toMatch(/Starter/);
  });
});

describe('POST /api/auth/signup attribution', () => {
  it('stores UTMs on the new organization and sets createdAt', async () => {
    const before = new Date();
    const body = signupBody({
      utm_source: ' greateratl ',
      utm_medium: 'cpc',
      utm_campaign: 'spring-2026',
      utm_term: 'coi software',
      utm_content: 'hero',
    });

    const res = await request(app).post('/api/auth/signup').send(body);
    expect(res.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    const org = await prisma.organization.findUnique({ where: { id: user.orgId } });
    expect(org.utmSource).toBe('greateratl');
    expect(org.utmMedium).toBe('cpc');
    expect(org.utmCampaign).toBe('spring-2026');
    expect(org.utmTerm).toBe('coi software');
    expect(org.utmContent).toBe('hero');
    expect(org.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);

    const channel = await prisma.organization.findMany({
      where: { utmSource: 'greateratl', createdAt: { gte: before } },
    });
    expect(channel.map((row) => row.id)).toContain(org.id);
  });

  it('creates an account with null attribution when no UTMs are sent', async () => {
    const body = signupBody();
    const res = await request(app).post('/api/auth/signup').send(body);
    expect(res.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    const org = await prisma.organization.findUnique({ where: { id: user.orgId } });
    expect(org.utmSource).toBeNull();
    expect(org.utmMedium).toBeNull();
    expect(org.utmCampaign).toBeNull();
    expect(org.utmTerm).toBeNull();
    expect(org.utmContent).toBeNull();
    expect(org.createdAt).toBeInstanceOf(Date);
  });

  it('drops unsafe UTM values instead of rejecting signup', async () => {
    const body = signupBody({
      utm_source: `pad-${'x'.repeat(200)}`,
      utm_medium: { nested: true },
      utm_campaign: '<b>launch</b>',
      utm_term: 'line\nbreak',
    });
    const res = await request(app).post('/api/auth/signup').send(body);
    expect(res.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    const org = await prisma.organization.findUnique({ where: { id: user.orgId } });
    expect(org.utmSource).toHaveLength(UTM_MAX_LENGTH);
    expect(org.utmSource.startsWith('pad-')).toBe(true);
    expect(org.utmMedium).toBeNull();
    expect(org.utmCampaign).toBe('blaunch/b');
    expect(org.utmTerm).toBe('line break');
    expect(org.utmContent).toBeNull();
  });
});

describe('POST /api/auth/google attribution', () => {
  it('stores UTMs only when Google signup creates the organization', async () => {
    const email = `gattr-${Date.now()}@test.com`;
    verifyGoogleIdToken.mockResolvedValue({
      googleId: `google-attr-${Date.now()}`,
      email,
      firstName: 'Grace',
      lastName: 'Hopper',
    });

    const created = await request(app).post('/api/auth/google').send({
      credential: 'valid-token',
      orgName: 'Hopper Attribution',
      acceptTerms: true,
      utm_source: 'greateratl',
      utm_medium: 'partner',
    });
    expect(created.status).toBe(200);

    const user = await prisma.user.findUnique({
      where: { email },
      include: { organization: true },
    });
    expect(user.organization.utmSource).toBe('greateratl');
    expect(user.organization.utmMedium).toBe('partner');

    verifyGoogleIdToken.mockResolvedValue({
      googleId: user.googleId,
      email,
      firstName: 'Grace',
      lastName: 'Hopper',
    });
    const again = await request(app).post('/api/auth/google').send({
      credential: 'valid-token',
      utm_source: 'other-channel',
    });
    expect(again.status).toBe(200);

    const org = await prisma.organization.findUnique({ where: { id: user.orgId } });
    expect(org.utmSource).toBe('greateratl');
  });

  it('does not write UTMs onto an existing organization', async () => {
    const org = await createTestOrg({ name: 'Already Here' });
    const user = await createTestUser(org.id, {
      email: `gexisting-${Date.now()}@test.com`,
      emailVerified: true,
    });

    verifyGoogleIdToken.mockResolvedValue({
      googleId: `google-existing-${Date.now()}`,
      email: user.email,
      firstName: 'Test',
      lastName: 'User',
    });

    const res = await request(app).post('/api/auth/google').send({
      credential: 'valid-token',
      utm_source: 'greateratl',
      utm_campaign: 'should-not-stick',
    });
    expect(res.status).toBe(200);

    const fresh = await prisma.organization.findUnique({ where: { id: org.id } });
    expect(fresh.utmSource).toBeNull();
    expect(fresh.utmCampaign).toBeNull();
  });
});
