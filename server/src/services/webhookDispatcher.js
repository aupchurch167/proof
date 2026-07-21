const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { mapCoiStatus, earliestExpiration } = require('../http/serializers');

// Outbound webhook events Proof emits. Consumers subscribe per endpoint.
const EVENTS = {
  COI_UPDATED: 'coi.updated',
};

const DELIVERY_TIMEOUT_MS = 5000;

// Signature over the exact raw JSON body, so the receiver verifies against the
// bytes it received. Sent as `X-Proof-Signature: <hex hmac-sha256>`.
function sign(secret, rawBody) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

async function deliver(endpoint, rawBody, event) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  let status;
  try {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-proof-event': event,
        'x-proof-signature': sign(endpoint.secret, rawBody),
      },
      body: rawBody,
      signal: controller.signal,
    });
    status = res.ok ? 'success' : `failed:${res.status}`;
    if (!res.ok) console.warn(`[Webhook] ${event} -> ${endpoint.url} returned ${res.status}`);
  } catch (err) {
    status = `failed:${err.name === 'AbortError' ? 'timeout' : 'network'}`;
    console.warn(`[Webhook] ${event} -> ${endpoint.url} failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  await prisma.webhookEndpoint
    .update({ where: { id: endpoint.id }, data: { lastDeliveryAt: new Date(), lastDeliveryStatus: status } })
    .catch(() => {});
  return status;
}

// Fan a payload out to every active endpoint in this org (or an all-orgs
// endpoint) that is subscribed to `event`. Returns the number dispatched.
async function dispatch(event, orgId, buildPayload) {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: {
      active: true,
      events: { has: event },
      OR: [{ orgId }, { allOrgs: true }],
    },
  });
  if (endpoints.length === 0) return 0;

  const payload = await buildPayload();
  const rawBody = JSON.stringify(payload);

  // Deliver concurrently; never let one endpoint block another.
  await Promise.allSettled(endpoints.map((ep) => deliver(ep, rawBody, event)));
  return endpoints.length;
}

/**
 * Emit `coi.updated` for a vendor. Best-effort: callers should not await this on
 * a critical path, and it swallows its own errors.
 */
async function emitCoiUpdated({ orgId, vendorId, coiStatus, latestApprovedCoi }) {
  try {
    return await dispatch(EVENTS.COI_UPDATED, orgId, async () => {
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { slug: true, id: true },
      });
      return {
        event: EVENTS.COI_UPDATED,
        orgSlug: org?.slug || org?.id || orgId,
        vendorId,
        coi: {
          status: mapCoiStatus(coiStatus),
          expiresAt: earliestExpiration(latestApprovedCoi),
        },
        sentAt: new Date().toISOString(),
      };
    });
  } catch (err) {
    console.error('[Webhook] emitCoiUpdated failed:', err.message);
    return 0;
  }
}

module.exports = { EVENTS, sign, dispatch, emitCoiUpdated };
