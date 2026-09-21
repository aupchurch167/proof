import * as Sentry from '@sentry/react';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function redact(value) {
  if (typeof value === 'string') return value.replace(EMAIL_RE, '[email]');
  return value;
}

const dsn = import.meta.env.VITE_SENTRY_DSN;

export function initClientSentry() {
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
        delete event.user.username;
      }
      if (typeof event.message === 'string') event.message = redact(event.message);
      return event;
    },
  });
  return true;
}

export { Sentry, dsn as sentryDsn };
