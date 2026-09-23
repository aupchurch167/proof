const {
  prisma,
  cleanupTestData,
  isSafeTestDatabase,
  UNSAFE_CLEANUP_MESSAGE,
} = require('./setup');

describe('A9-05 cleanupTestData guard', () => {
  const originalUrl = process.env.DATABASE_URL;
  const originalFlag = process.env.PROOF_TEST_DB;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    if (originalFlag === undefined) delete process.env.PROOF_TEST_DB;
    else process.env.PROOF_TEST_DB = originalFlag;
  });

  afterAll(async () => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    if (originalFlag === undefined) delete process.env.PROOF_TEST_DB;
    else process.env.PROOF_TEST_DB = originalFlag;
    await prisma.$disconnect();
  });

  it('allows wipe when PROOF_TEST_DB=1 even if the URL has no _test marker', () => {
    expect(isSafeTestDatabase({
      PROOF_TEST_DB: '1',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/proof',
    })).toBe(true);
  });

  it('allows wipe when DATABASE_URL contains _test', () => {
    expect(isSafeTestDatabase({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/proof_test',
    })).toBe(true);
  });

  it('refuses a production-shaped URL without PROOF_TEST_DB', () => {
    expect(isSafeTestDatabase({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/proof',
    })).toBe(false);
  });

  it('leaves an org named keep-me in place when the guard refuses a wrong URL', async () => {
    const keepMe = await prisma.organization.create({
      data: {
        name: 'keep-me',
        email: `keep-me-${Date.now()}@example.com`,
      },
    });

    delete process.env.PROOF_TEST_DB;
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/proof';

    await expect(cleanupTestData()).rejects.toThrow(UNSAFE_CLEANUP_MESSAGE);

    const still = await prisma.organization.findUnique({ where: { id: keepMe.id } });
    expect(still).not.toBeNull();
    expect(still.name).toBe('keep-me');

    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    if (originalFlag === undefined) delete process.env.PROOF_TEST_DB;
    else process.env.PROOF_TEST_DB = originalFlag;

    await prisma.organization.delete({ where: { id: keepMe.id } });
  });
});
