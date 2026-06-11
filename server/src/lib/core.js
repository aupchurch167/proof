/**
 * Helm Core API client.
 *
 * Dev-bypass auth: sends x-helm-test-user-id and x-helm-test-org-slug headers
 * on every request. No Bearer token, no API key (Core has not shipped real
 * auth yet).
 *
 * All exported functions are no-ops (resolve null) when HELM_CORE_INTEGRATION
 * is not "true", so callers can mirror unconditionally.
 */

const CORE_BASE_URL = () => process.env.CORE_API_URL || 'https://helmcore.up.railway.app';
const CORE_ORG_SLUG = () => process.env.CORE_ORG_SLUG;
const CORE_DEV_USER_ID = () => process.env.CORE_DEV_USER_ID;

const isEnabled = () => process.env.HELM_CORE_INTEGRATION === 'true';

function buildHeaders() {
  const userId = CORE_DEV_USER_ID();
  const slug = CORE_ORG_SLUG();
  if (!userId || !slug) {
    throw new Error('Core integration enabled but CORE_DEV_USER_ID or CORE_ORG_SLUG is not set');
  }
  return {
    'content-type': 'application/json',
    'x-helm-test-user-id': userId,
    'x-helm-test-org-slug': slug,
  };
}

async function coreFetch(method, path, body) {
  const url = `${CORE_BASE_URL()}${path}`;
  const res = await fetch(url, {
    method,
    headers: buildHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!res.ok) {
    const err = new Error(`Core ${method} ${path} failed: ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

// CoiStatus (local) -> complianceStatus (Core: active|expired|pending)
function mapComplianceStatus(coiStatus) {
  switch (coiStatus) {
    case 'COMPLIANT':
    case 'EXPIRING_SOON':
      return 'active';
    case 'EXPIRED':
    case 'NON_COMPLIANT':
      return 'expired';
    case 'PENDING':
    case 'NO_COI':
    default:
      return 'pending';
  }
}

function vendorToCorePayload(vendor) {
  return {
    companyName: vendor.name,
    email: vendor.email,
    phone: vendor.phone || undefined,
    addressLine1: vendor.address || undefined,
    trade: vendor.trade || undefined,
    additionalEmails: vendor.additionalEmails?.length > 0 ? vendor.additionalEmails : undefined,
    complianceStatus: mapComplianceStatus(vendor.coiStatus),
    status: vendor.deletedAt ? 'inactive' : 'active',
  };
}

async function createVendor(vendor) {
  if (!isEnabled()) return null;
  const slug = CORE_ORG_SLUG();
  return coreFetch('POST', `/api/v1/orgs/${slug}/vendors`, vendorToCorePayload(vendor));
}

async function updateVendor(coreId, partial) {
  if (!isEnabled()) return null;
  const slug = CORE_ORG_SLUG();
  return coreFetch('PATCH', `/api/v1/orgs/${slug}/vendors/${coreId}`, partial);
}

async function listVendors() {
  if (!isEnabled()) return null;
  const slug = CORE_ORG_SLUG();
  return coreFetch('GET', `/api/v1/orgs/${slug}/vendors`);
}

// Format a Core API error for logs. Core returns { error: { code, message } }.
function formatError(err) {
  const code = err.body && err.body.error && err.body.error.code;
  const msg = (err.body && err.body.error && err.body.error.message) || err.message;
  return `${err.status || ''} ${code || ''} ${msg}`.trim();
}

module.exports = {
  isEnabled,
  createVendor,
  updateVendor,
  listVendors,
  vendorToCorePayload,
  mapComplianceStatus,
  formatError,
};
