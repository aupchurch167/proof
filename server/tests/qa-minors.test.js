const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  TEST_PASSWORD,
  createTestOrg,
  createTestUser,
  createTestVendor,
  createTestCoi,
  getAuthToken,
  cleanupTestData,
} = require('./setup');
const { LOGIN_ACCOUNT_IP_MAX, LOGIN_ACCOUNT_MAX } = require('../src/middleware/loginRateLimit');

let org;
let admin;
let token;

function auth() {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  await cleanupTestData();
  org = await createTestOrg({ name: 'QA Minors Org' });
  admin = await createTestUser(org.id, { email: `qa-minors-${Date.now()}@test.com` });
  token = getAuthToken(admin);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe('vendor phone and address', () => {
  it('rejects a phone that is not a phone number', async () => {
    const res = await request(app)
      .post('/api/vendors')
      .set(auth())
      .send({ name: 'Letters Phone', email: `letters-${Date.now()}@test.com`, phone: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/phone number/i);
  });

  it('rejects a too-short address and accepts a normal one', async () => {
    const bad = await request(app)
      .post('/api/vendors')
      .set(auth())
      .send({
        name: 'Short Address',
        email: `short-${Date.now()}@test.com`,
        phone: '555-0100',
        address: 'abc',
      });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/address/i);

    const ok = await request(app)
      .post('/api/vendors')
      .set(auth())
      .send({
        name: 'Good Contact',
        email: `good-${Date.now()}@test.com`,
        phone: '+1 (555) 555-0100 ext. 12',
        address: '123 Main St',
      });
    expect(ok.status).toBe(201);
    expect(ok.body.phone).toBe('+1 (555) 555-0100 ext. 12');
    expect(ok.body.address).toBe('123 Main St');
  });

  it('rejects a bad phone on update', async () => {
    const vendor = await createTestVendor(org.id, { email: `upd-${Date.now()}@test.com` });
    const res = await request(app)
      .put(`/api/vendors/${vendor.id}`)
      .set(auth())
      .send({ phone: 'abc' });
    expect(res.status).toBe(400);
  });
});

describe('vendor and certificate audit', () => {
  it('writes create, update with changed fields, and delete', async () => {
    const created = await request(app)
      .post('/api/vendors')
      .set(auth())
      .send({
        name: 'Audited Vendor',
        email: `audited-${Date.now()}@test.com`,
        phone: '555-0101',
        trade: 'Plumbing',
      });
    expect(created.status).toBe(201);

    const createLog = await prisma.auditLog.findFirst({
      where: { entity: 'vendor', entityId: created.body.id, action: 'create' },
    });
    expect(createLog).toBeTruthy();
    expect(createLog.details.name).toBe('Audited Vendor');

    const updated = await request(app)
      .put(`/api/vendors/${created.body.id}`)
      .set(auth())
      .send({ phone: '555-0199', trade: 'Electrical' });
    expect(updated.status).toBe(200);

    const updateLog = await prisma.auditLog.findFirst({
      where: { entity: 'vendor', entityId: created.body.id, action: 'update' },
    });
    expect(updateLog.details.changed).toContain('phone');
    expect(updateLog.details.changed).toContain('trade');

    const audit = await request(app).get('/api/audit?range=all').set(auth());
    expect(audit.status).toBe(200);
    expect(audit.body.counts.Edited).toBeGreaterThan(0);
    expect(audit.body.events.some((event) => event.type === 'Edited' && String(event.fields?.changed || '').includes('phone'))).toBe(true);

    const removed = await request(app).delete(`/api/vendors/${created.body.id}`).set(auth());
    expect(removed.status).toBe(200);
    const deleteLog = await prisma.auditLog.findFirst({
      where: { entity: 'vendor', entityId: created.body.id, action: 'delete' },
    });
    expect(deleteLog.details.name).toBe('Audited Vendor');
  });

  it('writes certificate field changes', async () => {
    const vendor = await createTestVendor(org.id, { name: 'Cert Vendor', email: `cert-${Date.now()}@test.com` });
    const coi = await createTestCoi(vendor.id, org.id, { glPolicyNumber: 'OLD-1' });

    const res = await request(app)
      .put(`/api/cois/${coi.id}`)
      .set(auth())
      .send({ glPolicyNumber: 'NEW-9' });
    expect(res.status).toBe(200);

    const log = await prisma.auditLog.findFirst({
      where: { entity: 'coi', entityId: coi.id, action: 'update' },
    });
    expect(log).toBeTruthy();
    expect(log.details.changed).toContain('glPolicyNumber');
    expect(log.details.vendorName).toBe('Cert Vendor');
  });
});

describe('requirement amounts', () => {
  it('rejects negatives, junk, and fractional dollars, and stores whole dollars as exact cents', async () => {
    const negative = await request(app)
      .put('/api/requirements/default')
      .set(auth())
      .send({ coverages: [{ key: 'gl', required: true, minLimit: -5 }] });
    expect(negative.status).toBe(400);

    const junk = await request(app)
      .put('/api/requirements/default')
      .set(auth())
      .send({ coverages: [{ key: 'gl', required: true, minLimit: 'abc' }] });
    expect(junk.status).toBe(400);

    const fraction = await request(app)
      .put('/api/requirements/default')
      .set(auth())
      .send({ coverages: [{ key: 'gl', required: true, minLimit: 1.5 }] });
    expect(fraction.status).toBe(400);

    const days = await request(app)
      .put('/api/requirements/default')
      .set(auth())
      .send({ expiringWindowDays: '12abc' });
    expect(days.status).toBe(400);

    const negativeDays = await request(app)
      .put('/api/requirements/default')
      .set(auth())
      .send({ expiringWindowDays: -3 });
    expect(negativeDays.status).toBe(400);

    const saved = await request(app)
      .put('/api/requirements/default')
      .set(auth())
      .send({ coverages: [{ key: 'gl', required: true, minLimit: '$2,000,000' }] });
    expect(saved.status).toBe(200);
    expect(saved.body.coverages.find((c) => c.key === 'gl').minLimit).toBe(2000000);

    const settings = await prisma.organizationSettings.findUnique({ where: { orgId: org.id } });
    expect(settings.minGeneralLiability).toBe(200000000);
  });
});

describe('duplicate invite', () => {
  it('returns a sentence with no Error prefix', async () => {
    const email = `dup-${Date.now()}@test.com`;
    const first = await request(app)
      .post('/api/users/invite')
      .set(auth())
      .send({ email, role: 'MEMBER' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/users/invite')
      .set(auth())
      .send({ email, role: 'MEMBER' });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('That email already has an account or a pending invite');
    expect(second.body.error.startsWith('Error:')).toBe(false);
  });
});

describe('login rate limit', () => {
  function login(email, password, ip) {
    return request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email, password });
  }

  it('does not count successful sign-ins', async () => {
    const email = `success-${Date.now()}@test.com`;
    await createTestUser(org.id, { email });
    const ip = '203.0.113.10';

    for (let i = 0; i < 12; i += 1) {
      const res = await login(email, TEST_PASSWORD, ip);
      expect(res.status).toBe(200);
      // Successful attempts are removed after the response finishes. Give that
      // decrement a turn so the next sign-in is not counted against the cap.
      await new Promise((resolve) => setImmediate(resolve));
    }

    const failure = await login(email, 'WrongPass1', ip);
    expect(failure.status).toBe(401);
  });

  it('locks one account on one IP after failed attempts, and not a different account', async () => {
    const email = `locked-${Date.now()}@test.com`;
    const other = `other-${Date.now()}@test.com`;
    const ip = '203.0.113.20';

    for (let i = 0; i < LOGIN_ACCOUNT_IP_MAX; i += 1) {
      const res = await login(email, 'WrongPass1', ip);
      expect(res.status).toBe(401);
    }

    const blocked = await login(email, 'WrongPass1', ip);
    expect(blocked.status).toBe(429);

    const neighbor = await login(other, 'WrongPass1', ip);
    expect(neighbor.status).toBe(401);
  });

  it('stops a distributed guess of one account', async () => {
    const email = `spread-${Date.now()}@test.com`;

    for (let i = 1; i <= LOGIN_ACCOUNT_MAX; i += 1) {
      const res = await login(email, 'WrongPass1', `198.51.100.${i}`);
      expect(res.status).toBe(401);
    }

    const blocked = await login(email, 'WrongPass1', '198.51.100.200');
    expect(blocked.status).toBe(429);

    const someoneElse = await login(`fresh-${Date.now()}@test.com`, 'WrongPass1', '198.51.100.200');
    expect(someoneElse.status).toBe(401);
  });
});
