require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');

const authRoutes = require('./routes/auth');
const settingsRoutes = require('./routes/settings');
const usersRoutes = require('./routes/users');
const vendorsRoutes = require('./routes/vendors');
const coisRoutes = require('./routes/cois');
const portalRoutes = require('./routes/portal');
const reportsRoutes = require('./routes/reports');
const notificationsRoutes = require('./routes/notifications');
const organizationRoutes = require('./routes/organization');
const importRoutes = require('./routes/import');
const applyRoutes = require('./routes/apply');
const webhookRoutes = require('./routes/webhooks');
const repliesRoutes = require('./routes/replies');

const app = express();

app.set('trust proxy', 1);
// Allow Google Identity Services (the "Sign in with Google" button) to load when
// the SPA is served through this API. Extends helmet's defaults rather than
// replacing them so the rest of the CSP hardening stays intact.
const gsi = 'https://accounts.google.com/gsi/';
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", `${gsi}client`],
        'connect-src': ["'self'", gsi],
        'frame-src': ["'self'", gsi],
        'style-src': ["'self'", "'unsafe-inline'", `${gsi}style`],
      },
    },
  })
);
const allowedOrigins = [
  'https://app.proofcoi.com',
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

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);
app.use('/api/auth/google', authLimiter);
app.use('/api/auth/accept-invite', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
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
app.use('/api/notifications', notificationsRoutes);
app.use('/api/organization', organizationRoutes);
app.use('/api/import', importRoutes);
app.use('/api/apply', applyRoutes);
app.use('/api/replies', repliesRoutes);

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
