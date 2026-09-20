jest.mock('../src/services/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('test/mock-file.pdf'),
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-signed-url.com/test.pdf'),
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('mock-pdf')),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/email', () => ({
  sendUploadRequestEmail: jest.fn().mockResolvedValue(undefined),
  sendUploadNotificationEmail: jest.fn().mockResolvedValue(undefined),
  sendExpirationReminderEmail: jest.fn().mockResolvedValue(undefined),
  sendWeeklySummaryEmail: jest.fn().mockResolvedValue(undefined),
  sendRejectionEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendChaseEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/coiExtractor', () => ({
  extractCoiData: jest.fn().mockResolvedValue(null),
}));

const { Client } = require('pg');
const request = require('supertest');
const app = require('../src/app');
const appPrisma = require('../src/lib/prisma');
const { deleteFile } = require('../src/services/storage');
const email = require('../src/services/email');
const { runExpirationSweep, startCronJobs, stopCronJobs } = require('../src/services/cron');
const { LOCK_KEYS } = require('../src/lib/advisoryLock');
const { verifyUploadToken } = require('../src/utils/tokens');
const {
  prisma,
  createTestOrg,
  createTestUser,
  createTestVendor,
  createTestCoi,
  createTestNotification,
  daysFromNow,
  getAuthToken,
  cleanupTestData,
} = require('./setup');

const NOW = new Date('2026-06-15T09:00:00Z');

let org, admin, member, adminToken, memberToken;

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  await cleanupTestData();
  org = await createTestOrg({ name: 'B03 Org', slug: `b03-${Date.now()}` });
  admin = await createTestUser(org.id, { email: `b03-admin-${Date.now()}@test.com` });
  member = await createTestUser(org.id, {
    email: `b03-member-${Date.now()}@test.com`,
    role: 'MEMBER',
  });
  adminToken = getAuthToken(admin);
  memberToken = getAuthToken(member);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
  await appPrisma.$disconnect();
});

describe('A3-02 vendor delete retains COIs and Spaces objects', () => {
  it('soft-deletes vendor + COI, keeps NotificationLog, and does not delete the PDF', async () => {
    const vendor = await createTestVendor(org.id, {
      name: 'Delete Keep History',
      email: `keep-hist-${Date.now()}@test.com`,
    });
    const coi = await createTestCoi(vendor.id, org.id, {
      pdfPath: 'spaces/keep-me.pdf',
      status: 'APPROVED',
    });
    const log = await createTestNotification(org.id, vendor.id, {
      type: 'EXPIRATION_REMINDER',
      coiId: coi.id,
    });

    deleteFile.mockClear();
    const res = await request(app)
      .delete(`/api/vendors/${vendor.id}`)
      .set(auth(memberToken));

    expect(res.status).toBe(200);
    expect(deleteFile).not.toHaveBeenCalled();

    const deletedVendor = await prisma.vendor.findUnique({ where: { id: vendor.id } });
    expect(deletedVendor.deletedAt).toBeTruthy();

    const retainedCoi = await prisma.coi.findUnique({ where: { id: coi.id } });
    expect(retainedCoi).toBeTruthy();
    expect(retainedCoi.deletedAt).toBeTruthy();
    expect(retainedCoi.pdfPath).toBe('spaces/keep-me.pdf');

    const retainedLog = await prisma.notificationLog.findUnique({ where: { id: log.id } });
    expect(retainedLog).toBeTruthy();
    expect(retainedLog.coiId).toBe(coi.id);

    const hidden = await request(app)
      .get(`/api/cois/${coi.id}`)
      .set(auth(adminToken));
    expect(hidden.status).toBe(404);

    const memberPeek = await request(app)
      .get(`/api/cois/${coi.id}?includeDeleted=true`)
      .set(auth(memberToken));
    expect(memberPeek.status).toBe(404);

    const adminPeek = await request(app)
      .get(`/api/cois/${coi.id}?includeDeleted=true`)
      .set(auth(adminToken));
    expect(adminPeek.status).toBe(200);
    expect(adminPeek.body.id).toBe(coi.id);
    expect(adminPeek.body.pdfPath).toBe('spaces/keep-me.pdf');
  });

  it('bulk-deletes vendors without destroying COI rows or calling deleteFile', async () => {
    const v1 = await createTestVendor(org.id, { name: 'Bulk A', email: `bulk-a-${Date.now()}@test.com` });
    const v2 = await createTestVendor(org.id, { name: 'Bulk B', email: `bulk-b-${Date.now()}@test.com` });
    const c1 = await createTestCoi(v1.id, org.id, { pdfPath: 'spaces/bulk-a.pdf' });
    const c2 = await createTestCoi(v2.id, org.id, { pdfPath: 'spaces/bulk-b.pdf' });
    await createTestNotification(org.id, v1.id, { coiId: c1.id });

    deleteFile.mockClear();
    const res = await request(app)
      .delete('/api/vendors/bulk')
      .set(auth(adminToken))
      .send({ ids: [v1.id, v2.id] });

    expect(res.status).toBe(200);
    expect(deleteFile).not.toHaveBeenCalled();

    const kept = await prisma.coi.findMany({ where: { id: { in: [c1.id, c2.id] } } });
    expect(kept).toHaveLength(2);
    expect(kept.every((c) => c.deletedAt)).toBe(true);
  });
});

