const { initSentry, isSentryEnabled, scrubSentryEvent, sentryRelease } = require('../src/lib/sentry');

describe('A6-01 Sentry init', () => {
  const prevInit = global.__PROOF_SENTRY_INIT;

  afterEach(() => {
    global.__PROOF_SENTRY_INIT = prevInit;
  });

  it('does not initialize when SENTRY_DSN is missing (app still boots)', () => {
    expect(isSentryEnabled({})).toBe(false);
    expect(initSentry({})).toBe(false);
    expect(() => require('../src/app')).not.toThrow();
  });

  it('tags release from SENTRY_RELEASE or CI SHA', () => {
    expect(sentryRelease({ SENTRY_RELEASE: 'proof@1.2.3' })).toBe('proof@1.2.3');
    expect(sentryRelease({ GITHUB_SHA: 'abc123' })).toBe('abc123');
    expect(sentryRelease({})).toBeUndefined();
  });

  it('scrubs emails, tokens, and auth headers before send', () => {
    const event = scrubSentryEvent({
      message: 'failed for owner@proof.test',
      user: { email: 'owner@proof.test', ip_address: '1.2.3.4', id: 'u1' },
      request: {
        headers: {
          authorization: 'Bearer secret-token',
          cookie: 'sid=abc',
          'content-type': 'application/json',
        },
        cookies: { sid: 'abc' },
        data: { email: 'owner@proof.test', name: 'Ada' },
      },
      extra: { token: 'abc', note: 'ping ada@example.com' },
    });

    expect(event.user.email).toBeUndefined();
    expect(event.user.ip_address).toBeUndefined();
    expect(event.user.id).toBe('u1');
    expect(event.request.headers.authorization).toBeUndefined();
    expect(event.request.headers.cookie).toBeUndefined();
    expect(event.request.headers['content-type']).toBe('application/json');
    expect(event.request.cookies).toEqual({});
    expect(event.request.data.email).toBe('[redacted]');
    expect(event.request.data.name).toBe('Ada');
    expect(event.message).toBe('failed for [email]');
    expect(event.extra.token).toBe('[redacted]');
    expect(event.extra.note).toBe('ping [email]');
  });
});
