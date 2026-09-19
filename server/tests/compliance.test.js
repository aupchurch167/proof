jest.mock('../src/services/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('test/mock-file.pdf'),
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-signed-url.com/test.pdf'),
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('mock-pdf')),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/email', () => ({
  sendUploadRequestEmail: jest.fn().mockResolvedValue(undefined),
  sendChaseEmail: jest.fn().mockResolvedValue(undefined),
  sendUploadNotificationEmail: jest.fn().mockResolvedValue(undefined),
  sendExpirationReminderEmail: jest.fn().mockResolvedValue(undefined),
  sendWeeklySummaryEmail: jest.fn().mockResolvedValue(undefined),
  sendRejectionEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const app = require('../src/app');
const { buildComplianceOverview } = require('../src/services/complianceOverview');
const {
  prisma,
  createTestOrg,
  createTestUser,
  createTestVendor,
  createTestCoi,
  createTestNotification,
  daysAgo,
  daysFromNow,
  getAuthToken,
  cleanupTestData,
} = require('./setup');

const NOW = new Date('2026-06-15T09:00:00Z');

let org, user, token;

beforeAll(async () => {
  await cleanupTestData();
});

beforeEach(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.notificationLog.deleteMany({});
  await prisma.coi.deleteMany({});
  await prisma.vendor.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.organizationSettings.deleteMany({});
  await prisma.organization.deleteMany({});

  org = await createTestOrg();
  user = await createTestUser(org.id, { email: `compliance-${Date.now()}@test.com` });
  token = getAuthToken(user);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

const overview = () => buildComplianceOverview(prisma, org.id, { now: NOW });
const namesIn = (bucket) => bucket.map((v) => v.name);

async function approvedCoi(vendor, expiresInDays) {
  return createTestCoi(vendor.id, org.id, {
    status: 'APPROVED',
    submittedAt: daysAgo(30, NOW),
    glExpirationDate: daysFromNow(expiresInDays, NOW),
  });
}

describe('bucket membership', () => {
  it('puts a vendor with no COI at all in noCoi', async () => {
    await createTestVendor(org.id, { name: 'Never Sent Anything' });

    const { counts, buckets } = await overview();

    expect(counts.noCoi).toBe(1);
    expect(namesIn(buckets.noCoi)).toEqual(['Never Sent Anything']);
    expect(counts.pendingReview).toBe(0);
  });

  it('moves a vendor out of noCoi and into pendingReview once they upload', async () => {
    const vendor = await createTestVendor(org.id, { name: 'Awaiting Review' });
    await createTestCoi(vendor.id, org.id, {
      status: 'PENDING_REVIEW',
      submittedAt: daysAgo(2, NOW),
    });

    const { counts, buckets } = await overview();

    expect(counts.noCoi).toBe(0);
    expect(counts.pendingReview).toBe(1);
    expect(buckets.pendingReview[0].pendingSince).toEqual(daysAgo(2, NOW));
  });

  it('classifies approved COIs by how close expiration is', async () => {
    const soon = await createTestVendor(org.id, { name: 'Expiring Soon' });
    const gone = await createTestVendor(org.id, { name: 'Already Expired' });
    const fine = await createTestVendor(org.id, { name: 'Plenty Of Time' });
    await approvedCoi(soon, 12);
    await approvedCoi(gone, -4);
    await approvedCoi(fine, 90);

    const { counts, buckets } = await overview();

    expect(namesIn(buckets.expiringSoon)).toEqual(['Expiring Soon']);
    expect(namesIn(buckets.expired)).toEqual(['Already Expired']);
    expect(counts.noCoi).toBe(0);
    expect(buckets.expiringSoon[0].daysUntilExpiration).toBe(12);
    expect(buckets.expired[0].daysUntilExpiration).toBe(-4);
  });

  it('counts the last day before expiration as expiringSoon, not expired', async () => {
    const edge = await createTestVendor(org.id, { name: 'Edge Of Window' });
    await approvedCoi(edge, 30);
    const outside = await createTestVendor(org.id, { name: 'Just Outside' });
    await approvedCoi(outside, 31);

    const { buckets } = await overview();

    expect(namesIn(buckets.expiringSoon)).toEqual(['Edge Of Window']);
    expect(buckets.expired).toHaveLength(0);
  });
});

describe('ignoredRequests bucket', () => {
  async function requested(name, daysAgoRequested, overrides = {}) {
    const vendor = await createTestVendor(org.id, { name, ...overrides });
    await createTestNotification(org.id, vendor.id, {
      type: 'UPLOAD_REQUEST',
      recipientEmail: vendor.email,
      sentAt: daysAgo(daysAgoRequested, NOW),
    });
    return vendor;
  }

  it('includes a request that is a week old with nothing back', async () => {
    await requested('Silent Since Monday', 7);

    const { counts, buckets } = await overview();

    expect(counts.ignoredRequests).toBe(1);
    expect(buckets.ignoredRequests[0].daysSinceRequest).toBe(7);
  });

  it('excludes a request that is still fresh', async () => {
    await requested('Asked Yesterday', 6);

    const { counts } = await overview();

    expect(counts.ignoredRequests).toBe(0);
  });

  it('excludes a vendor who uploaded after the request', async () => {
    const vendor = await requested('Responded Late', 10);
    await createTestCoi(vendor.id, org.id, { submittedAt: daysAgo(1, NOW) });

    const { counts } = await overview();

    expect(counts.ignoredRequests).toBe(0);
    expect(counts.pendingReview).toBe(1);
  });

  it('still includes a vendor whose only upload predates the request', async () => {
    const vendor = await requested('Stale Upload Only', 10);
    await createTestCoi(vendor.id, org.id, {
      status: 'REJECTED',
      submittedAt: daysAgo(40, NOW),
    });

    const { counts } = await overview();

    expect(counts.ignoredRequests).toBe(1);
  });

  it('excludes a vendor who already has an approved COI', async () => {
    const vendor = await requested('Renewal Nudge', 10);
    await approvedCoi(vendor, 200);

    const { counts } = await overview();

    expect(counts.ignoredRequests).toBe(0);
  });

  it('ignores requests that failed to send', async () => {
    const vendor = await createTestVendor(org.id, { name: 'Bounced Request' });
    await createTestNotification(org.id, vendor.id, {
      type: 'UPLOAD_REQUEST',
      status: 'FAILED',
      recipientEmail: vendor.email,
      sentAt: daysAgo(20, NOW),
    });

    const { counts } = await overview();

    expect(counts.ignoredRequests).toBe(0);
  });

  it('respects a caller-supplied ignoredAfterDays threshold', async () => {
    await requested('Three Days Quiet', 3);

    const strict = await buildComplianceOverview(prisma, org.id, { now: NOW, ignoredAfterDays: 3 });
    expect(strict.counts.ignoredRequests).toBe(1);

    const lax = await buildComplianceOverview(prisma, org.id, { now: NOW, ignoredAfterDays: 14 });
    expect(lax.counts.ignoredRequests).toBe(0);
  });

  it('surfaces chase progress and the escalation flag', async () => {
    const vendor = await requested('Fully Chased', 16);
    for (const step of [3, 7, 14]) {
      await createTestNotification(org.id, vendor.id, {
        type: 'UPLOAD_CHASE',
        recipientEmail: vendor.email,
        sentAt: daysAgo(16 - step, NOW),
        meta: { step },
      });
    }
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        action: 'chase_escalated',
        entity: 'vendor',
        entityId: vendor.id,
        createdAt: daysAgo(1, NOW),
      },
    });

    const { buckets } = await overview();
    const entry = buckets.ignoredRequests[0];

    expect(entry.chaseCount).toBe(3);
    expect(entry.escalatedAt).toEqual(daysAgo(1, NOW));
  });

  it('sorts the most-ignored vendor to the top', async () => {
    await requested('Quiet 8 Days', 8);
    await requested('Quiet 30 Days', 30);
    await requested('Quiet 12 Days', 12);

    const { buckets } = await overview();

    expect(namesIn(buckets.ignoredRequests)).toEqual([
      'Quiet 30 Days',
      'Quiet 12 Days',
      'Quiet 8 Days',
    ]);
  });
});

