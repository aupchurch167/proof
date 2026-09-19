const prisma = require('../lib/prisma');
const { hashToken } = require('../lib/apiTokens');
const { errors } = require('../http/respond');

// Scopes a token can hold. `*` is a wildcard granting everything.
const SCOPES = {
  VENDORS_READ: 'vendors:read',
  COI_REQUESTS_READ: 'coi-requests:read',
  COI_REQUESTS_WRITE: 'coi-requests:write',
};
const ALL_SCOPES = Object.values(SCOPES);

function hasScope(client, scope) {
  if (!client) return false;
  if (client.dev) return true; // dev-bypass clients are unrestricted
  const scopes = client.scopes || [];
  return scopes.includes('*') || scopes.includes(scope);
}

// Resolve an org by its slug or, as a fallback, its id — matching how the public
// apply routes resolve orgs (many orgs have no slug set).
function resolveOrg(slugOrId) {
  return prisma.organization.findFirst({
    where: { OR: [{ slug: slugOrId }, { id: slugOrId }] },
    select: { id: true, name: true, slug: true },
  });
}

function bearerToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const value = header.slice(7).trim();
  return value || null;
}

/**
 * Authenticate a service-to-service request and authorize it for the org named
 * in the path. On success attaches `req.apiClient` and `req.org`.
 *
 * Order matters for correct status codes: authenticate (401) -> resolve org
 * (404) -> authorize (403).
 */
async function apiAuth(req, res, next) {
  try {
    const orgSlug = req.params.orgSlug;
    const isDev = process.env.NODE_ENV !== 'production';
    const devHeader = req.headers['x-helm-test-org-slug'];
    const token = bearerToken(req);

    let client;
    if (isDev && devHeader && !token) {
      // Dev-bypass parity with the Core integration: no token required locally.
      client = { dev: true, scopes: ['*'], allOrgs: true };
    } else {
      if (!token) return errors.unauthorized(res);
      client = await prisma.apiClient.findFirst({
        where: { tokenHash: hashToken(token), revokedAt: null },
      });
      if (!client) return errors.unauthorized(res);
    }

    const org = await resolveOrg(orgSlug);
    if (!org) return errors.notFound(res, 'organization_not_found', 'Organization not found');

    if (!client.allOrgs && client.orgId !== org.id) {
      return errors.forbidden(res);
    }

    req.apiClient = client;
    req.org = org;

    // Best-effort last-used stamp; never block the request on it.
    if (client.id) {
      prisma.apiClient
        .update({ where: { id: client.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});
    }

    next();
  } catch (err) {
    console.error('[API v1] auth error:', err);
    return errors.server(res);
  }
}

// Per-route scope guard. Use after apiAuth.
function requireScope(scope) {
  return (req, res, next) => {
    if (!hasScope(req.apiClient, scope)) {
      return errors.forbidden(res, `This token lacks the required scope: ${scope}`);
    }
    next();
  };
}

module.exports = { apiAuth, requireScope, SCOPES, ALL_SCOPES };
