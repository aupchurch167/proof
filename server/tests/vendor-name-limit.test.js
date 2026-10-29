const request = require('supertest');
const app = require('../src/app');
const { VENDOR_NAME_MAX } = require('../src/utils/validation');
const {
  prisma,
  createTestOrg,
  createTestUser,
  getAuthToken,
  cleanupTestData,
} = require('./setup');

let token;

beforeAll(async () => {
  await cleanupTestData();
  const org = await createTestOrg({ name: 'Name Limit Co' });
  const user = await createTestUser(org.id, { email: `names-${Date.now()}@test.com` });
  token = getAuthToken(user);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe('vendor name length', () => {
  it('rejects a script tag plus thousands of characters', async () => {
    const name = `<script>alert(1)</script>${'A'.repeat(5000)}`;
    const res = await request(app)
      .post('/api/vendors')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, email: `long-${Date.now()}@test.com` });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/200/);
  });

  it('stores a name at the limit as text', async () => {
    const name = `<script>alert(1)</script>${'A'.repeat(VENDOR_NAME_MAX - '<script>alert(1)</script>'.length)}`;
    expect(name.length).toBe(VENDOR_NAME_MAX);
    const res = await request(app)
      .post('/api/vendors')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, email: `ok-${Date.now()}@test.com` });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe(name);
  });
});
