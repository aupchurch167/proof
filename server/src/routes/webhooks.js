const express = require('express');
const crypto = require('crypto');
const prisma = require('../lib/prisma');

const router = express.Router();

// Resend signs inbound webhook requests with Svix. The Svix-Signature header
// contains one or more "v1,<base64-hmac>" entries computed as
// HMAC_SHA256(secret, `${svix-id}.${svix-timestamp}.${rawBody}`).
function verifySvixSignature(req, secret) {
  const id = req.header('svix-id');
  const timestamp = req.header('svix-timestamp');
  const signature = req.header('svix-signature');
  if (!id || !timestamp || !signature) return false;

  // Reject requests with a stale timestamp (more than 5 min skew).
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  // The secret arrives prefixed with "whsec_"; strip it before decoding.
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signed = `${id}.${timestamp}.${req.rawBody}`;
  const expected = crypto.createHmac('sha256', key).update(signed).digest('base64');

  return signature.split(' ').some((s) => {
    const [version, sig] = s.split(',');
    if (version !== 'v1' || !sig) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(sig, 'base64'), Buffer.from(expected, 'base64'));
    } catch { return false; }
  });
}

// POST /api/webhooks/resend-inbound — inbound reply payload from Resend.
router.post('/resend-inbound', async (req, res) => {
  try {
    if (process.env.RESEND_WEBHOOK_SECRET && !verifySvixSignature(req, process.env.RESEND_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { type, data } = req.body || {};

    // Resend uses event types like "email.received" or "inbound.email". Accept
    // either; ignore anything else (e.g. delivery events Resend sends here).
    const inboundTypes = ['email.received', 'inbound.email', 'email.inbound'];
    if (!inboundTypes.includes(type)) {
      return res.json({ received: true, skipped: type });
    }

    const fromEmail = (data?.from?.email || (typeof data?.from === 'string' ? data.from : '') || '').toLowerCase().trim();
    const subject = data?.subject || null;
    const body = (data?.text || data?.html || '').toString();

    if (!fromEmail) {
      console.warn('[Inbound] payload missing from address; ignoring');
      return res.json({ received: true });
    }

    const matches = await prisma.vendor.findMany({
      where: { email: fromEmail, deletedAt: null },
      select: { id: true, orgId: true, name: true },
    });

    if (matches.length === 0) {
      console.log(`[Inbound] No matching vendor for ${fromEmail}: ${subject || '(no subject)'}`);
    } else {
      for (const v of matches) {
        await prisma.auditLog.create({
          data: {
            orgId: v.orgId,
            action: 'vendor_reply',
            entity: 'vendor',
            entityId: v.id,
            details: {
              from: fromEmail,
              subject,
              preview: body.slice(0, 1000),
              receivedAt: new Date().toISOString(),
            },
          },
        });
        console.log(`[Inbound] Reply from ${fromEmail} -> vendor ${v.id} (${v.name})`);
      }
    }

    res.json({ received: true, matched: matches.length });
  } catch (err) {
    console.error('Inbound webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