describe('A3-07 import mints a signed upload token', () => {
  it('sets uploadToken via generateUploadToken after creating the vendor', async () => {
    const emailAddr = `imported-${Date.now()}@acme.com`;
    const csv = `name,email\nImported Plumber,${emailAddr}\n`;

    const res = await request(app)
      .post('/api/import/vendors')
      .set(auth(adminToken))
      .field('headerMap', JSON.stringify({ name: 'name', email: 'email' }))
      .attach('file', Buffer.from(csv), 'vendors.csv');

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);

    const vendor = await prisma.vendor.findFirst({
      where: { orgId: org.id, email: emailAddr },
    });
    expect(vendor).toBeTruthy();
    const payload = verifyUploadToken(vendor.uploadToken);
    expect(payload.vendorId).toBe(vendor.id);
    expect(payload.purpose).toBe('upload');
  });
});

describe('A2-12 live vendor email uniqueness', () => {
  it('returns 409 when two creates race the same live email', async () => {
    const emailAddr = `race-${Date.now()}@acme.com`;
    const [a, b] = await Promise.all([
      request(app).post('/api/vendors').set(auth(adminToken)).send({ name: 'Race A', email: emailAddr }),
      request(app).post('/api/vendors').set(auth(adminToken)).send({ name: 'Race B', email: emailAddr }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const conflict = a.status === 409 ? a : b;
    expect(conflict.body.code).toBe('VENDOR_EMAIL_CONFLICT');

    const live = await prisma.vendor.count({
      where: { orgId: org.id, email: emailAddr, deletedAt: null },
    });
    expect(live).toBe(1);
  });

  it('allows reuse of an email after the previous vendor is soft-deleted', async () => {
    const emailAddr = `reuse-${Date.now()}@acme.com`;
    const first = await request(app)
      .post('/api/vendors')
      .set(auth(adminToken))
      .send({ name: 'First', email: emailAddr });
    expect(first.status).toBe(201);

    const del = await request(app)
      .delete(`/api/vendors/${first.body.id}`)
      .set(auth(adminToken));
    expect(del.status).toBe(200);

    const second = await request(app)
      .post('/api/vendors')
      .set(auth(adminToken))
      .send({ name: 'Second', email: emailAddr });
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
  });
});

describe('A3-04 / A6-04 cron lock and shutdown', () => {
  async function vendorExpiringIn(days) {
    const vendor = await createTestVendor(org.id, {
      email: `exp-${Date.now()}-${Math.random().toString(16).slice(2)}@acme.com`,
    });
    const coi = await createTestCoi(vendor.id, org.id, {
      status: 'APPROVED',
      submittedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
      glExpirationDate: daysFromNow(days, NOW),
    });
    return { vendor, coi };
  }

  it('no-ops a second overlapping expiration sweep (no double NotificationLog)', async () => {
    const { vendor } = await vendorExpiringIn(27);
    email.sendExpirationReminderEmail.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 400))
    );

    const [a, b] = await Promise.all([
      runExpirationSweep(prisma, { now: NOW }),
      runExpirationSweep(prisma, { now: NOW }),
    ]);

    const acquired = [a, b].filter((s) => s.acquired);
    expect(acquired).toHaveLength(1);
    expect([a.sent, b.sent].sort()).toEqual([0, 1]);

    const logs = await prisma.notificationLog.findMany({
      where: { vendorId: vendor.id, type: 'EXPIRATION_REMINDER' },
    });
    expect(logs).toHaveLength(1);
    email.sendExpirationReminderEmail.mockResolvedValue(undefined);
  });

  it('skips the sweep while another session holds the advisory lock', async () => {
    await vendorExpiringIn(27);
    email.sendExpirationReminderEmail.mockClear();

    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    await holder.connect();
    try {
      const got = await holder.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEYS.expiration]);
      expect(got.rows[0].locked).toBe(true);

      const stats = await runExpirationSweep(prisma, { now: NOW });
      expect(stats.acquired).toBe(false);
      expect(stats.sent).toBe(0);
      expect(email.sendExpirationReminderEmail).not.toHaveBeenCalled();
    } finally {
      await holder.query('SELECT pg_advisory_unlock($1)', [LOCK_KEYS.expiration]).catch(() => {});
      await holder.end().catch(() => {});
    }
  });

  it('stopCronJobs stops every job started for SIGTERM/SIGINT', () => {
    const jobs = startCronJobs(prisma);
    expect(jobs).toHaveLength(4);
    expect(jobs.every((job) => job.running)).toBe(true);
    stopCronJobs(jobs);
    expect(jobs.every((job) => !job.running)).toBe(true);
  });
});

describe('A3-10 plan limit fail-closed', () => {
  it('returns 503 and does not create a vendor when the plan-limit query throws', async () => {
    const before = await prisma.vendor.count({ where: { orgId: org.id, deletedAt: null } });
    const spy = jest.spyOn(appPrisma.organization, 'findUnique').mockRejectedValueOnce(new Error('db down'));

    const res = await request(app)
      .post('/api/vendors')
      .set(auth(adminToken))
      .send({ name: 'Should Not Create', email: `failopen-${Date.now()}@test.com` });

    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PLAN_LIMIT_UNAVAILABLE');

    const after = await prisma.vendor.count({ where: { orgId: org.id, deletedAt: null } });
    expect(after).toBe(before);
  });
});
