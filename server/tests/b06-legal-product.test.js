jest.mock('../src/services/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('test/mock-file.pdf'),
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-signed-url.com/w9.pdf'),
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('mock-pdf')),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/email', () => ({
  sendEmailVerificationEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendUploadRequestEmail: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const app = require('../src/app');
const { TERMS_VERSION, PRIVACY_VERSION } = require('../src/legal/documents');
const {
  prisma,
  createTestOrg,
  createTestUser,
  createTestVendor,
  getAuthToken,
  cleanupTestData,
} = require('./setup');

beforeAll(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe('A10-01 signup legal acceptance', () => {
  it('returns 400 when acceptTerms is missing', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      orgName: 'No Accept Co',
      email: `no-accept-${Date.now()}@test.com`,
      password: 'StrongPass1',
      firstName: 'No',
      lastName: 'Accept',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/terms|privacy/i);
  });

  it('returns 400 when acceptTerms is false', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      orgName: 'False Accept Co',
      email: `false-accept-${Date.now()}@test.com`,
      password: 'StrongPass1',
      firstName: 'False',
      lastName: 'Accept',
      acceptTerms: false,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/terms|privacy/i);
  });

  it('records document versions when acceptTerms is true', async () => {
    const email = `accepted-${Date.now()}@test.com`;
    const res = await request(app).post('/api/auth/signup').send({
      orgName: 'Accepted Co',
      email,
      password: 'StrongPass1',
      firstName: 'Yes',
      lastName: 'Accept',
      acceptTerms: true,
    });
    expect(res.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user.termsAcceptedAt).toBeTruthy();
    expect(user.privacyAcceptedAt).toBeTruthy();
    expect(user.termsVersion).toBe(TERMS_VERSION);
    expect(user.privacyVersion).toBe(PRIVACY_VERSION);
  });
});

describe('A10-01 terms/privacy routes', () => {
  it('GET /terms renders the draft terms', async () => {
    const res = await request(app).get('/terms');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/DRAFT/i);
    expect(res.text).toMatch(/Terms of Service/);
    expect(res.text).toMatch(TERMS_VERSION);
    expect(res.text).not.toMatch(/counsel-approved opinion/i);
  });

  it('GET /privacy renders the draft privacy notice with subprocessors', async () => {
    const res = await request(app).get('/privacy');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/DRAFT/i);
    expect(res.text).toMatch(/Privacy Policy/);
    expect(res.text).toMatch(/Google Identity Services/);
    expect(res.text).toMatch(/localStorage/);
    expect(res.text).toMatch(/Resend/);
    expect(res.text).toMatch(/Anthropic/);
    expect(res.text).toMatch(/DigitalOcean Spaces/);
  });
});

describe('A10-02 public apply rejects W-9', () => {
  it('returns 400 when a w9 file is attached', async () => {
    const org = await createTestOrg({ slug: `apply-w9-${Date.now()}` });
    const email = `apply-w9-${Date.now()}@test.com`;
    const res = await request(app)
      .post(`/api/apply/${org.slug}`)
      .field('name', 'Applicant LLC')
      .field('email', email)
      .field('phone', '555-0100')
      .field('address', '1 Main')
      .attach('w9', Buffer.from('%PDF-1.4 w9'), {
        filename: 'w9.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('W9_NOT_ACCEPTED');
    expect(res.body.error).toMatch(/W-9/i);
    expect(await prisma.vendor.findFirst({ where: { orgId: org.id, email } })).toBeNull();
  });

  it('returns 400 when a w9 form field is present', async () => {
    const org = await createTestOrg({ slug: `apply-w9-field-${Date.now()}` });
    const email = `apply-w9-field-${Date.now()}@test.com`;
    const res = await request(app)
      .post(`/api/apply/${org.slug}`)
      .field('name', 'Applicant LLC')
      .field('email', email)
      .field('phone', '555-0100')
      .field('address', '1 Main')
      .field('w9', 'not-a-file');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('W9_NOT_ACCEPTED');
    expect(await prisma.vendor.findFirst({ where: { orgId: org.id, email } })).toBeNull();
  });

  it('still accepts apply without a w9 and leaves existing w9Path in place', async () => {
    const org = await createTestOrg({ slug: `apply-ok-${Date.now()}` });
    const existing = await createTestVendor(org.id, { email: `kept-w9-${Date.now()}@test.com` });
    await prisma.vendor.update({
      where: { id: existing.id },
      data: { w9Path: 'w9s/already-there.pdf' },
    });

    const email = `apply-ok-${Date.now()}@test.com`;
    const res = await request(app)
      .post(`/api/apply/${org.slug}`)
      .field('name', 'Clean Apply LLC')
      .field('email', email)
      .field('phone', '555-0100')
      .field('address', '1 Main');

    expect(res.status).toBe(201);
    const kept = await prisma.vendor.findUnique({ where: { id: existing.id } });
    expect(kept.w9Path).toBe('w9s/already-there.pdf');
  });
});

describe('A10-02 signed W-9 download audit', () => {
  it('writes an audit row when a signed W-9 URL is created', async () => {
    const org = await createTestOrg();
    const user = await createTestUser(org.id, { email: `w9-dl-${Date.now()}@test.com` });
    const vendor = await createTestVendor(org.id, { email: `w9-vendor-${Date.now()}@test.com` });
    await prisma.vendor.update({
      where: { id: vendor.id },
      data: { w9Path: 'w9s/existing.pdf' },
    });

    const res = await request(app)
      .get(`/api/vendors/${vendor.id}`)
      .set('Authorization', `Bearer ${getAuthToken(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.w9Url).toBeTruthy();
    expect(res.body.w9Path).toBe('w9s/existing.pdf');

    const row = await prisma.auditLog.findFirst({
      where: { orgId: org.id, entity: 'w9', action: 'download', entityId: vendor.id },
    });
    expect(row).toBeTruthy();
    expect(row.userId).toBe(user.id);
  });
});
