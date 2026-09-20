jest.mock('../src/services/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('reply-attachments/mock.pdf'),
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-signed-url.com/test.pdf'),
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('mock-pdf')),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/coiExtractor', () => ({
  extractCoiData: jest.fn().mockResolvedValue({ glPolicyNumber: 'GL-1' }),
}));

const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  createTestOrg,
  createTestVendor,
  createTestNotification,
  cleanupTestData,
} = require('./setup');

const SHARED = 'shared@sub.com';
const WEBHOOK_SECRET = `whsec_${Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')}`;

function signSvix(rawBody, secret = WEBHOOK_SECRET) {
  const id = 'msg_test';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');
  return {
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${expected}`,
  };
}

async function postWebhook(body, { signed = true } = {}) {
  const raw = JSON.stringify(body);
  const req = request(app)
    .post('/api/webhooks/resend-inbound')
    .set('Content-Type', 'application/json');
  if (signed) req.set(signSvix(raw));
  return req.send(raw);
}

const inboundPayload = (from = SHARED) => ({
  type: 'email.received',
  data: {
    from: { email: from },
    subject: 'COI attached',
    text: 'here is the certificate',
    attachments: [{
      filename: 'coi.pdf',
      contentType: 'application/pdf',
      content: Buffer.from('%PDF-1.4 test').toString('base64'),
    }],
  },
});

let orgA, orgB, vendorA, vendorB;
const prevSecret = process.env.RESEND_WEBHOOK_SECRET;

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-which-is-32-chars!!';
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-32-chars-ok!';
  process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
  await cleanupTestData();
  orgA = await createTestOrg({ name: 'Org A', slug: `wh1-a-${Date.now()}` });
  orgB = await createTestOrg({ name: 'Org B', slug: `wh1-b-${Date.now()}` });
  vendorA = await createTestVendor(orgA.id, { name: 'Shared Sub A', email: SHARED });
  vendorB = await createTestVendor(orgB.id, { name: 'Shared Sub B', email: SHARED });
});

afterAll(async () => {
  if (prevSecret === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
  else process.env.RESEND_WEBHOOK_SECRET = prevSecret;
  await cleanupTestData();
  await prisma.$disconnect();
});

describe('WH-1 inbound tenant correlation', () => {
  it('files a COI and audit row only on the org that sent the last UPLOAD_REQUEST', async () => {
    await createTestNotification(orgB.id, vendorB.id, {
      type: 'UPLOAD_REQUEST',
      recipientEmail: SHARED,
      status: 'SENT',
      sentAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    await createTestNotification(orgA.id, vendorA.id, {
      type: 'UPLOAD_REQUEST',
      recipientEmail: SHARED,
      status: 'SENT',
      sentAt: new Date(),
    });

    const res = await postWebhook(inboundPayload());
    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(1);

    const [coisA, coisB, auditA, auditB] = await Promise.all([
      prisma.coi.findMany({ where: { orgId: orgA.id } }),
      prisma.coi.findMany({ where: { orgId: orgB.id } }),
      prisma.auditLog.findMany({ where: { orgId: orgA.id, action: 'vendor_reply' } }),
      prisma.auditLog.findMany({ where: { orgId: orgB.id, action: 'vendor_reply' } }),
    ]);
    expect(coisA).toHaveLength(1);
    expect(coisA[0].vendorId).toBe(vendorA.id);
    expect(coisB).toHaveLength(0);
    expect(auditA).toHaveLength(1);
    expect(auditB).toHaveLength(0);
  });
});

describe('WH-2 unsigned inbound', () => {
  it('returns 401 and writes zero rows when the Svix signature is missing', async () => {
    const beforeCois = await prisma.coi.count();
    const beforeAudits = await prisma.auditLog.count({ where: { action: 'vendor_reply' } });

    const res = await postWebhook(inboundPayload(), { signed: false });
    expect(res.status).toBe(401);

    expect(await prisma.coi.count()).toBe(beforeCois);
    expect(await prisma.auditLog.count({ where: { action: 'vendor_reply' } })).toBe(beforeAudits);
  });
});

describe('WH-3 bounce correlation', () => {
  it('flips only the NotificationLog that matches the Resend email_id', async () => {
    const logA = await createTestNotification(orgA.id, vendorA.id, {
      type: 'UPLOAD_REQUEST',
      recipientEmail: SHARED,
      status: 'SENT',
      sentAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      meta: { emailId: 're_org_a' },
    });
    const logB = await createTestNotification(orgB.id, vendorB.id, {
      type: 'UPLOAD_REQUEST',
      recipientEmail: SHARED,
      status: 'SENT',
      sentAt: new Date(),
      meta: { emailId: 're_org_b' },
    });

    const res = await postWebhook({
      type: 'email.bounced',
      data: { to: [SHARED], email_id: 're_org_a', reason: 'mailbox full' },
    });
    expect(res.status).toBe(200);

    const [updatedA, updatedB] = await Promise.all([
      prisma.notificationLog.findUnique({ where: { id: logA.id } }),
      prisma.notificationLog.findUnique({ where: { id: logB.id } }),
    ]);
    expect(updatedA.status).toBe('FAILED');
    expect(updatedB.status).toBe('SENT');
  });

  it('skips when two orgs have recent SENT logs and there is no email_id', async () => {
    const logA = await createTestNotification(orgA.id, vendorA.id, {
      recipientEmail: SHARED,
      status: 'SENT',
      sentAt: new Date(Date.now() - 1000),
    });
    const logB = await createTestNotification(orgB.id, vendorB.id, {
      recipientEmail: SHARED,
      status: 'SENT',
      sentAt: new Date(),
    });

    const res = await postWebhook({
      type: 'email.bounced',
      data: { to: [SHARED], reason: 'unknown' },
    });
    expect(res.status).toBe(200);

    const [updatedA, updatedB] = await Promise.all([
      prisma.notificationLog.findUnique({ where: { id: logA.id } }),
      prisma.notificationLog.findUnique({ where: { id: logB.id } }),
    ]);
    expect(updatedA.status).toBe('SENT');
    expect(updatedB.status).toBe('SENT');
  });
});

describe('A4-01 attachment SSRF', () => {
  it('rejects a private attachment URL without fetching', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const res = await postWebhook({
      type: 'email.received',
      data: {
        from: { email: SHARED },
        subject: 'ssrf',
        attachments: [{ filename: 'x.pdf', url: 'http://127.0.0.1:4000/api/health' }],
      },
    });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