describe('bad email flagging', () => {
  it('marks vendors whose address can never deliver', async () => {
    await createTestVendor(org.id, {
      name: 'Imported No Contact',
      email: 'imported-rec42@no-email.proofcoi.local',
    });
    await createTestVendor(org.id, { name: 'Reachable', email: 'ops@reachable.com' });

    const { badEmails, buckets } = await overview();

    expect(badEmails).toBe(1);
    const flagged = buckets.noCoi.find((v) => v.name === 'Imported No Contact');
    expect(flagged.badEmail).toBe(true);
    expect(buckets.noCoi.find((v) => v.name === 'Reachable').badEmail).toBe(false);
  });
});

describe('GET /api/compliance/overview', () => {
  it('returns counts and buckets for the caller org only', async () => {
    await createTestVendor(org.id, { name: 'Mine' });

    const otherOrg = await createTestOrg({ name: 'Other Co' });
    await createTestVendor(otherOrg.id, { name: 'Theirs' });

    const res = await request(app)
      .get('/api/compliance/overview')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.counts.noCoi).toBe(1);
    expect(namesIn(res.body.buckets.noCoi)).toEqual(['Mine']);
    expect(res.body.totalVendors).toBe(1);
  });

  it('requires auth', async () => {
    const res = await request(app).get('/api/compliance/overview');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/compliance/vendors/:id/contacted', () => {
  it('clears the vendor out of the ignored queue', async () => {
    const vendor = await createTestVendor(org.id, { name: 'Called Instead' });
    await createTestNotification(org.id, vendor.id, {
      type: 'UPLOAD_REQUEST',
      recipientEmail: vendor.email,
      sentAt: daysAgo(20, NOW),
    });

    expect((await overview()).counts.ignoredRequests).toBe(1);

    const res = await request(app)
      .post(`/api/compliance/vendors/${vendor.id}/contacted`)
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'Spoke to Dave, sending it Friday' });

    expect(res.status).toBe(200);
    expect((await overview()).counts.ignoredRequests).toBe(0);
  });

  it('404s for a vendor in another org', async () => {
    const otherOrg = await createTestOrg({ name: 'Other Co' });
    const theirs = await createTestVendor(otherOrg.id);

    const res = await request(app)
      .post(`/api/compliance/vendors/${theirs.id}/contacted`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
