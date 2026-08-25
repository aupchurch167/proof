const request = require('supertest');
const app = require('../src/app');
const { prisma, createTestUser, createTestVendor, getAuthToken, cleanupTestData } = require('./setup');

function createOrg(slug) {
  return prisma.organization.create({
    data: { name: `Org ${slug}`, email: `${slug}@test.com`, slug, settings: { create: {} } },
  });
}

let org, adminToken, memberToken;

beforeAll(async () => {
  await cleanupTestData();
  org = await createOrg(`intg-${Date.now()}`);
  const admin = await createTestUser(org.id, { email: `admin-${Date.now()}@test.com`, role: 'ADMIN' });
  const member = await createTestUser(org.id, { email: `member-${Date.now()}@test.com`, role: 'MEMBER' });
  adminToken = getAuthToken(admin);
  memberToken = getAuthToken(member);
  await createTestVendor(org.id, { name: 'Intg Vendor', email: 'v@intg.com' });
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('Integrations — API keys', () => {
  it('forbids non-admins', async () => {
    const res = await request(app).get('/api/integrations/api-keys').set(auth(memberToken));
    expect(res.status).toBe(403);
  });

  it('requires a name', async () => {
    const res = await request(app).post('/api/integrations/api-keys').set(auth(adminToken)).send({});
    expect(res.status).toBe(400);
  });

  it('creates a key, returns the token once, and hides the secret afterward', async () => {
    const res = await request(app)
      .post('/api/integrations/api-keys')
      .set(auth(adminToken))
      .send({ name: 'Scheduled', scopes: ['vendors:read', 'coi-requests:read'] });

    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^prf_live_/);
    expect(res.body.client.tokenPrefix).toMatch(/^prf_live_/);
    expect(res.body.client).not.toHaveProperty('tokenHash');

    const list = await request(app).get('/api/integrations/api-keys').set(auth(adminToken));
    expect(list.status).toBe(200);
    const found = list.body.find((k) => k.id === res.body.client.id);
    expect(found).toBeTruthy();
    expect(found).not.toHaveProperty('tokenHash');
    expect(found.scopes).toEqual(['vendors:read', 'coi-requests:read']);
  });

  it('the minted token works against the v1 API and stops working once revoked', async () => {
    const created = await request(app)
      .post('/api/integrations/api-keys')
      .set(auth(adminToken))
      .send({ name: 'E2E' });
    const token = created.body.token;
    const id = created.body.client.id;

    const ok = await request(app).get(`/api/v1/orgs/${org.slug}/vendors`).set(auth(token));
    expect(ok.status).toBe(200);
    expect(ok.body.data.some((v) => v.name === 'Intg Vendor')).toBe(true);

    const revoke = await request(app).delete(`/api/integrations/api-keys/${id}`).set(auth(adminToken));
    expect(revoke.status).toBe(200);
    expect(revoke.body.revokedAt).toBeTruthy();

    const denied = await request(app).get(`/api/v1/orgs/${org.slug}/vendors`).set(auth(token));
    expect(denied.status).toBe(401);
  });

  it('does not let a key reach another org', async () => {
    const other = await createOrg(`other-${Date.now()}`);
    const created = await request(app)
      .post('/api/integrations/api-keys')
      .set(auth(adminToken))
      .send({ name: 'Scoped' });
    const res = await request(app).get(`/api/v1/orgs/${other.slug}/vendors`).set(auth(created.body.token));
    expect(res.status).toBe(403);
  });
});

describe('Integrations — webhooks', () => {
  it('rejects an invalid URL', async () => {
    const res = await request(app)
      .post('/api/integrations/webhooks')
      .set(auth(adminToken))
      .send({ name: 'Bad', url: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it('creates a webhook, returns the secret once, then lists/toggles/deletes it', async () => {
    const created = await request(app)
      .post('/api/integrations/webhooks')
      .set(auth(adminToken))
      .send({ name: 'Scheduled', url: 'https://example.com/hooks/proof' });

    expect(created.status).toBe(201);
    expect(created.body.secret).toMatch(/^whsec_/);
    expect(created.body.endpoint).not.toHaveProperty('secret');
    const id = created.body.endpoint.id;

    const list = await request(app).get('/api/integrations/webhooks').set(auth(adminToken));
    const found = list.body.find((w) => w.id === id);
    expect(found.events).toContain('coi.updated');
    expect(found).not.toHaveProperty('secret');

    const toggled = await request(app).put(`/api/integrations/webhooks/${id}`).set(auth(adminToken)).send({ active: false });
    expect(toggled.body.active).toBe(false);

    const del = await request(app).delete(`/api/integrations/webhooks/${id}`).set(auth(adminToken));
    expect(del.status).toBe(200);
  });
});
