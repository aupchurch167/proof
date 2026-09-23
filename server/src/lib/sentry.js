const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SENSITIVE_KEY = /email|password|token|authorization|cookie|secret|ssn|phone/i;

function redactValue(value) {
  if (typeof value === 'string') return value.replace(EMAIL_RE, '[email]');
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redactValue(nested);
    }
    return out;
  }
  return value;
}

function scrubSentryEvent(event) {
  if (!event || typeof event !== 'object') return event;

  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
    delete event.user.username;
    delete event.user.ipAddress;
  }

  if (event.request) {
    if (event.request.headers) {
      const headers = { ...event.request.headers };
      for (const name of Object.keys(headers)) {
        if (/^(authorization|cookie|x-api-key|x-proof-signature)$/i.test(name)) {
          delete headers[name];
        }
      }
      event.request.headers = headers;
    }
    if (event.request.cookies) event.request.cookies = {};
    if (event.request.data) event.request.data = redactValue(event.request.data);
    if (typeof event.request.query_string === 'string') {
      event.request.query_string = redactValue(event.request.query_string);
    }
  }

  if (typeof event.message === 'string') event.message = redactValue(event.message);
  if (event.extra) event.extra = redactValue(event.extra);
  if (event.contexts) event.contexts = redactValue(event.contexts);
  return event;
}

function sentryRelease(env = process.env) {
  return env.SENTRY_RELEASE || env.RAILWAY_GIT_COMMIT_SHA || env.GITHUB_SHA || undefined;
}

function isSentryEnabled(env = process.env) {
  return Boolean(env.SENTRY_DSN);
}

function initSentry(env = process.env) {
  if (!isSentryEnabled(env)) return false;
  if (global.__PROOF_SENTRY_INIT) return true;

  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || 'development',
    release: sentryRelease(env),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      return scrubSentryEvent(event);
    },
  });
  global.__PROOF_SENTRY_INIT = true;
  return true;
}

function attachSentry(app) {
  if (!initSentry()) return false;
  const Sentry = require('@sentry/node');
  Sentry.setupExpressErrorHandler(app);
  return true;
}

module.exports = {
  EMAIL_RE,
  redactValue,
  scrubSentryEvent,
  sentryRelease,
  isSentryEnabled,
  initSentry,
  attachSentry,
};
