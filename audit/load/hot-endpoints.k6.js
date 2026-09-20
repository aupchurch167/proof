import http from 'k6/http';
import { check, sleep } from 'k6';

// Hottest session endpoints. Requires a pre-existing user.
//   BASE_URL, PROOF_EMAIL, PROOF_PASSWORD
// Optional: ORG_SLUG + API_TOKEN for the v1 scenario.

export const options = {
  scenarios: {
    session: {
      executor: 'constant-arrival-rate',
      rate: 20,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 20,
      maxVUs: 50,
      exec: 'sessionMix',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:me}': ['p(95)<300'],
    'http_req_duration{name:vendors}': ['p(95)<1000'],
    'http_req_duration{name:overview}': ['p(95)<1000'],
    'http_req_duration{name:cois}': ['p(95)<1000'],
    'http_req_duration{name:reminders}': ['p(95)<1500'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:4000';

export function setup() {
  const res = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ email: __ENV.PROOF_EMAIL, password: __ENV.PROOF_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  if (res.status !== 200) {
    throw new Error(`login failed: ${res.status} ${res.body}`);
  }
  const body = res.json();
  return { token: body.accessToken };
}

export function sessionMix(data) {
  const headers = { Authorization: `Bearer ${data.token}` };
  const calls = [
    ['me', 'GET', '/api/auth/me'],
    ['vendors', 'GET', '/api/vendors'],
    ['overview', 'GET', '/api/compliance/overview'],
    ['cois', 'GET', '/api/cois'],
    ['reminders', 'GET', '/api/reminders/upcoming'],
  ];
  const [name, method, path] = calls[Math.floor(Math.random() * calls.length)];
  const res = http.request(method, `${BASE}${path}`, null, {
    headers,
    tags: { name },
  });
  check(res, { 'status 200': (r) => r.status === 200 });
  sleep(0.05);
}
