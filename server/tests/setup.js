const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { generateAccessToken, generateUploadToken } = require('../src/utils/tokens');

const prisma = new PrismaClient();

const TEST_PASSWORD = 'TestPass1';
const TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 4); // Lower rounds for speed

async function createTestOrg(overrides = {}) {
  const org = await prisma.organization.create({
    data: {
      name: overrides.name || 'Test Org',
      email: overrides.email || `testorg-${Date.now()}@test.com`,
      plan: overrides.plan || 'FREE',
      ...(overrides.slug && { slug: overrides.slug }),
      settings: { create: {} },
    },
    include: { settings: true },
  });
  return org;
}

async function createTestUser(orgId, overrides = {}) {
  const user = await prisma.user.create({
    data: {
      orgId,
      email: overrides.email || `testuser-${Date.now()}@test.com`,
      passwordHash: overrides.passwordHash || TEST_PASSWORD_HASH,
      firstName: overrides.firstName || 'Test',
      lastName: overrides.lastName || 'User',
      role: overrides.role || 'ADMIN',
      inviteToken: overrides.inviteToken || null,
    },
    include: { organization: true },
  });
  return user;
}

async function createTestVendor(orgId, overrides = {}) {
  const vendor = await prisma.vendor.create({
    data: {
      orgId,
      name: overrides.name || `Test Vendor ${Date.now()}`,
      email: overrides.email || `vendor-${Date.now()}@test.com`,
      contactName: overrides.contactName || 'Contact Person',
      uploadToken: overrides.uploadToken || undefined,
    },
  });

  // Update with signed upload token
  const updated = await prisma.vendor.update({
    where: { id: vendor.id },
    data: { uploadToken: generateUploadToken(vendor.id) },
  });

  return updated;
}

async function createTestCoi(vendorId, orgId, overrides = {}) {
  return prisma.coi.create({
    data: {
      vendorId,
      orgId,
      pdfPath: overrides.pdfPath || 'test/test.pdf',
      status: overrides.status || 'PENDING_REVIEW',
      ...overrides,
    },
  });
}

async function createTestNotification(orgId, vendorId, overrides = {}) {
  return prisma.notificationLog.create({
    data: {
      orgId,
      vendorId,
      type: overrides.type || 'UPLOAD_REQUEST',
      recipientEmail: overrides.recipientEmail || 'vendor@test.com',
      status: overrides.status || 'SENT',
      ...(overrides.sentAt && { sentAt: overrides.sentAt }),
      ...(overrides.coiId && { coiId: overrides.coiId }),
      ...(overrides.meta && { meta: overrides.meta }),
    },
  });
}

// Shift a date by whole days — tests express scenarios as "7 days ago".
function daysAgo(n, from = new Date()) {
  return new Date(from.getTime() - n * 24 * 60 * 60 * 1000);
}

function daysFromNow(n, from = new Date()) {
  return new Date(from.getTime() + n * 24 * 60 * 60 * 1000);
}

function getAuthToken(user) {
  return generateAccessToken(user);
}

async function cleanupTestData() {
  // Delete in dependency order
  await prisma.auditLog.deleteMany({});
  await prisma.coiRequest.deleteMany({});
  await prisma.notificationLog.deleteMany({});
  await prisma.coi.deleteMany({});
  await prisma.vendor.deleteMany({});
  await prisma.webhookEndpoint.deleteMany({});
  await prisma.apiClient.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.organizationSettings.deleteMany({});
  await prisma.organization.deleteMany({});
}

module.exports = {
  prisma,
  TEST_PASSWORD,
  createTestOrg,
  createTestUser,
  createTestVendor,
  createTestCoi,
  createTestNotification,
  daysAgo,
  daysFromNow,
  getAuthToken,
  cleanupTestData,
};
