// Mock the dispatcher so we can assert the wiring (does updateVendorStatus emit,
// and only on a real status change?) without performing HTTP delivery.
jest.mock('../src/services/webhookDispatcher', () => ({
  EVENTS: { COI_UPDATED: 'coi.updated' },
  emitCoiUpdated: jest.fn().mockResolvedValue(0),
}));

const { emitCoiUpdated } = require('../src/services/webhookDispatcher');
const { updateVendorStatus } = require('../src/services/compliance');
const { prisma, createTestOrg, createTestVendor, createTestCoi, cleanupTestData } = require('./setup');

const DAY = 24 * 60 * 60 * 1000;

let org, vendor;

beforeAll(async () => {
  await cleanupTestData();
  org = await createTestOrg();
  vendor = await createTestVendor(org.id, { name: 'Wiring Co', email: 'w@wiring.com' });
  await prisma.vendor.update({ where: { id: vendor.id }, data: { coiStatus: 'NO_COI' } });
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

beforeEach(() => emitCoiUpdated.mockClear());

describe('updateVendorStatus -> coi.updated wiring', () => {
  it('emits when the status changes', async () => {
    // Give the vendor a fully-compliant approved COI, then recompute.
    await createTestCoi(vendor.id, org.id, {
      status: 'APPROVED',
      glCoverageAmount: 200000000,
      glExpirationDate: new Date(Date.now() + 120 * DAY),
      wcCoverageAmount: 100000000,
      wcExpirationDate: new Date(Date.now() + 120 * DAY),
      umbCoverageAmount: 200000000,
      umbExpirationDate: new Date(Date.now() + 120 * DAY),
      autoCoverageAmount: 200000000,
      autoExpirationDate: new Date(Date.now() + 120 * DAY),
    });

    await updateVendorStatus(prisma, vendor.id, org.id);

    expect(emitCoiUpdated).toHaveBeenCalledTimes(1);
    expect(emitCoiUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: org.id, vendorId: vendor.id, coiStatus: 'COMPLIANT' })
    );
  });

  it('does not emit when the status is unchanged', async () => {
    // Vendor is already COMPLIANT from the previous test; recomputing yields the
    // same status, so no event should fire.
    await updateVendorStatus(prisma, vendor.id, org.id);
    expect(emitCoiUpdated).not.toHaveBeenCalled();
  });
});
