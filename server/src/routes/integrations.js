const express = require('express');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { authenticate, authorize } = require('../middleware/auth');
const { generateToken, hashToken, tokenPrefix } = require('../lib/apiTokens');
const { ALL_SCOPES } = require('../middleware/apiAuth');
const { EVENTS } = require('../services/webhookDispatcher');
const { logAudit } = require('../services/audit');

const router = express.Router();

// All integration management is ADMIN-only. Tokens and webhooks created here are
// scoped to the admin's own org — never all-orgs (that stays a CLI/operator
// action so an org admin can't grant access to other orgs' data).
router.use(authenticate, authorize('ADMIN'));

const KNOWN_EVENTS = Object.values(EVENTS);

// Never expose the token hash or the webhook secret after creation.
function publicClient(c) {
  return {
    id: c.id,
    name: c.name,
    tokenPrefix: c.tokenPrefix,
    scopes: c.scopes,
    lastUsedAt: c.lastUsedAt,
    revokedAt: c.revokedAt,
    createdAt: c.createdAt,
  };
}

function publicEndpoint(e) {
  return {
    id: e.id,
    name: e.name,
    url: e.url,
    events: e.events,
    active: e.active,
    lastDeliveryAt: e.lastDeliveryAt,
    lastDeliveryStatus: e.lastDeliveryStatus,
    createdAt: e.createdAt,
  };
}

// ===================== API keys =====================

// GET /api/integrations/api-keys
router.get('/api-keys', async (req, res) => {
  try {
    const clients = await prisma.apiClient.findMany({
      where: { orgId: req.user.orgId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(clients.map(publicClient));
  } catch (err) {
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

// POST /api/integrations/api-keys — returns the raw token ONCE.
router.post('/api-keys', async (req, res) => {
  try {
    const { name, scopes } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    let finalScopes = ALL_SCOPES;
    if (Array.isArray(scopes) && scopes.length) {
      const invalid = scopes.filter((s) => !ALL_SCOPES.includes(s));
      if (invalid.length) {
        return res.status(400).json({ error: `Unknown scope(s): ${invalid.join(', ')}` });
      }
      finalScopes = scopes;
    }

    const token = generateToken('live');
    const client = await prisma.apiClient.create({
      data: {
        name: name.trim(),
        tokenHash: hashToken(token),
        tokenPrefix: tokenPrefix(token),
        scopes: finalScopes,
        orgId: req.user.orgId,
        allOrgs: false,
      },
    });

    logAudit({ orgId: req.user.orgId, userId: req.user.id, action: 'create', entity: 'api_client', entityId: client.id, details: { name: client.name }, ipAddress: req.ip });

    // The raw token is shown once; only its hash is stored.
    res.status(201).json({ token, client: publicClient(client) });
  } catch (err) {
    console.error('Create API key error:', err);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// DELETE /api/integrations/api-keys/:id — revoke (immediately stops working,
// kept in the list as revoked for the audit trail).
router.delete('/api-keys/:id', async (req, res) => {
  try {
    const client = await prisma.apiClient.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId },
    });
    if (!client) return res.status(404).json({ error: 'API key not found' });

    const updated = await prisma.apiClient.update({
      where: { id: client.id },
      data: { revokedAt: client.revokedAt || new Date() },
    });
    logAudit({ orgId: req.user.orgId, userId: req.user.id, action: 'revoke', entity: 'api_client', entityId: client.id, ipAddress: req.ip });
    res.json(publicClient(updated));
  } catch (err) {
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

// ===================== Webhooks =====================

// GET /api/integrations/webhooks
router.get('/webhooks', async (req, res) => {
  try {
    const eps = await prisma.webhookEndpoint.findMany({
      where: { orgId: req.user.orgId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(eps.map(publicEndpoint));
  } catch (err) {
    res.status(500).json({ error: 'Failed to list webhooks' });
  }
});

// POST /api/integrations/webhooks — returns the signing secret ONCE.
router.post('/webhooks', async (req, res) => {
  try {
    const { name, url, events } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!url || typeof url !== 'string' || !/^https?:\/\/.+/i.test(url)) {
      return res.status(400).json({ error: 'A valid http(s) URL is required' });
    }

    let finalEvents = [EVENTS.COI_UPDATED];
    if (Array.isArray(events) && events.length) {
      const invalid = events.filter((e) => !KNOWN_EVENTS.includes(e));
      if (invalid.length) {
        return res.status(400).json({ error: `Unknown event(s): ${invalid.join(', ')}` });
      }
      finalEvents = events;
    }

    const secret = `whsec_${crypto.randomBytes(24).toString('base64url')}`;
    const endpoint = await prisma.webhookEndpoint.create({
      data: { name: name.trim(), url, secret, events: finalEvents, orgId: req.user.orgId, allOrgs: false },
    });

    logAudit({ orgId: req.user.orgId, userId: req.user.id, action: 'create', entity: 'webhook_endpoint', entityId: endpoint.id, details: { name: endpoint.name, url }, ipAddress: req.ip });

    res.status(201).json({ secret, endpoint: publicEndpoint(endpoint) });
  } catch (err) {
    console.error('Create webhook error:', err);
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

// PUT /api/integrations/webhooks/:id — enable/disable.
router.put('/webhooks/:id', async (req, res) => {
  try {
    const ep = await prisma.webhookEndpoint.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId },
    });
    if (!ep) return res.status(404).json({ error: 'Webhook not found' });

    const data = {};
    if (typeof req.body?.active === 'boolean') data.active = req.body.active;

    const updated = await prisma.webhookEndpoint.update({ where: { id: ep.id }, data });
    res.json(publicEndpoint(updated));
  } catch (err) {
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

// DELETE /api/integrations/webhooks/:id
router.delete('/webhooks/:id', async (req, res) => {
  try {
    const ep = await prisma.webhookEndpoint.findFirst({
      where: { id: req.params.id, orgId: req.user.orgId },
    });
    if (!ep) return res.status(404).json({ error: 'Webhook not found' });

    await prisma.webhookEndpoint.delete({ where: { id: ep.id } });
    logAudit({ orgId: req.user.orgId, userId: req.user.id, action: 'delete', entity: 'webhook_endpoint', entityId: ep.id, ipAddress: req.ip });
    res.json({ message: 'Webhook deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

module.exports = router;
