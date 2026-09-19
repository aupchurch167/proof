const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  createTestOrg,
  createTestUser,
  getAuthToken,
  cleanupTestData,
} = require('./setup');

let org, admin, adminToken, member, memberToken;

beforeAll(async () => {
  await cleanupTestData();
  org = await createTestOrg();
  admin = await createTestUser(org.id, { email: `settings-admin-${Date.now()}@test.com` });
  adminToken = getAuthToken(admin);
  member = await createTestUser(org.id, {
    email: `settings-member-${Date.now()}@test.com`,
    role: 'MEMBER',
  });
  memberToken = getAuthToken(member);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe('GET /api/settings', () => {
  it('ships the chase defaults for a new org', async () => {
    const res = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.chaseDaysAfterRequest).toEqual([3, 7, 14]);
    expect(res.body.chaseNonResponders).toBe(true);
  });
});

describe('PUT /api/settings', () => {
  it('normalizes and sorts the chase day list', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ chaseDaysAfterRequest: ['10', 2, 2, 'nonsense', 5] });

    expect(res.status).toBe(200);
    expect(res.body.chaseDaysAfterRequest).toEqual([2, 5, 10]);
  });

  it('rejects non-positive chase offsets', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ chaseDaysAfterRequest: [0, 7] });

    expect(res.status).toBe(400);
  });

  it('rejects a chase list that is not an array', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ chaseDaysAfterRequest: '3,7,14' });

    expect(res.status).toBe(400);
  });

  it('can switch chasing off', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ chaseNonResponders: false });

    expect(res.status).toBe(200);
    expect(res.body.chaseNonResponders).toBe(false);
  });

  it('still keeps reminder days admin-only', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ chaseDaysAfterRequest: [1] });

    expect(res.status).toBe(403);
  });
});
