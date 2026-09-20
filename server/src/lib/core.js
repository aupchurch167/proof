/**
 * Helm Core API client.
 *
 * Mirrors vendors only when HELM_CORE_INTEGRATION=true AND the vendor's Proof
 * org is in CORE_ORG_MAP (or, if that map is unset, the org slug equals
 * CORE_ORG_SLUG). Never fan every tenant into a single Core slug.
 *
 * Non-production still uses Core's x-helm-test-* bypass headers. Production
 * requires CORE_API_TOKEN and never sends those headers.
 */

const prisma = require('./prisma');
const { fetchWithTimeout } = require('./fetchWithTimeout');

const CORE_BASE_URL = () => process.env.CORE_API_URL || 'https://helmcore.up.railway.app';
const CORE_ORG_SLUG = () => process.env.CORE_ORG_SLUG;
const CORE_DEV_USER_ID = () => process.env.CORE_DEV_USER_ID;

const isEnabled = () => process.env.HELM_CORE_INTEGRATION === 'true';

function parseCoreOrgMap() {
  const raw = process.env.CORE_ORG_MAP;
  if (!raw || !String(raw).trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.error('[Core] CORE_ORG_MAP must be a JSON object');
      return {};
    }
    return parsed;
  } catch {
    console.error('[Core] CORE_ORG_MAP is invalid JSON');
    return {};
  }
}

async function resolveMappedCoreSlug(vendor) {
  if (!vendor?.orgId) return null;
  const org = vendor.organization && (vendor.organization.id || vendor.organization.slug)
    ? vendor.organization
    : await prisma.organization.findUnique({
      where: { id: vendor.orgId },
      select: { id: true, slug: true },
    });
  if (!org) return null;

  const map = parseCoreOrgMap();
  if (map) {
    return map[org.id] || (org.slug ? map[org.slug] : null) || null;
  }

  const allowed = CORE_ORG_SLUG();
  if (allowed && org.slug && org.slug === allowed) return allowed;
  return null;
}

async function shouldMirror(vendor) {
  if (!isEnabled()) return false;
  return Boolean(await resolveMappedCoreSlug(vendor));
}

function buildHeaders(coreSlug) {
  if (process.env.NODE_ENV === 'production') {
    const token = process.env.CORE_API_TOKEN;
    if (!token) {
      throw new Error('Core integration enabled in production but CORE_API_TOKEN is not set');
    }
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    };
  }

  const userId = CORE_DEV_USER_ID();
  const slug = coreSlug || CORE_ORG_SLUG();
  if (!userId || !slug) {
    throw new Error('Core integration enabled but CORE_DEV_USER_ID or CORE_ORG_SLUG is not set');
  }
  return {
    'content-type': 'application/json',
    'x-helm-test-user-id': userId,
    'x-helm-test-org-slug': slug,
  };
}

async function coreFetch(method, path, body, coreSlug) {
  const url = `${CORE_BASE_URL()}${path}`;
  const res = await fetchWithTimeout(url, {
    method,
    headers: buildHeaders(coreSlug),
    body: body ? JSON.stringify(body) : undefined,
  }, 5000);

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
  const slug = await resolveMappedCoreSlug(vendor);
  if (!slug) return null;
  return coreFetch('POST', `/api/v1/orgs/${slug}/vendors`, vendorToCorePayload(vendor), slug);
}

async function updateVendor(coreId, partial, vendor) {
  if (!isEnabled()) return null;
  if (vendor) {
    const slug = await resolveMappedCoreSlug(vendor);
    if (!slug) return null;
    return coreFetch('PATCH', `/api/v1/orgs/${slug}/vendors/${coreId}`, partial, slug);
  }
  const slug = CORE_ORG_SLUG();
  if (!slug) return null;
  return coreFetch('PATCH', `/api/v1/orgs/${slug}/vendors/${coreId}`, partial, slug);
}

async function listVendors() {
  if (!isEnabled()) return null;
  const slug = CORE_ORG_SLUG();
  if (!slug) return null;
  return coreFetch('GET', `/api/v1/orgs/${slug}/vendors`, undefined, slug);
}

// Format a Core API error for logs. Core returns { error: { code, message } }.
function formatError(err) {
  const code = err.body && err.body.error && err.body.error.code;
  const msg = (err.body && err.body.error && err.body.error.message) || err.message;
  return `${err.status || ''} ${code || ''} ${msg}`.trim();
}

module.exports = {
  isEnabled,
  shouldMirror,
  resolveMappedCoreSlug,
  createVendor,
  updateVendor,
  listVendors,
  vendorToCorePayload,
  mapComplianceStatus,
  formatError,
};
