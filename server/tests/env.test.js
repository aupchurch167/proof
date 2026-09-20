const { validateEnv } = require('../src/config/env');

const VALID = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/proof',
  APP_URL: 'http://localhost:5173',
  JWT_SECRET: 'abcdefghijklmnopqrstuvwxyz012345',
  JWT_REFRESH_SECRET: '012345abcdefghijklmnopqrstuvwxyz',
};

describe('validateEnv', () => {
  it('accepts a complete non-production env', () => {
    expect(validateEnv(VALID)).toMatchObject({
      DATABASE_URL: VALID.DATABASE_URL,
      APP_URL: VALID.APP_URL,
    });
  });

  it('throws when JWT_SECRET is missing', () => {
    const env = { ...VALID };
    delete env.JWT_SECRET;
    expect(() => validateEnv(env)).toThrow(/JWT_SECRET/);
  });

  it('throws when JWT_SECRET is shorter than 32 characters', () => {
    expect(() => validateEnv({ ...VALID, JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it('throws when JWT_REFRESH_SECRET is missing', () => {
    const env = { ...VALID };
    delete env.JWT_REFRESH_SECRET;
    expect(() => validateEnv(env)).toThrow(/JWT_REFRESH_SECRET/);
  });

  it('throws when DATABASE_URL is missing', () => {
    const env = { ...VALID };
    delete env.DATABASE_URL;
    expect(() => validateEnv(env)).toThrow(/DATABASE_URL/);
  });

  it('throws when APP_URL is missing', () => {
    const env = { ...VALID };
    delete env.APP_URL;
    expect(() => validateEnv(env)).toThrow(/APP_URL/);
  });

  it('throws when JWT secrets are .env.example placeholders', () => {
    expect(() => validateEnv({
      ...VALID,
      JWT_SECRET: 'your-jwt-secret-at-least-32-characters',
    })).toThrow(/placeholder/);
  });

  it('throws when RESEND_WEBHOOK_SECRET is missing in production', () => {
    expect(() => validateEnv({
      ...VALID,
      NODE_ENV: 'production',
    })).toThrow(/RESEND_WEBHOOK_SECRET/);
  });

  it('allows a missing webhook secret outside production', () => {
    expect(() => validateEnv({ ...VALID, NODE_ENV: 'development' })).not.toThrow();
  });
});
