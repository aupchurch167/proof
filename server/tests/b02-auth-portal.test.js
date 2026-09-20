const path = require('path');
const { spawnSync } = require('child_process');
const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  TEST_PASSWORD,
  createTestOrg,
  createTestUser,
  createTestVendor,
  getAuthToken,
  cleanupTestData,
} = require('./setup');
const { hashToken } = require('../src/lib/apiTokens');
const { generateUploadToken } = require('../src/utils/tokens');

jest.mock('../src/lib/google', () => ({
  verifyGoogleIdToken: jest.fn(),
  isGoogleConfigured: jest.fn(() => true),
}));

const { verifyGoogleIdToken } = require('../src/lib/google');

jest.mock('../src/services/email', () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendEmailVerificationEmail: jest.fn().mockResolvedValue(undefined),
  sendInviteEmail: jest.fn().mockResolvedValue(undefined),
}));

const { sendEmailVerificationEmail } = require('../src/services/email');

let orgA, orgB, adminA, adminB, memberA, vendorA, vendorB, tokenA, tokenB, memberToken;

beforeAll(async () => {
  await cleanupTestData();
  orgA = await createTestOrg({ name: 'Org A', slug: `b02-a-${Date.now()}` });
  orgB = await createTestOrg({ name: 'Org B', slug: `b02-b-${Date.now()}` });
  adminA = await createTestUser(orgA.id, { email: `admin-a-${Date.now()}@test.com` });
  adminB = await createTestUser(orgB.id, { email: `admin-b-${Date.now()}@test.com` });
  memberA = await createTestUser(orgA.id, {
    email: `member-a-${Date.now()}@test.com`,
    role: 'MEMBER',
  });
  vendorA = await createTestVendor(orgA.id, { name: 'Vendor A', email: `va-${Date.now()}@test.com` });
  vendorB = await createTestVendor(orgB.id, { name: 'Vendor B', email: `vb-${Date.now()}@test.com` });
  tokenA = getAuthToken(adminA);
  tokenB = getAuthToken(adminB);
  memberToken = getAuthToken(memberA);
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

describe('A1-02 requireVerified', () => {
  it('blocks unverified users from tenant APIs and allows auth + templates', async () => {
    const email = `unverified-${Date.now()}@test.com`;
    const signup = await request(app).post('/api/auth/signup').send({
      orgName: 'Unverified Co',
      email,
      password: 'StrongPass1',
      firstName: 'Una',
      lastName: 'Verified',
    });
    expect(signup.status).toBe(201);
    expect(signup.body.accessToken).toBeTruthy();
    const token = signup.body.accessToken;

    const vendors = await request(app).get('/api/vendors').set(auth(token));
    expect(vendors.status).toBe(403);
    expect(vendors.body.code).toBe('EMAIL_NOT_VERIFIED');

    const me = await request(app).get('/api/auth/me').set(auth(token));
    expect(me.status).toBe(200);
    expect(me.body.emailVerified).toBe(false);

    const resend = await request(app).post('/api/auth/resend-verification').set(auth(token));
    expect(resend.status).toBe(200);

    const template = await request(app).get('/api/import/template/vendors');
    expect(template.status).toBe(200);

    const dbUser = await prisma.user.findUnique({ where: { email } });
    const verify = await request(app).get('/api/auth/verify-email').query({
      token: dbUser.emailVerifyToken,
    });
    expect(verify.status).toBe(200);

    const after = await request(app).get('/api/vendors').set(auth(token));
    expect(after.status).toBe(200);
  });
});

describe('A1-06 generic signup', () => {
  it('returns 201 for an already-registered email without logging in as that user', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      orgName: 'Should Not Create',
      email: adminA.email,
      password: 'StrongPass1',
      firstName: 'Dup',
      lastName: 'User',
    });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.user).toBeUndefined();
    expect(res.body.message).toMatch(/verification email/i);
  });
});

