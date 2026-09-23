const { Client } = require('pg');

// Stable int8 keys for pg_try_advisory_lock. Held on a dedicated connection so
// Prisma's pool cannot unlock (or re-acquire) from a different session.
const LOCK_KEYS = {
  expiration: 730301,
  chase: 730302,
  tokenRefresh: 730303,
  weeklySummary: 730304,
};

async function withAdvisoryLock(lockKey, fn) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for cron advisory locks');
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const res = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [lockKey]);
    const acquired = Boolean(res.rows[0] && res.rows[0].locked);
    if (!acquired) {
      return { acquired: false, result: null };
    }
    try {
      const result = await fn();
      return { acquired: true, result };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockKey]).catch(() => {});
    }
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = { withAdvisoryLock, LOCK_KEYS };
