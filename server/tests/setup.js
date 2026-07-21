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

function getAuthToken(user) {
  return generateAccessToken(user);
}

async function cleanupTestData() {
  // Delete in dependency order
  await prisma.coiRequest.deleteMany({});
  await prisma.notificationLog.deleteMany({});
  await prisma.coi.deleteMany({});
  await prisma.vendor.deleteMany({});
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
  getAuthToken,
  cleanupTestData,
};