describe('A1-09 / A1-04 invites', () => {
  it('does not return inviteToken from GET /users and marks pending via invitePending', async () => {
    const raw = `invite-${Date.now()}`;
    await prisma.user.create({
      data: {
        orgId: orgA.id,
        email: `pending-${Date.now()}@test.com`,
        firstName: '',
        lastName: '',
        role: 'MEMBER',
        inviteTokenHash: hashToken(raw),
        inviteTokenExpiry: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    });

    const res = await request(app).get('/api/users').set(auth(tokenA));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/inviteToken/);
    expect(res.body.some((u) => u.invitePending)).toBe(true);
  });

  it('sets emailVerified on accept-invite', async () => {
    const raw = `accept-${Date.now()}`;
    await prisma.user.create({
      data: {
        orgId: orgA.id,
        email: `accept-${Date.now()}@test.com`,
        firstName: '',
        lastName: '',
        role: 'MEMBER',
        inviteTokenHash: hashToken(raw),
        inviteTokenExpiry: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    });

    const accept = await request(app).post('/api/auth/accept-invite').send({
      token: raw,
      firstName: 'Invited',
      lastName: 'Teammate',
      password: 'StrongPass1',
    });
    expect(accept.status).toBe(200);
    expect(accept.body.user.emailVerified).toBe(true);

    const me = await request(app).get('/api/auth/me').set(auth(accept.body.accessToken));
    expect(me.body.emailVerified).toBe(true);
  });

  it('rejects an expired invite', async () => {
    const raw = `expired-${Date.now()}`;
    await prisma.user.create({
      data: {
        orgId: orgA.id,
        email: `expired-${Date.now()}@test.com`,
        firstName: '',
        lastName: '',
        role: 'MEMBER',
        inviteTokenHash: hashToken(raw),
        inviteTokenExpiry: new Date(Date.now() - 1000),
      },
    });

    const res = await request(app).post('/api/auth/accept-invite').send({
      token: raw,
      firstName: 'Too',
      lastName: 'Late',
      password: 'StrongPass1',
    });
    expect(res.status).toBe(404);
  });
});

describe('A1-11 PUT /me', () => {
  it('rejects a non-email via updateProfile zod', async () => {
    const res = await request(app)
      .put('/api/auth/me')
      .set(auth(tokenA))
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('requires currentPassword to change email', async () => {
    const res = await request(app)
      .put('/api/auth/me')
      .set(auth(tokenA))
      .send({ email: `new-${Date.now()}@test.com` });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/current password/i);
  });

  it('does not steal another tenant email (X-03) and re-verifies on change', async () => {
    const conflict = await request(app)
      .put('/api/auth/me')
      .set(auth(tokenA))
      .send({ email: adminB.email, currentPassword: TEST_PASSWORD });
    expect(conflict.status).toBe(409);

    const stillB = await prisma.user.findUnique({ where: { id: adminB.id } });
    expect(stillB.email).toBe(adminB.email);

    const nextEmail = `reverify-${Date.now()}@test.com`;
    const ok = await request(app)
      .put('/api/auth/me')
      .set(auth(tokenA))
      .send({ email: nextEmail, currentPassword: TEST_PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.email).toBe(nextEmail);
    expect(ok.body.emailVerified).toBe(false);
    expect(sendEmailVerificationEmail).toHaveBeenCalled();

    // restore so later tests using tokenA still match adminA.email lookups
    await prisma.user.update({
      where: { id: adminA.id },
      data: { email: adminA.email, emailVerified: true, emailVerifyToken: null },
    });
  });
});

describe('A1-01 logout and password-reset revoke refresh', () => {
  it('rejects refresh after logout', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: adminA.email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    const { refreshToken, accessToken } = login.body;

    const logout = await request(app)
      .post('/api/auth/logout')
      .set(auth(accessToken))
      .send({ refreshToken });
    expect(logout.status).toBe(200);

    const refresh = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(refresh.status).toBe(401);
  });

  it('rejects refresh after password reset', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: adminA.email, password: TEST_PASSWORD });
    const { refreshToken } = login.body;

    const resetToken = `reset-${Date.now()}`;
    await prisma.user.update({
      where: { id: adminA.id },
      data: { resetToken, resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000) },
    });

    const reset = await request(app).post('/api/auth/reset-password').send({
      token: resetToken,
      newPassword: TEST_PASSWORD,
    });
    expect(reset.status).toBe(200);

    const refresh = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(refresh.status).toBe(401);
  });
});

