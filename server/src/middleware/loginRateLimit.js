const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Login throttling. A normal person logs in and out all day; that must not
// lock them. Only failed attempts count, and the bucket is the account plus
// the network so one office IP cannot lock every coworker, and one person's
// typos cannot lock a different account on that IP.
//
// Three windows, each 15 minutes:
//   10 failures per account per IP. A few typos are fine. A script guessing
//      one password from one network is not.
//   30 failures per account across every IP. Stops a distributed guess of
//      one password, which the per-network cap alone would miss.
//   100 failures per IP across every account. Stops password spraying from
//      one address. Successes are not counted, so a shared office NAT is not
//      locked by people who actually sign in.
const WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ACCOUNT_IP_MAX = 10;
const LOGIN_ACCOUNT_MAX = 30;
const LOGIN_IP_MAX = 100;

const MESSAGE = { error: 'Too many requests, please try again later' };

function loginEmail(req) {
  return String(req.body?.email || '').trim().toLowerCase();
}

function failureLimit(options) {
  return rateLimit({
    windowMs: WINDOW_MS,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: MESSAGE,
    ...options,
  });
}

const loginAccountIpLimiter = failureLimit({
  max: LOGIN_ACCOUNT_IP_MAX,
  keyGenerator: (req) => {
    const email = loginEmail(req);
    const ip = ipKeyGenerator(req.ip);
    return email ? `login:${email}:${ip}` : `login:missing:${ip}`;
  },
});

const loginAccountLimiter = failureLimit({
  max: LOGIN_ACCOUNT_MAX,
  skip: (req) => !loginEmail(req),
  keyGenerator: (req) => `login-account:${loginEmail(req)}`,
});

const loginIpLimiter = failureLimit({
  max: LOGIN_IP_MAX,
  keyGenerator: (req) => `login-ip:${ipKeyGenerator(req.ip)}`,
});

const loginLimiters = [loginAccountIpLimiter, loginAccountLimiter, loginIpLimiter];

module.exports = {
  loginLimiters,
  loginEmail,
  WINDOW_MS,
  LOGIN_ACCOUNT_IP_MAX,
  LOGIN_ACCOUNT_MAX,
  LOGIN_IP_MAX,
};
