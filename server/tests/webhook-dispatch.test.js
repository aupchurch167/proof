const crypto = require('crypto');
const { emitCoiUpdated, sign, EVENTS } = require('../src/services/webhookDispatcher');
const { prisma, cleanupTestData } = require('./setup');

function createOrg(slug) {
  return prisma.organization.create({
    data: { name: `Org ${slug}`, email: `${slug}@test.com`, slug, settings: { create: {} } },
  });
}

function createEndpoint({ orgId = null, allOrgs = false, events = [EVENTS.COI_UPDATED], url = 'https://hook.test/proof', secret = 'whsec_test' }) {
  return prisma.webhookEndpoint.create({ data: { name: 'ep', url, secret, events, orgId, allOrgs } });
}

let orgA, orgB;
let fetchMock;

beforeAll(async () => {
  await cleanupTestData();
  const ts = Date.now();
  orgA = await createOrg(`wh-a-${ts}`);
  orgB = await createOrg(`wh-b-${ts}`);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  global.fetch = fetchMock;
});

afterEach(async () => {
  await prisma.webhookEndpoint.deleteMany({});
  jest.restoreAllMocks();
});

describe('emitCoiUpdated delivery', () => {
  it('POSTs a signed coi.updated payload to a subscribed endpoint', async () => {
    const ep = await createEndpoint({ orgId: orgA.id, secret: 'whsec_abc' });

    const count = await emitCoiUpdated({
      orgId: orgA.id,
      vendorId: 'vendor-1',
      coiStatus: 'EXPIRED',
      latestApprovedCoi: { glExpirationDate: new Date('2026-07-20') },
    });

    expect(count).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(ep.url);
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-proof-event']).toBe('coi.updated');

    // Payload shape
    const body = JSON.parse(opts.body);
    expect(body.event).toBe('coi.updated');
    expect(body.orgSlug).toBe(orgA.slug);
    expect(body.vendorId).toBe('vendor-1');
    expect(body.coi.status).toBe('expired');
    expect(body.coi.expiresAt).toBe('2026-07-20');

    // Signature is HMAC-SHA256 of the exact raw body with the endpoint secret.
    const expected = crypto.createHmac('sha256', 'whsec_abc').update(opts.body).digest('hex');
    expect(opts.headers['x-proof-signature']).toBe(expected);
    expect(sign('whsec_abc', opts.body)).toBe(expected);

    // Delivery status recorded.
    const refreshed = await prisma.webhookEndpoint.findUnique({ where: { id: ep.id } });
    expect(refreshed.lastDeliveryStatus).toBe('success');
    expect(refreshed.lastDeliveryAt).not.toBeNull();
  });

  it('does not deliver to endpoints not subscribed to the event', async () => {
    await createEndpoint({ orgId: orgA.id, events: ['something.else'] });
    const count = await emitCoiUpdated({ orgId: orgA.id, vendorId: 'v', coiStatus: 'COMPLIANT', latestApprovedCoi: null });
    expect(count).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not deliver to endpoints belonging to a different org', async () => {
    await createEndpoint({ orgId: orgB.id });
    const count = await emitCoiUpdated({ orgId: orgA.id, vendorId: 'v', coiStatus: 'COMPLIANT', latestApprovedCoi: null });
    expect(count).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('delivers to an all-orgs endpoint for any org', async () => {
    await createEndpoint({ allOrgs: true });
    const count = await emitCoiUpdated({ orgId: orgA.id, vendorId: 'v', coiStatus: 'NO_COI', latestApprovedCoi: null });
    expect(count).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('records a failed delivery status without throwing', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const ep = await createEndpoint({ orgId: orgA.id });
    const count = await emitCoiUpdated({ orgId: orgA.id, vendorId: 'v', coiStatus: 'PENDING', latestApprovedCoi: null });
    expect(count).toBe(1);
    const refreshed = await prisma.webhookEndpoint.findUnique({ where: { id: ep.id } });
    expect(refreshed.lastDeliveryStatus).toBe('failed:503');
  });

  it('skips inactive endpoints', async () => {
    const ep = await createEndpoint({ orgId: orgA.id });
    await prisma.webhookEndpoint.update({ where: { id: ep.id }, data: { active: false } });
    const count = await emitCoiUpdated({ orgId: orgA.id, vendorId: 'v', coiStatus: 'COMPLIANT', latestApprovedCoi: null });
    expect(count).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