describe('A1-12 jwt algorithms pin', () => {
  it('rejects an alg=none access token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      id: adminA.id, orgId: adminA.orgId, email: adminA.email, role: adminA.role,
    })).toString('base64url');
    const noneToken = `${header}.${payload}.`;

    const res = await request(app).get('/api/auth/me').set(auth(noneToken));
    expect(res.status).toBe(401);
  });
});

describe('A1-10 seed refuses production', () => {
  it('exits 1 when NODE_ENV=production', () => {
    const result = spawnSync(process.execPath, ['prisma/seed.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'production' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toMatch(/production/i);
  });
});

describe('A2-04 / V-01 / O-03 tokens stripped', () => {
  it('GET /api/vendors returns only this org and never uploadToken (V-01)', async () => {
    const res = await request(app).get('/api/vendors').set(auth(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.every((v) => v.orgId === orgA.id)).toBe(true);
    expect(res.body.some((v) => v.id === vendorB.id)).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/uploadToken/);
  });

  it('usage omits portalPreviewToken for non-admins (O-03)', async () => {
    const member = await request(app).get('/api/organization/usage').set(auth(memberToken));
    expect(member.status).toBe(200);
    expect(member.body).not.toHaveProperty('portalPreviewToken');

    const admin = await request(app).get('/api/organization/usage').set(auth(tokenA));
    expect(admin.status).toBe(200);
    expect(admin.body.portalPreviewToken).toBeTruthy();
    expect(admin.body.portalPreviewToken).not.toBe(vendorB.uploadToken);
    expect(admin.body.portalPreviewToken).not.toBe(vendorA.uploadToken);
  });
});

describe('A2-05 / L-02 apply slug only + plan limit', () => {
  it('GET /api/apply/:orgId is 404 (L-02)', async () => {
    const res = await request(app).get(`/api/apply/${orgB.id}`);
    expect(res.status).toBe(404);
  });

  it('POST /api/apply/:uuid is 404', async () => {
    const res = await request(app)
      .post(`/api/apply/${orgA.id}`)
      .field('name', 'Stranger LLC')
      .field('email', `apply-${Date.now()}@test.com`)
      .field('phone', '555-0100')
      .field('address', '1 Main');
    expect(res.status).toBe(404);
  });

  it('POST /api/apply/:slug at FREE cap returns PLAN_LIMIT_EXCEEDED', async () => {
    const org = await createTestOrg({ name: 'Capped', slug: `capped-${Date.now()}`, plan: 'FREE' });
    const existing = await prisma.vendor.count({ where: { orgId: org.id, deletedAt: null } });
    const toCreate = 20 - existing;
    for (let i = 0; i < toCreate; i += 1) {
      await createTestVendor(org.id, { email: `cap-${i}-${Date.now()}@test.com` });
    }

    const res = await request(app)
      .post(`/api/apply/${org.slug}`)
      .field('name', 'One Too Many')
      .field('email', `over-${Date.now()}@test.com`)
      .field('phone', '555-0100')
      .field('address', '1 Main');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PLAN_LIMIT_EXCEEDED');
  });
});

describe('A1-13 / T-02 portal JWT lookup', () => {
  it('does not return vendor B for vendor A token (T-02)', async () => {
    const res = await request(app).get(`/api/portal/${vendorA.uploadToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(vendorA.id);
    expect(res.body.id).not.toBe(vendorB.id);
  });

  it('looks up the vendor by JWT payload id, not the stored string', async () => {
    const minted = generateUploadToken(vendorA.id, '15m');
    const res = await request(app).get(`/api/portal/${minted}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(vendorA.id);
  });
});

describe('X-02 GET /me stays on the caller org', () => {
  it('returns orgId A for tokenA', async () => {
    const res = await request(app).get('/api/auth/me').set(auth(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.orgId).toBe(orgA.id);
  });
});
