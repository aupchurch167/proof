jest.mock('../src/services/email', () => ({
  sendUploadRequestEmail: jest.fn().mockResolvedValue(undefined),
  sendChaseEmail: jest.fn().mockResolvedValue(undefined),
  sendUploadNotificationEmail: jest.fn().mockResolvedValue(undefined),
  sendExpirationReminderEmail: jest.fn().mockResolvedValue(undefined),
  sendWeeklySummaryEmail: jest.fn().mockResolvedValue(undefined),
  sendRejectionEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));

const email = require('../src/services/email');
const { runChaseSweep, runExpirationSweep } = require('../src/services/cron');
const {
  prisma,
  createTestOrg,
  createTestVendor,
  createTestCoi,
  createTestNotification,
  daysAgo,
  daysFromNow,
  cleanupTestData,
} = require('./setup');

// Anchored "today" so every scenario is expressed in days relative to it.
const NOW = new Date('2026-06-15T09:00:00Z');

let org;

beforeAll(async () => {
  await cleanupTestData();
});

beforeEach(async () => {
  jest.clearAllMocks();
  await prisma.auditLog.deleteMany({});
  await prisma.notificationLog.deleteMany({});
  await prisma.coi.deleteMany({});
  await prisma.vendor.deleteMany({});
  await prisma.organizationSettings.deleteMany({});
  await prisma.organization.deleteMany({});
  org = await createTestOrg();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

// A vendor who was asked for a COI `days` ago and never responded.
async function vendorWithRequest(days, overrides = {}) {
  const vendor = await createTestVendor(org.id, overrides);
  await createTestNotification(org.id, vendor.id, {
    type: 'UPLOAD_REQUEST',
    recipientEmail: vendor.email,
    sentAt: daysAgo(days, NOW),
  });
  return vendor;
}

function chaseLogs(vendorId) {
  return prisma.notificationLog.findMany({
    where: { vendorId, type: 'UPLOAD_CHASE' },
    orderBy: { sentAt: 'asc' },
  });
}

describe('runChaseSweep — follow-up ladder', () => {
  it('stays quiet before the first follow-up day', async () => {
    const vendor = await vendorWithRequest(2);

    const stats = await runChaseSweep(prisma, { now: NOW });

    expect(stats.sent).toBe(0);
    expect(email.sendChaseEmail).not.toHaveBeenCalled();
    expect(await chaseLogs(vendor.id)).toHaveLength(0);
  });

  it('sends the day-3 follow-up and records the step it fired for', async () => {
    // Imported vendors still carry the default UUID token, which the portal
    // can't verify — the chase has to mint a signed one before emailing.
    const vendor = await vendorWithRequest(3);
    await prisma.vendor.update({
      where: { id: vendor.id },
      data: { uploadToken: '11111111-2222-3333-4444-555555555555' },
    });

    const stats = await runChaseSweep(prisma, { now: NOW });

    expect(stats.sent).toBe(1);
    expect(email.sendChaseEmail).toHaveBeenCalledTimes(1);
    const [to, name, portalUrl, , daysSinceRequest] = email.sendChaseEmail.mock.calls[0];
    expect(to).toBe(vendor.email);
    expect(name).toBe(vendor.name);
    expect(daysSinceRequest).toBe(3);

    const logs = await chaseLogs(vendor.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('SENT');
    expect(logs[0].meta.step).toBe(3);

    // The link in the email is a freshly-minted signed token, not the UUID.
    const updated = await prisma.vendor.findUnique({ where: { id: vendor.id } });
    expect(updated.uploadToken).not.toBe('11111111-2222-3333-4444-555555555555');
    expect(updated.uploadToken.split('.')).toHaveLength(3);
    expect(portalUrl).toContain(updated.uploadToken);
  });

  it('does not repeat a step it already sent, even days later', async () => {
    const vendor = await vendorWithRequest(3);
    await runChaseSweep(prisma, { now: NOW });
    jest.clearAllMocks();

    // Day 5 is still the day-3 step.
    const stats = await runChaseSweep(prisma, { now: daysFromNow(2, NOW) });

    expect(stats.sent).toBe(0);
    expect(stats.skipped).toBe(1);
    expect(email.sendChaseEmail).not.toHaveBeenCalled();
    expect(await chaseLogs(vendor.id)).toHaveLength(1);
  });

  it('climbs to the next step when its day arrives', async () => {
    const vendor = await vendorWithRequest(3);
    await runChaseSweep(prisma, { now: NOW });
    await runChaseSweep(prisma, { now: daysFromNow(4, NOW) }); // day 7
    await runChaseSweep(prisma, { now: daysFromNow(11, NOW) }); // day 14

    const logs = await chaseLogs(vendor.id);
    expect(logs.map((l) => l.meta.step)).toEqual([3, 7, 14]);
    expect(email.sendChaseEmail).toHaveBeenCalledTimes(3);
  });

  it('catches up with a single follow-up when runs were missed', async () => {
    // Nobody ran the job for ten days; the vendor gets the day-7 nudge now,
    // not a burst of three.
    const vendor = await vendorWithRequest(10);

    await runChaseSweep(prisma, { now: NOW });

    const logs = await chaseLogs(vendor.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].meta.step).toBe(7);
  });

  it('stops chasing once the vendor uploads', async () => {
    const vendor = await vendorWithRequest(7);
    await createTestCoi(vendor.id, org.id, { submittedAt: daysAgo(1, NOW) });

    const stats = await runChaseSweep(prisma, { now: NOW });

    expect(stats.sent).toBe(0);
    expect(email.sendChaseEmail).not.toHaveBeenCalled();
  });

  it('ignores uploads that predate the request', async () => {
    const vendor = await vendorWithRequest(7);
    await createTestCoi(vendor.id, org.id, { submittedAt: daysAgo(30, NOW) });

    const stats = await runChaseSweep(prisma, { now: NOW });

    expect(stats.sent).toBe(1);
  });

  it('restarts the ladder when a newer request goes out', async () => {
    const vendor = await vendorWithRequest(20);
    await runChaseSweep(prisma, { now: NOW }); // day-14 step

    await createTestNotification(org.id, vendor.id, {
      type: 'UPLOAD_REQUEST',
      recipientEmail: vendor.email,
      sentAt: daysAgo(3, NOW),
    });
    jest.clearAllMocks();

    const stats = await runChaseSweep(prisma, { now: NOW });

    expect(stats.sent).toBe(1);
    const logs = await chaseLogs(vendor.id);
    expect(logs.map((l) => l.meta.step)).toEqual([14, 3]);
  });

  it('never chases a vendor who was never asked', async () => {
    await createTestVendor(org.id);

    const stats = await runChaseSweep(prisma, { now: NOW });

    expect(stats.sent).toBe(0);
  });

  it('honours a custom chaseDaysAfterRequest list', async () => {
    await prisma.organizationSettings.update({
      where: { orgId: org.id },
      data: { chaseDaysAfterRequest: [5] },
    });
    const vendor = await vendorWithRequest(4);

    expect((await runChaseSweep(prisma, { now: NOW })).sent).toBe(0);
    expect((await runChaseSweep(prisma, { now: daysFromNow(1, NOW) })).sent).toBe(1);
    expect((await chaseLogs(vendor.id))[0].meta.step).toBe(5);
  });

  it('skips the org entirely when chasing is switched off', async () => {
    await prisma.organizationSettings.update({
      where: { orgId: org.id },
      data: { chaseNonResponders: false },
    });
    await vendorWithRequest(14);

    const stats = await runChaseSweep(prisma, { now: NOW });

    expect(stats.sent).toBe(0);
    expect(stats.escalated).toBe(0);
  });
});

describe('runChaseSweep — placeholder emails', () => {
  it('records a FAILED log instead of emailing an unroutable address', async () => {
    const vendor = await vendorWithRequest(3, {
      email: 'acme-plumbing-rec123@no-email.proofcoi.local',
    });

    const stats = await runChaseSweep(prisma, { now: NOW });

    expect(stats.failed).toBe(1);
    expect(stats.sent).toBe(0);
    expect(email.sendChaseEmail).not.toHaveBeenCalled();

    const logs = await chaseLogs(vendor.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('FAILED');
    expect(logs[0].meta.reason).toBe('PLACEHOLDER_EMAIL');
    expect(logs[0].meta.step).toBe(3);
  });

  it('logs the skip once per step rather than every morning', async () => {
    const vendor = await vendorWithRequest(3, {
      email: 'acme-plumbing-rec456@no-email.proofcoi.local',
    });

    await runChaseSweep(prisma, { now: NOW });
    await runChaseSweep(prisma, { now: daysFromNow(1, NOW) });
    await runChaseSweep(prisma, { now: daysFromNow(2, NOW) });

    expect(await chaseLogs(vendor.id)).toHaveLength(1);
  });
});

describe('runChaseSweep — escalation', () => {
  it('flags the request once the whole ladder went unanswered', async () => {
    const vendor = await vendorWithRequest(15);

    const stats = await runChaseSweep(prisma, { now: NOW });

    expect(stats.escalated).toBe(1);
    const flags = await prisma.auditLog.findMany({
      where: { entityId: vendor.id, action: 'chase_escalated' },
    });
    expect(flags).toHaveLength(1);
    expect(flags[0].details.daysSinceRequest).toBe(15);
    expect(flags[0].details.chaseDays).toEqual([3, 7, 14]);
  });

  it('does not escalate while follow-ups are still outstanding', async () => {
    await vendorWithRequest(14);

    const stats = await runChaseSweep(prisma, { now: NOW });

    expect(stats.escalated).toBe(0);
  });

  it('flags a request only once, however long it stays ignored', async () => {
    const vendor = await vendorWithRequest(15);

    await runChaseSweep(prisma, { now: NOW });
    await runChaseSweep(prisma, { now: daysFromNow(1, NOW) });
    await runChaseSweep(prisma, { now: daysFromNow(40, NOW) });

    const flags = await prisma.auditLog.findMany({
      where: { entityId: vendor.id, action: 'chase_escalated' },
    });
    expect(flags).toHaveLength(1);
  });
});

describe('runExpirationSweep — reminder windows', () => {
  // The COI expires 27 days after NOW, so it already sits inside the 30-day
  // window without ever landing on day 30 exactly.
  async function vendorExpiringIn(days, overrides = {}) {
    const vendor = await createTestVendor(org.id, overrides);
    const coi = await createTestCoi(vendor.id, org.id, {
      status: 'APPROVED',
      submittedAt: daysAgo(1, NOW),
      glExpirationDate: daysFromNow(days, NOW),
    });
    return { vendor, coi };
  }

  function reminderLogs(vendorId) {
    return prisma.notificationLog.findMany({
      where: { vendorId, type: 'EXPIRATION_REMINDER' },
      orderBy: { sentAt: 'asc' },
    });
  }

  it('reminds inside a window the job never ran on', async () => {
    const { vendor } = await vendorExpiringIn(27);

    const stats = await runExpirationSweep(prisma, { now: NOW });

    expect(stats.sent).toBe(1);
    const logs = await reminderLogs(vendor.id);
    expect(logs[0].meta.window).toBe(30);
    expect(logs[0].meta.daysUntil).toBe(27);
  });

  it('leaves a COI alone until it enters the widest window', async () => {
    await vendorExpiringIn(45);

    const stats = await runExpirationSweep(prisma, { now: NOW });

    expect(stats.sent).toBe(0);
    expect(email.sendExpirationReminderEmail).not.toHaveBeenCalled();
  });

  it('sends each window exactly once as expiration approaches', async () => {
    const { vendor } = await vendorExpiringIn(27);

    await runExpirationSweep(prisma, { now: NOW }); // 27 days out -> 30 window
    await runExpirationSweep(prisma, { now: daysFromNow(1, NOW) }); // 26 -> still 30
    await runExpirationSweep(prisma, { now: daysFromNow(17, NOW) }); // 10 -> 14 window
    await runExpirationSweep(prisma, { now: daysFromNow(22, NOW) }); // 5 -> 7 window
    await runExpirationSweep(prisma, { now: daysFromNow(30, NOW) }); // expired -> 0 window

    const logs = await reminderLogs(vendor.id);
    expect(logs.map((l) => l.meta.window)).toEqual([30, 14, 7, 0]);
    expect(email.sendExpirationReminderEmail).toHaveBeenCalledTimes(4);
  });

  it('treats an already-expired COI as the day-0 window', async () => {
    const { vendor } = await vendorExpiringIn(-5);

    await runExpirationSweep(prisma, { now: NOW });

    const logs = await reminderLogs(vendor.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].meta.window).toBe(0);
    expect(logs[0].meta.daysUntil).toBe(-5);
  });

  it('starts a fresh set of windows for a newer approved COI', async () => {
    const { vendor } = await vendorExpiringIn(27);
    await runExpirationSweep(prisma, { now: NOW });

    await createTestCoi(vendor.id, org.id, {
      status: 'APPROVED',
      submittedAt: daysFromNow(1, NOW),
      glExpirationDate: daysFromNow(28, NOW),
    });

    const stats = await runExpirationSweep(prisma, { now: daysFromNow(1, NOW) });

    expect(stats.sent).toBe(1);
    expect(await reminderLogs(vendor.id)).toHaveLength(2);
  });

  it('honours a custom reminder window list', async () => {
    await prisma.organizationSettings.update({
      where: { orgId: org.id },
      data: { reminderDaysBefore: [60] },
    });
    const { vendor } = await vendorExpiringIn(45);

    await runExpirationSweep(prisma, { now: NOW });

    const logs = await reminderLogs(vendor.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].meta.window).toBe(60);
  });

  it('records a FAILED log for an unroutable address and sends nothing', async () => {
    const { vendor } = await vendorExpiringIn(27, {
      email: 'no-contact-rec789@no-email.proofcoi.local',
    });

    const stats = await runExpirationSweep(prisma, { now: NOW });

    expect(stats.failed).toBe(1);
    expect(email.sendExpirationReminderEmail).not.toHaveBeenCalled();

    const logs = await reminderLogs(vendor.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('FAILED');
    expect(logs[0].meta.reason).toBe('PLACEHOLDER_EMAIL');

    // And it doesn't re-log the same skip on the next run.
    await runExpirationSweep(prisma, { now: daysFromNow(1, NOW) });
    expect(await reminderLogs(vendor.id)).toHaveLength(1);
  });

  it('skips the org when expiration notifications are switched off', async () => {
    await prisma.organizationSettings.update({
      where: { orgId: org.id },
      data: { notifyOnExpiration: false },
    });
    await vendorExpiringIn(5);

    const stats = await runExpirationSweep(prisma, { now: NOW });

    expect(stats.sent).toBe(0);
  });

  it('ignores COIs that are still pending review', async () => {
    const vendor = await createTestVendor(org.id);
    await createTestCoi(vendor.id, org.id, {
      status: 'PENDING_REVIEW',
      glExpirationDate: daysFromNow(3, NOW),
    });

    const stats = await runExpirationSweep(prisma, { now: NOW });

    expect(stats.sent).toBe(0);
  });
});
