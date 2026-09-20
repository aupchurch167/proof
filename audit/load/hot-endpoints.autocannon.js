#!/usr/bin/env node
/**
 * Sequential autocannon against the five hottest session endpoints.
 *   TOKEN, BASE (default http://localhost:4000)
 */
const autocannon = require('autocannon');

const BASE = process.env.BASE || 'http://localhost:4000';
const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error('Set TOKEN to a Bearer access token (from POST /api/auth/login).');
  process.exit(1);
}

const endpoints = [
  '/api/auth/me',
  '/api/vendors',
  '/api/compliance/overview',
  '/api/cois',
  '/api/reminders/upcoming',
];

async function run(url) {
  const result = await autocannon({
    url,
    connections: 10,
    duration: 20,
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  console.log('\n==', url, '==');
  console.log(autocannon.printResult(result));
}

(async () => {
  for (const path of endpoints) {
    await run(`${BASE}${path}`);
  }
})();
