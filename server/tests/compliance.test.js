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
const { checkCompliance, evaluateCompliance, updateVendorStatus } = require('../src/services/compliance');
const { holderMatches } = require('../src/services/complianceRules');
const { runWeeklySummary } = require('../src/services/cron');
const { sendWeeklySummaryEmail } = require('../src/services/email');
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
  const when = daysFromNow(expiresInDays, NOW);
  return createTestCoi(vendor.id, org.id, {
    status: 'APPROVED',
    submittedAt: daysAgo(30, NOW),
    certificateHolderName: org.name,
    glCoverageAmount: 200000000,
    wcCoverageAmount: 100000000,
    umbCoverageAmount: 200000000,
    autoCoverageAmount: 200000000,
    glExpirationDate: when,
    wcExpirationDate: when,
    umbExpirationDate: when,
    autoExpirationDate: when,
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

describe('requirement switches', () => {
  const baseSettings = {
    minGeneralLiability: 100000000,
    minWorkersComp: 50000000,
    minUmbrella: 0,
    minAutomobile: 100000000,
    requireHolderMatch: true,
    expiringWindowDays: 30,
  };

  function certificate(overrides = {}) {
    return {
      certificateHolderName: 'Test Org',
      glCoverageAmount: 200000000,
      glExpirationDate: daysFromNow(90, NOW),
      wcCoverageAmount: 100000000,
      wcExpirationDate: daysFromNow(90, NOW),
      autoCoverageAmount: 200000000,
      autoExpirationDate: daysFromNow(90, NOW),
      ...overrides,
    };
  }

  function evaluated(coi, settings) {
    return evaluateCompliance(coi, settings, 'Test Org', { now: NOW });
  }

  it('does not fail a vendor for an optional line that is blank', () => {
    const result = evaluated(certificate(), baseSettings);
    expect(result.lines.find((line) => line.key === 'umb').verdict).toBe('skipped');
    expect(result.flags.some((flag) => flag.field === 'umbCoverageAmount')).toBe(false);
    expect(result.status).toBe('COMPLIANT');
  });

  it('still fails a required line that is missing or short', () => {
    const missing = evaluated(certificate({ wcCoverageAmount: null, wcExpirationDate: null }), baseSettings);
    expect(missing.flags.some((flag) => flag.type === 'MISSING' && flag.field === 'wcCoverageAmount')).toBe(true);
    expect(missing.status).toBe('NON_COMPLIANT');

    const short = evaluated(certificate({ glCoverageAmount: 100 }), baseSettings);
    expect(short.flags.some((flag) => flag.type === 'INSUFFICIENT' && flag.field === 'glCoverageAmount')).toBe(true);
    expect(short.status).toBe('NON_COMPLIANT');
  });

  it('matches a holder that differs only by case, spacing, punctuation, or suffix spelling', () => {
    expect(holderMatches('Acme Construction, LLC', 'Acme Construction LLC')).toBe(true);
    expect(holderMatches('Acme Inc', 'Acme, Inc.')).toBe(true);
    expect(holderMatches('Acme, Inc.', 'Acme Incorporated')).toBe(true);
    expect(holderMatches('Acme  Construction', 'Acme Construction')).toBe(true);
    expect(holderMatches('  ACME CONSTRUCTION  ', 'acme construction')).toBe(true);
    expect(holderMatches('Smith & Sons', 'Smith and Sons')).toBe(true);

    const orgName = 'Acme Construction LLC';
    const matched = evaluateCompliance(
      certificate({ certificateHolderName: 'Acme Construction, LLC' }),
      baseSettings,
      orgName,
      { now: NOW }
    );
    expect(matched.status).toBe('COMPLIANT');
    expect(matched.flags.some((flag) => flag.field === 'certificateHolderName')).toBe(false);
  });

  it('does not treat a bare suffix or a short fragment as a holder match', () => {
    expect(holderMatches('LLC', 'Acme Construction LLC')).toBe(false);
    expect(holderMatches('A', 'Acme Construction')).toBe(false);
    expect(holderMatches('Inc', 'Acme, Inc.')).toBe(false);
    expect(holderMatches('Acme', 'Acme Construction')).toBe(false);
    expect(holderMatches('Acme Construction, LLC', 'Acme Construction')).toBe(false);

    const suffixOnly = evaluateCompliance(
      certificate({ certificateHolderName: 'LLC' }),
      baseSettings,
      'Acme Construction LLC',
      { now: NOW }
    );
    expect(suffixOnly.status).toBe('NON_COMPLIANT');
    expect(suffixOnly.flags.some((flag) => flag.type === 'ADDITIONALLY_INSURED_MISMATCH')).toBe(true);

    const letter = evaluateCompliance(
      certificate({ certificateHolderName: 'A' }),
      baseSettings,
      'Acme Construction',
      { now: NOW }
    );
    expect(letter.status).toBe('NON_COMPLIANT');

    const blank = evaluateCompliance(
      certificate({ certificateHolderName: '   ' }),
      baseSettings,
      'Acme Construction LLC',
      { now: NOW }
    );
    expect(blank.status).toBe('NON_COMPLIANT');
    expect(blank.flags.some((flag) => flag.type === 'MISSING' && flag.field === 'certificateHolderName')).toBe(true);
  });

  it('fails a holder mismatch or a blank holder only when the switch is on', () => {
    const mismatchOn = evaluated(certificate({ certificateHolderName: 'Other Co' }), baseSettings);
    expect(mismatchOn.flags.some((flag) => flag.type === 'ADDITIONALLY_INSURED_MISMATCH')).toBe(true);
    expect(mismatchOn.status).toBe('NON_COMPLIANT');

    const blankOn = evaluated(certificate({ certificateHolderName: '  ' }), baseSettings);
    expect(blankOn.flags.some((flag) => flag.type === 'MISSING' && flag.field === 'certificateHolderName')).toBe(true);
    expect(blankOn.status).toBe('NON_COMPLIANT');

    const off = { ...baseSettings, requireHolderMatch: false };
    const mismatchOff = evaluated(certificate({ certificateHolderName: 'Other Co' }), off);
    expect(mismatchOff.flags.some((flag) => flag.field === 'certificateHolderName')).toBe(false);
    expect(mismatchOff.status).toBe('COMPLIANT');

    const blankOff = evaluated(certificate({ certificateHolderName: null }), off);
    expect(blankOff.status).toBe('COMPLIANT');
    expect(checkCompliance(certificate({ certificateHolderName: null }), off, 'Test Org', { now: NOW }))
      .toEqual(blankOff.flags);
  });

  it('uses a 14-day window and a 45-day window to decide EXPIRING_SOON', () => {
    const coi = certificate({
      glExpirationDate: daysFromNow(20, NOW),
      wcExpirationDate: daysFromNow(20, NOW),
      autoExpirationDate: daysFromNow(20, NOW),
    });
    expect(evaluated(coi, { ...baseSettings, expiringWindowDays: 14 }).status).toBe('COMPLIANT');
    expect(evaluated(coi, { ...baseSettings, expiringWindowDays: 45 }).status).toBe('EXPIRING_SOON');
  });

  it('treats the warn-window boundary as expiring and the next day as not', () => {
    const onWindow = certificate({
      glExpirationDate: daysFromNow(14, NOW),
      wcExpirationDate: daysFromNow(14, NOW),
      autoExpirationDate: daysFromNow(14, NOW),
    });
    const outside = certificate({
      glExpirationDate: daysFromNow(15, NOW),
      wcExpirationDate: daysFromNow(15, NOW),
      autoExpirationDate: daysFromNow(15, NOW),
    });
    const settings = { ...baseSettings, expiringWindowDays: 14 };
    expect(evaluated(onWindow, settings).status).toBe('EXPIRING_SOON');
    expect(evaluated(outside, settings).status).toBe('COMPLIANT');
  });

  it('does not use EXPIRING_SOON when the window is 0, and a past date is still EXPIRED', () => {
    const soon = certificate({
      glExpirationDate: daysFromNow(10, NOW),
      wcExpirationDate: daysFromNow(10, NOW),
      autoExpirationDate: daysFromNow(10, NOW),
    });
    const past = certificate({
      glExpirationDate: daysFromNow(-3, NOW),
      wcExpirationDate: daysFromNow(-3, NOW),
      autoExpirationDate: daysFromNow(-3, NOW),
    });
    const settings = { ...baseSettings, expiringWindowDays: 0 };
    expect(evaluated(soon, settings).status).toBe('COMPLIANT');
    expect(evaluated(past, settings).status).toBe('EXPIRED');
  });

  it('persists COMPLIANT when the only blank line is optional', async () => {
    await prisma.organizationSettings.update({
      where: { orgId: org.id },
      data: { minUmbrella: 0, requireHolderMatch: true, expiringWindowDays: 30 },
    });
    const vendor = await createTestVendor(org.id, { name: 'No Umbrella Needed' });
    await createTestCoi(vendor.id, org.id, {
      status: 'APPROVED',
      certificateHolderName: org.name,
      glCoverageAmount: 200000000,
      glExpirationDate: daysFromNow(90, NOW),
      wcCoverageAmount: 100000000,
      wcExpirationDate: daysFromNow(90, NOW),
      autoCoverageAmount: 200000000,
      autoExpirationDate: daysFromNow(90, NOW),
    });

    await updateVendorStatus(prisma, vendor.id, org.id, { now: NOW });
    const row = await prisma.vendor.findUnique({ where: { id: vendor.id } });
    expect(row.coiStatus).toBe('COMPLIANT');
  });
});

describe('overview warn window', () => {
  it('a window of 14 vs 45 changes who is expiring soon', async () => {
    const inside = await createTestVendor(org.id, { name: 'Inside Fourteen' });
    const middle = await createTestVendor(org.id, { name: 'Between Windows' });
    await approvedCoi(inside, 10);
    await approvedCoi(middle, 20);

    await prisma.organizationSettings.update({
      where: { orgId: org.id },
      data: { expiringWindowDays: 14 },
    });
    expect(namesIn((await overview()).buckets.expiringSoon)).toEqual(['Inside Fourteen']);

    await prisma.organizationSettings.update({
      where: { orgId: org.id },
      data: { expiringWindowDays: 45 },
    });
    expect(namesIn((await overview()).buckets.expiringSoon)).toEqual([
      'Inside Fourteen',
      'Between Windows',
    ]);
  });

  it('counts the saved window boundary as expiring and the next day as not', async () => {
    await prisma.organizationSettings.update({
      where: { orgId: org.id },
      data: { expiringWindowDays: 14 },
    });
    const edge = await createTestVendor(org.id, { name: 'On The Window' });
    const outside = await createTestVendor(org.id, { name: 'Just Outside Window' });
    await approvedCoi(edge, 14);
    await approvedCoi(outside, 15);

    const { buckets, expiringSoonDays } = await overview();
    expect(expiringSoonDays).toBe(14);
    expect(namesIn(buckets.expiringSoon)).toEqual(['On The Window']);
  });

  it('a window of 0 does not mark anyone expiring soon, and a past date stays expired', async () => {
    const soon = await createTestVendor(org.id, { name: 'Would Have Been Soon' });
    const gone = await createTestVendor(org.id, { name: 'Already Expired' });
    await approvedCoi(soon, 10);
    await approvedCoi(gone, -2);
    await prisma.organizationSettings.update({
      where: { orgId: org.id },
      data: { expiringWindowDays: 0 },
    });

    const { buckets } = await overview();
    expect(buckets.expiringSoon).toHaveLength(0);
    expect(namesIn(buckets.expired)).toEqual(['Already Expired']);
  });

  it('ignores an expiration that sits only on a line the org switched off', async () => {
    await prisma.organizationSettings.update({
      where: { orgId: org.id },
      data: { minUmbrella: 0, expiringWindowDays: 30 },
    });
    const vendor = await createTestVendor(org.id, { name: 'Optional Only' });
    await createTestCoi(vendor.id, org.id, {
      status: 'APPROVED',
      submittedAt: daysAgo(30, NOW),
      umbExpirationDate: daysFromNow(5, NOW),
    });

    const { buckets } = await overview();
    expect(namesIn(buckets.expiringSoon)).not.toContain('Optional Only');
    expect(namesIn(buckets.expired)).not.toContain('Optional Only');
  });

  it('counts a holder mismatch and a short limit as non-compliant, not covered', async () => {
    const wrongHolder = await createTestVendor(org.id, { name: 'Wrong Holder' });
    const shortLimit = await createTestVendor(org.id, { name: 'Short Limit' });
    const covered = await createTestVendor(org.id, { name: 'Actually Covered' });
    await approvedCoi(wrongHolder, 90);
    await prisma.coi.updateMany({
      where: { vendorId: wrongHolder.id },
      data: { certificateHolderName: 'Somebody Else' },
    });
    await approvedCoi(shortLimit, 90);
    await prisma.coi.updateMany({
      where: { vendorId: shortLimit.id },
      data: { glCoverageAmount: 100 },
    });
    await approvedCoi(covered, 90);

    const { buckets } = await overview();
    expect(namesIn(buckets.nonCompliant)).toEqual(['Short Limit', 'Wrong Holder']);
    expect(buckets.nonCompliant.find((v) => v.name === 'Wrong Holder').statusReason)
      .toBe('Certificate holder does not match');
    expect(buckets.nonCompliant.find((v) => v.name === 'Short Limit').statusReason)
      .toBe('General Liability under limit');
    expect(namesIn(buckets.expiringSoon)).not.toContain('Wrong Holder');
    expect(namesIn(buckets.expiringSoon)).not.toContain('Short Limit');
    expect(namesIn(buckets.expired)).not.toContain('Wrong Holder');
    expect(namesIn([...buckets.expiringSoon, ...buckets.expired, ...buckets.nonCompliant]))
      .not.toContain('Actually Covered');
  });

  it('leaves a holder mismatch out of the queue when the switch is off', async () => {
    await prisma.organizationSettings.update({
      where: { orgId: org.id },
      data: { requireHolderMatch: false },
    });
    const vendor = await createTestVendor(org.id, { name: 'Holder Ignored' });
    await approvedCoi(vendor, 90);
    await prisma.coi.updateMany({
      where: { vendorId: vendor.id },
      data: { certificateHolderName: 'Somebody Else' },
    });

    const { buckets } = await overview();
    expect(namesIn(buckets.nonCompliant)).not.toContain('Holder Ignored');
    expect(namesIn(buckets.expiringSoon)).not.toContain('Holder Ignored');
    expect(namesIn(buckets.expired)).not.toContain('Holder Ignored');
  });
});

describe('weekly summary uses the badge', () => {
  it('counts a holder mismatch and a short limit as non-compliant', async () => {
    const far = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
    async function farCoi(vendor, overrides = {}) {
      return createTestCoi(vendor.id, org.id, {
        status: 'APPROVED',
        submittedAt: new Date(),
        certificateHolderName: org.name,
        glCoverageAmount: 200000000,
        wcCoverageAmount: 100000000,
        umbCoverageAmount: 200000000,
        autoCoverageAmount: 200000000,
        glExpirationDate: far,
        wcExpirationDate: far,
        umbExpirationDate: far,
        autoExpirationDate: far,
        ...overrides,
      });
    }

    const wrongHolder = await createTestVendor(org.id, { name: 'Wrong Holder' });
    const shortLimit = await createTestVendor(org.id, { name: 'Short Limit' });
    const covered = await createTestVendor(org.id, { name: 'Actually Covered' });
    await farCoi(wrongHolder, { certificateHolderName: 'Somebody Else' });
    await farCoi(shortLimit, { glCoverageAmount: 100 });
    await farCoi(covered);

    sendWeeklySummaryEmail.mockClear();
    const stats = await runWeeklySummary(prisma);
    expect(stats.acquired).toBe(true);
    expect(sendWeeklySummaryEmail).toHaveBeenCalledTimes(1);
    const summary = sendWeeklySummaryEmail.mock.calls[0][2];
    expect(summary.nonCompliant).toBe(2);
    expect(summary.compliant).toBe(1);
    expect(summary.expiringSoon).toBe(0);
    expect(summary.expired).toBe(0);
    expect(summary.urgentVendors.map((v) => v.name).sort()).toEqual(['Short Limit', 'Wrong Holder']);
    expect(summary.urgentVendors.find((v) => v.name === 'Wrong Holder').reason)
      .toBe('Certificate holder does not match');
  });
});
