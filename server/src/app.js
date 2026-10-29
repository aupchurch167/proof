require('dotenv').config();
const { attachSentry } = require('./lib/sentry');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { loginLimiters } = require('./middleware/loginRateLimit');
const morgan = require('morgan');
const path = require('path');

const authRoutes = require('./routes/auth');
const settingsRoutes = require('./routes/settings');
const usersRoutes = require('./routes/users');
const vendorsRoutes = require('./routes/vendors');
const coisRoutes = require('./routes/cois');
const portalRoutes = require('./routes/portal');
const reportsRoutes = require('./routes/reports');
const auditRoutes = require('./routes/audit');
const remindersRoutes = require('./routes/reminders');
const requirementsRoutes = require('./routes/requirements');
const complianceRoutes = require('./routes/compliance');
const notificationsRoutes = require('./routes/notifications');
const organizationRoutes = require('./routes/organization');
const importRoutes = require('./routes/import');
const applyRoutes = require('./routes/apply');
const webhookRoutes = require('./routes/webhooks');
const repliesRoutes = require('./routes/replies');
const integrationsRoutes = require('./routes/integrations');
const v1Routes = require('./routes/v1');
const { hashToken } = require('./lib/apiTokens');
const {
  TERMS_VERSION,
  PRIVACY_VERSION,
  TERMS_SECTIONS,
  PRIVACY_SECTIONS,
  wrapLegalPage,
} = require('./legal/documents');

const app = express();

app.set('trust proxy', 1);
// Allow Google Identity Services (the "Sign in with Google" button) to load when
// the SPA is served through this API. Extends helmet's defaults rather than
// replacing them so the rest of the CSP hardening stays intact.
const gsi = 'https://accounts.google.com/gsi/';
const GOOGLE_FONTS_CSS = 'https://fonts.googleapis.com';
const GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com';
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", `${gsi}client`],
        // Browser Sentry (VITE_SENTRY_DSN) posts to ingest hosts when the SPA
        // is served from this origin. Harmless when no DSN is configured.
        'connect-src': [
          "'self'",
          gsi,
          'https://*.ingest.sentry.io',
          'https://*.ingest.us.sentry.io',
          'https://*.sentry.io',
        ],
        'frame-src': ["'self'", gsi],
        // Manrope is the brand typeface; without these two the UI silently
        // falls back to system-ui in production.
        'style-src': ["'self'", "'unsafe-inline'", `${gsi}style`, GOOGLE_FONTS_CSS],
        'font-src': ["'self'", 'data:', GOOGLE_FONTS_FILES],
      },
    },
  })
);
const allowedOrigins = [
  'https://app.proofcoi.com',
  // A4-09: owner-confirmed keep (2026-09-20). Do not remove.
  'https://proof.up.railway.app',
  'http://localhost:5173',
  ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : []),
];
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
// Mount webhook routes BEFORE the standard json parser so we can preserve the
// raw body for Svix signature verification, and BEFORE the rate limiter so
// Resend's retries aren't throttled.
app.use(
  '/api/webhooks',
  express.json({
    limit: '10mb',
    verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
  }),
  webhookRoutes
);

app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate limiting.
// Login has its own failure-only limiters (per account+IP, per account, and
// per IP). The other auth routes stay on a tight per-IP cap that counts every
// request, so signup and password-reset spam stay blocked. Google sign-in
// ignores successes so a person can use the button repeatedly; failed Google
// attempts still stop at 10 per IP per 15 minutes.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

const googleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many requests, please try again later' },
  keyGenerator: (req) => ipKeyGenerator(req.ip),
});

// Session routes are not part of the browsing budget. Login failures are
// already capped above; a successful login, logout, refresh, or /me must not
// consume a limiter that can later reject the next sign-in.
const SESSION_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/auth/me',
  '/api/auth/google',
]);

function originalPath(req) {
  return String(req.originalUrl || req.url || '').split('?')[0];
}

// The previous cap was 100 requests per IP per 15 minutes, and it counted
// every successful call. One sign-in loads the dashboard (usage, compliance,
// overview, the weekly audit) and logout is another call, so a retest plus
// a handful of login/logout cycles crossed 100 and the next login form showed
// "Too many requests". Authenticated calls are keyed by the access token so
// a shared address (or an extra proxy hop) cannot pool everyone's traffic.
// 2000 per 15 minutes is a runaway-client ceiling, not something a person
// working in the app can reach.
const GENERAL_MAX = 2000;

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: GENERAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  skip: (req) => {
    const path = originalPath(req);
    if (path === '/api/v1' || path.startsWith('/api/v1/')) return true;
    return SESSION_PATHS.has(path);
  },
  keyGenerator: (req) => {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      const token = header.slice(7).trim();
      if (token) return `session:${hashToken(token)}`;
    }
    return `ip:${ipKeyGenerator(req.ip)}`;
  },
});

// Service-to-service traffic (one consumer, one IP, many orgs) needs a higher
// ceiling than the browser-facing API, keyed by token rather than IP so one
// noisy client can't starve another.
const apiV1Limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) return `tok:${hashToken(header.slice(7).trim())}`;
    return `ip:${ipKeyGenerator(req.ip)}`;
  },
  message: { error: { code: 'rate_limited', message: 'Too many requests, please try again later', details: {} } },
});

for (const limiter of loginLimiters) {
  app.use('/api/auth/login', limiter);
}
app.use('/api/auth/signup', authLimiter);
app.use('/api/auth/google', googleLimiter);
app.use('/api/auth/accept-invite', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/v1', apiV1Limiter);
app.use('/api', generalLimiter);

// Serve client build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../client/dist')));
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/vendors', vendorsRoutes);
app.use('/api/cois', coisRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/reminders', remindersRoutes);
app.use('/api/requirements', requirementsRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/organization', organizationRoutes);
app.use('/api/import', importRoutes);
app.use('/api/apply', applyRoutes);
app.use('/api/replies', repliesRoutes);
app.use('/api/integrations', integrationsRoutes);

// Versioned, org-scoped public API for service-to-service integrations.
app.use('/api/v1/orgs/:orgSlug', v1Routes);

// Public draft legal pages (A10-01). Served as HTML so /terms and /privacy
// return 200 without the SPA build (tests + crawlers). Counsel swaps the body.
app.get('/terms', (_req, res) => {
  res
    .type('html')
    .send(wrapLegalPage({ title: 'Terms of Service', version: TERMS_VERSION, sections: TERMS_SECTIONS }));
});
app.get('/privacy', (_req, res) => {
  res
    .type('html')
    .send(wrapLegalPage({ title: 'Privacy Policy', version: PRIVACY_VERSION, sections: PRIVACY_SECTIONS }));
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const prisma = require('./lib/prisma');
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// SPA fallback in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
  });
}

// Sentry first (no-op without SENTRY_DSN), then the JSON error body.
attachSentry(app);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message || 'Internal server error',
  });
});

module.exports = app;
