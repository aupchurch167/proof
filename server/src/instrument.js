// Load before other app modules when a DSN is present so Sentry can patch
// HTTP / Express. Safe no-op when SENTRY_DSN is unset — the process still boots.
require('./lib/sentry').initSentry();
