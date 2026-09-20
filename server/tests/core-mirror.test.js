const request = require('supertest');
const app = require('../src/app');
const core = require('../src/lib/core');
const {
  prisma,
  createTestOrg,
  createTestUser,
  getAuthToken,
  cleanupTestData,
} = require('./setup');

let orgA, orgB, tokenA, tokenB;
const prev = {
  HELM_CORE_INTEGRATION: process.env.HELM_CORE_INTEGRATION,
  CORE_ORG_SLUG: process.env.CORE_ORG_SLUG,
  CORE_ORG_MAP: process.env.CORE_ORG_MAP,
  CORE_DEV_USER_ID: process.env.CORE_DEV_USER_ID,
};

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-which-is-32-chars!!';
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-32-chars-ok!';
  await cleanupTestData();
  const ts = Date.now();
  orgA = await createTestOrg({ name: 'Core A', slug: `core-a-${ts}` });
  orgB = await createTestOrg({ name: 'Core B', slug: `core-b-${ts}` });
  const adminA = await createTestUser(orgA.id, { email: `core-a-${ts}@test.com` });
  const adminB = await createTestUser(orgB.id, { email: `core-b-${ts}@test.com` });
  tokenA = getAuthToken(adminA);
  tokenB = getAuthToken(adminB);
});

afterAll(async () => {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await cleanupTestData();
  await prisma.$disconnect();
});

describe('J-03 Core mirror org gate', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not call core.createVendor when creating a vendor in an unmapped org', async () => {
    process.env.HELM_CORE_INTEGRATION = 'true';
    process.env.CORE_ORG_SLUG = orgA.slug;
    delete process.env.CORE_ORG_MAP;
    process.env.CORE_DEV_USER_ID = 'core-dev-user';

    const spy = jest.spyOn(core, 'createVendor').mockResolvedValue({ data: { id: 'core-1' } });

    const res = await request(app)
      .post('/api/vendors')
      .set({ Authorization: `Bearer ${tokenB}` })
      .send({ name: 'Tenant B Vendor', email: `b-${Date.now()}@sub.com` });

    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });

  it('mirrors when the Proof org slug is the configured CORE_ORG_SLUG', async () => {
    process.env.HELM_CORE_INTEGRATION = 'true';
    process.env.CORE_ORG_SLUG = orgA.slug;
    delete process.env.CORE_ORG_MAP;
    process.env.CORE_DEV_USER_ID = 'core-dev-user';

    const spy = jest.spyOn(core, 'createVendor').mockResolvedValue({ data: { id: 'core-1' } });

    const res = await request(app)
      .post('/api/vendors')
      .set({ Authorization: `Bearer ${tokenA}` })
      .send({ name: 'Tenant A Vendor', email: `a-${Date.now()}@sub.com` });

    expect(res.status).toBe(201);
    // mirrorCreateToCore is fire-and-forget on the create route.
    const started = Date.now();
    while (spy.mock.calls.length === 0 && Date.now() - started < 500) {
      await new Promise((r) => setImmediate(r));
    }
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].orgId).toBe(orgA.id);
  });

  it('shouldMirror is false for an org that is not in CORE_ORG_MAP', async () => {
    process.env.HELM_CORE_INTEGRATION = 'true';
    process.env.CORE_ORG_MAP = JSON.stringify({ [orgA.slug]: 'mac' });
    delete process.env.CORE_ORG_SLUG;

    expect(await core.shouldMirror({ orgId: orgB.id })).toBe(false);
    expect(await core.shouldMirror({ orgId: orgA.id })).toBe(true);
  });
});
