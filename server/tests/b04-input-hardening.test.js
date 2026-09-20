jest.mock('../src/services/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('test/mock-file.pdf'),
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-signed-url.com/test.pdf'),
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

const mockSend = jest.fn().mockResolvedValue({ data: { id: 'msg_1' }, error: null });
jest.mock('resend', () => ({
  Resend: jest.fn(() => ({ emails: { send: (...args) => mockSend(...args) } })),
}));

const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  createTestOrg,
  createTestUser,
  createTestVendor,
  getAuthToken,
  cleanupTestData,
} = require('./setup');
const { sendUploadRequestEmail, escapeHtml } = require('../src/services/email');
const {
  extractCoiData,
  EXTRACT_AUDIT_ACTION,
  EXTRACT_AUDIT_ENTITY,
  getExtractMaxBytes,
  getExtractDailyCap,
} = require('../src/services/coiExtractor');

const TINY_PDF = Buffer.from('%PDF-1.4\n%EOF\n');

let org;
let user;
let token;
let vendor;

beforeAll(async () => {
  process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_key';
  process.env.FROM_EMAIL = process.env.FROM_EMAIL || 'from@test.com';
  await cleanupTestData();
  org = await createTestOrg({ name: 'B04 Org' });
  user = await createTestUser(org.id, { email: `b04-admin-${Date.now()}@test.com` });
  token = getAuthToken(user);
  vendor = await createTestVendor(org.id, { email: `b04-vendor-${Date.now()}@acme.com` });
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe('A4-03 email HTML escape', () => {
  it('escapes an org name that contains <img in outbound HTML', async () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');

    mockSend.mockClear();
    await sendUploadRequestEmail(
      'vendor@example.com',
      'Acme <b>Co</b>',
      'https://app.proofcoi.com/portal/abc',
      { name: '<img src=x onerror=alert(1)>', email: 'gc@test.com', address: '1 Main' }
    );

    expect(mockSend).toHaveBeenCalled();
    const payload = mockSend.mock.calls[0][0];
    expect(payload.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(payload.html).not.toContain('<img src=x onerror=alert(1)>');
    expect(payload.html).toContain('Acme &lt;b&gt;Co&lt;/b&gt;');
  });
});

describe('A4-04 extract caps', () => {
  it('rejects a PDF over the byte cap with 413', async () => {
    const oversized = Buffer.concat([TINY_PDF, Buffer.alloc(getExtractMaxBytes())]);
    await expect(extractCoiData(oversized, { orgId: org.id })).rejects.toMatchObject({
      status: 413,
      code: 'EXTRACT_BYTE_LIMIT',
    });

    const res = await request(app)
      .post(`/api/vendors/${vendor.id}/coi/upload`)
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', oversized, { filename: 'big.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(413);
    expect(res.body.code).toBe('EXTRACT_BYTE_LIMIT');
  });

  it('rejects the 11th extract in a day with 429', async () => {
    const cap = getExtractDailyCap();
    await prisma.auditLog.createMany({
      data: Array.from({ length: cap }, () => ({
        orgId: org.id,
        action: EXTRACT_AUDIT_ACTION,
        entity: EXTRACT_AUDIT_ENTITY,
      })),
    });

    await expect(extractCoiData(TINY_PDF, { orgId: org.id })).rejects.toMatchObject({
      status: 429,
      code: 'EXTRACT_DAILY_CAP',
    });

    const res = await request(app)
      .post(`/api/vendors/${vendor.id}/coi/upload`)
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', TINY_PDF, { filename: 'coi.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('EXTRACT_DAILY_CAP');
  });
});

describe('A4-05 zod on remaining routes', () => {
  it('PUT /api/settings with a non-numeric amount is 400 not 500', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ minGeneralLiability: 'x' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('PUT /api/vendors/:id rejects an invalid email', async () => {
    const res = await request(app)
      .put(`/api/vendors/${vendor.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
  });

  it('POST /api/auth/google rejects a privileged plan key', async () => {
    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'tok', plan: 'UNLIMITED' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/plan/i);
  });

  it('POST /api/auth/forgot-password rejects a non-email', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
  });

  it('POST /api/apply/:slug rejects a non-email', async () => {
    const slugOrg = await createTestOrg({ name: 'Apply Zod', slug: `apply-zod-${Date.now()}` });
    const res = await request(app)
      .post(`/api/apply/${slugOrg.slug}`)
      .field('name', 'Applicant LLC')
      .field('email', 'not-an-email')
      .field('phone', '555-0100')
      .field('address', '1 Main');

    expect(res.status).toBe(400);
  });
});

describe('A4-07 PDF magic bytes', () => {
  it('rejects a PDF-mimetype upload whose body is not %PDF-', async () => {
    const res = await request(app)
      .post(`/api/vendors/${vendor.id}/coi/upload`)
      .set('Authorization', `Bearer ${token}`)
      .attach('pdf', Buffer.from('MZ\x90\x00this-is-not-a-pdf'), {
        filename: 'malware.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid PDF/i);
  });
});

describe('A4-08 export-pdfs cap', () => {
  it('rejects 51 COI IDs with 400', async () => {
    const coiIds = Array.from({ length: 51 }, (_, i) => (
      `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    ));
    const res = await request(app)
      .post('/api/reports/export-pdfs')
      .set('Authorization', `Bearer ${token}`)
      .send({ coiIds });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/50/);
  });
});

describe('A4-10 notification parseLimit', () => {
  it('clamps ?limit=999999 to 200', async () => {
    const existing = await prisma.notificationLog.count({ where: { orgId: org.id } });
    const needed = 210 - existing;
    if (needed > 0) {
      await prisma.notificationLog.createMany({
        data: Array.from({ length: needed }, (_, i) => ({
          orgId: org.id,
          vendorId: vendor.id,
          type: 'UPLOAD_REQUEST',
          recipientEmail: `n${i}-${Date.now()}@test.com`,
          status: 'SENT',
        })),
      });
    }

    const res = await request(app)
      .get('/api/notifications?limit=999999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(200);
  });

  it('treats a non-numeric limit as the default instead of 500', async () => {
    const res = await request(app)
      .get('/api/notifications?limit=abc')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(50);
  });
});
