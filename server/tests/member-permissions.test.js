const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  createTestOrg,
  createTestUser,
  createTestVendor,
  createTestCoi,
  getAuthToken,
  cleanupTestData,
} = require('./setup');

let org, memberToken, viewerToken;

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  await cleanupTestData();
  org = await createTestOrg({ name: 'Role Org' });
  const member = await createTestUser(org.id, {
    email: `member-${Date.now()}@test.com`,
    role: 'MEMBER',
  });
  const viewer = await createTestUser(org.id, {
    email: `viewer-${Date.now()}@test.com`,
    role: 'VIEWER',
  });
  memberToken = getAuthToken(member);
  viewerToken = getAuthToken(viewer);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe('MEMBER permissions', () => {
  it('can correct a vendor and cannot delete one', async () => {
    const vendor = await createTestVendor(org.id, { email: `keep-${Date.now()}@test.com` });

    const updated = await request(app)
      .put(`/api/vendors/${vendor.id}`)
      .set(auth(memberToken))
      .send({ name: 'Corrected Name' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Corrected Name');

    const deleted = await request(app)
      .delete(`/api/vendors/${vendor.id}`)
      .set(auth(memberToken));
    expect(deleted.status).toBe(403);

    const bulk = await request(app)
      .delete('/api/vendors/bulk')
      .set(auth(memberToken))
      .send({ ids: [vendor.id] });
    expect(bulk.status).toBe(403);

    const row = await prisma.vendor.findUnique({ where: { id: vendor.id } });
    expect(row.deletedAt).toBeNull();
    expect(row.name).toBe('Corrected Name');
  });

  it('cannot delete a certificate or import a file', async () => {
    const vendor = await createTestVendor(org.id, { email: `coi-${Date.now()}@test.com` });
    const coi = await createTestCoi(vendor.id, org.id, { status: 'APPROVED' });

    const deleted = await request(app)
      .delete(`/api/cois/${coi.id}`)
      .set(auth(memberToken));
    expect(deleted.status).toBe(403);
    expect((await prisma.coi.findUnique({ where: { id: coi.id } })).deletedAt).toBeNull();

    const imported = await request(app)
      .post('/api/import/vendors')
      .set(auth(memberToken))
      .field('headerMap', JSON.stringify({ name: 'name', email: 'email' }))
      .attach('file', Buffer.from('name,email\nNope,nope@test.com\n'), 'vendors.csv');
    expect(imported.status).toBe(403);
  });

  it('can read the team list and cannot invite', async () => {
    const list = await request(app).get('/api/users').set(auth(memberToken));
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThan(0);
    expect(JSON.stringify(list.body)).not.toMatch(/inviteToken/);

    const invite = await request(app)
      .post('/api/users/invite')
      .set(auth(memberToken))
      .send({ email: `new-${Date.now()}@test.com`, role: 'MEMBER' });
    expect(invite.status).toBe(403);
  });

  it('a viewer cannot create a vendor', async () => {
    const res = await request(app)
      .post('/api/vendors')
      .set(auth(viewerToken))
      .send({ name: 'Viewer Co', email: `viewer-vendor-${Date.now()}@test.com` });
    expect(res.status).toBe(403);
  });
});
