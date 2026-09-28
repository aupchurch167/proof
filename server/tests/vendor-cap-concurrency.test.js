const request = require('supertest');
const app = require('../src/app');
const { PLAN_LIMITS } = require('../src/config/plans');
const {
  prisma,
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

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

async function liveCount(orgId) {
  return prisma.vendor.count({ where: { orgId, deletedAt: null } });
}

async function seedVendors(orgId, n) {
  if (!n) return;
  await prisma.vendor.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      orgId,
      name: `Seed ${i}`,
      email: `seed-${orgId}-${i}@test.com`,
    })),
  });
}

async function postVendor(token, email) {
  return request(app)
    .post('/api/vendors')
    .set(auth(token))
    .send({ name: email, email });
}

describe('vendor cap under concurrent creates', () => {
  jest.setTimeout(30000);

  it('stops 20 parallel adds on an empty free account at 10', async () => {
    const org = await createTestOrg({ name: 'Parallel Free' });
    const user = await createTestUser(org.id, { email: `par-${Date.now()}@test.com` });
    const token = getAuthToken(user);

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => postVendor(token, `par-${org.id}-${i}@test.com`))
    );

    const created = results.filter((r) => r.status === 201);
    const blocked = results.filter((r) => r.status === 403);
    expect(created).toHaveLength(PLAN_LIMITS.FREE.maxVendors);
    expect(blocked).toHaveLength(20 - PLAN_LIMITS.FREE.maxVendors);
    expect(blocked.every((r) => r.body.code === 'PLAN_LIMIT_EXCEEDED')).toBe(true);
    expect(blocked.every((r) => r.body.limit === 10)).toBe(true);
    expect(await liveCount(org.id)).toBe(10);
  });

  it('lets only one of several parallel adds through when one slot is left', async () => {
    const org = await createTestOrg({ name: 'One Slot' });
    const user = await createTestUser(org.id, { email: `slot-${Date.now()}@test.com` });
    await seedVendors(org.id, 9);

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => postVendor(getAuthToken(user), `slot-${org.id}-${i}@test.com`))
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 403)).toHaveLength(7);
    expect(await liveCount(org.id)).toBe(10);
  });

  it('keeps an account already over the cap blocked, and does not remove vendors', async () => {
    const org = await createTestOrg({ name: 'Already Over' });
    const user = await createTestUser(org.id, { email: `over-${Date.now()}@test.com` });
    await seedVendors(org.id, 12);

    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) => postVendor(getAuthToken(user), `over-${org.id}-${i}@test.com`))
    );

    expect(results.every((r) => r.status === 403)).toBe(true);
    expect(await liveCount(org.id)).toBe(12);
  });

  it('stops two overlapping CSV imports at the free cap', async () => {
    const org = await createTestOrg({ name: 'Parallel Import' });
    const user = await createTestUser(org.id, { email: `imp-${Date.now()}@test.com` });
    const token = getAuthToken(user);

    const csv = (prefix) => {
      const lines = ['name,email'];
      for (let i = 0; i < 12; i += 1) lines.push(`${prefix} ${i},${prefix}-${i}@test.com`);
      return Buffer.from(lines.join('\n'));
    };
    const send = (prefix) => request(app)
      .post('/api/import/vendors')
      .set(auth(token))
      .field('headerMap', JSON.stringify({ name: 'name', email: 'email' }))
      .attach('file', csv(prefix), `${prefix}.csv`);

    const [a, b] = await Promise.all([send('alpha'), send('beta')]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.created + b.body.created).toBe(10);
    expect(await liveCount(org.id)).toBe(10);
    const skippedMessages = [...a.body.errors, ...b.body.errors].map((e) => e.message);
    expect(skippedMessages.some((m) => /Free plan includes 10 vendors/.test(m))).toBe(true);
  });

  it('stops parallel public applications at the free cap', async () => {
    const org = await createTestOrg({ name: 'Parallel Apply', slug: `apply-par-${Date.now()}` });
    await seedVendors(org.id, 9);

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => request(app)
        .post(`/api/apply/${org.slug}`)
        .field('name', `Applicant ${i}`)
        .field('email', `apply-${org.id}-${i}@test.com`)
        .field('phone', '555-0100')
        .field('address', '1 Main'))
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const blocked = results.filter((r) => r.status === 403);
    expect(blocked).toHaveLength(5);
    expect(blocked.every((r) => r.body.code === 'PLAN_LIMIT_EXCEEDED')).toBe(true);
    expect(blocked.every((r) => r.body.error === 'This organization has reached its vendor limit. Please contact them to resolve this.')).toBe(true);
    expect(blocked.every((r) => r.body.plan === 'FREE' && r.body.limit === 10)).toBe(true);
    expect(await liveCount(org.id)).toBe(10);
  });

  it('holds the Starter cap of 50 when parallel adds cross it', async () => {
    const org = await createTestOrg({ name: 'Parallel Starter', plan: 'STARTER' });
    const user = await createTestUser(org.id, { email: `st-${Date.now()}@test.com` });
    await seedVendors(org.id, 48);

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => postVendor(getAuthToken(user), `st-${org.id}-${i}@test.com`))
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 403)).toHaveLength(3);
    expect(results.filter((r) => r.status === 403).every((r) => r.body.limit === 50)).toBe(true);
    expect(await liveCount(org.id)).toBe(PLAN_LIMITS.STARTER.maxVendors);
  });
});
