const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../lib/prisma');
const { uploadFile, getSignedUrl } = require('../services/storage');
const { extractCoiData } = require('../services/coiExtractor');
const { updateVendorStatus } = require('../services/compliance');

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

// Fetch the raw bytes for an attachment. Resend may give us either a base64
// `content` payload, a temporary signed `url`, or a few other field names —
// handle the common shapes.
async function materializeAttachment(att) {
  const filename = att.filename || att.name || `attachment-${uuidv4()}`;
  const mimetype = att.contentType || att.content_type || att.type || 'application/octet-stream';
  let buf;
  if (att.content) {
    buf = typeof att.content === 'string'
      ? Buffer.from(att.content, 'base64')
      : Buffer.from(att.content);
  } else if (att.data) {
    buf = typeof att.data === 'string'
      ? Buffer.from(att.data, 'base64')
      : Buffer.from(att.data);
  } else if (att.url) {
    const res = await fetch(att.url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  } else {
    throw new Error('attachment has neither content nor url');
  }
  return { buf, mimetype, filename };
}

// Decide whether AI-extracted data looks like real insurance content vs. an
// extractor that ran but found nothing useful (e.g. a non-COI PDF).
function looksLikeCoi(extracted) {
  if (!extracted) return false;
  return Boolean(
    extracted.glPolicyNumber || extracted.wcPolicyNumber ||
    extracted.umbPolicyNumber || extracted.autoPolicyNumber ||
    extracted.glExpirationDate || extracted.wcExpirationDate ||
    extracted.insuranceCompany || extracted.coverageType
  );
}

async function processAttachment(att, vendor) {
  const { buf, mimetype, filename } = await materializeAttachment(att);
  const isPdf = mimetype === 'application/pdf';
  const isImage = mimetype.startsWith('image/');
  const result = { filename, mimetype, size: buf.length, savedAs: null, coiId: null, classified: 'other' };

  if (!isPdf && !isImage) {
    console.log(`[Webhook] Attachment ${filename} (${mimetype}) is not a PDF/image; skipping storage`);
    return result;
  }

  const key = `${uuidv4()}${path.extname(filename) || ''}`;
  result.savedAs = await uploadFile(buf, key, mimetype, 'reply-attachments');

  let extracted = null;
  if (isPdf) {
    try { extracted = await extractCoiData(buf); }
    catch (e) { console.warn(`[Webhook] AI extract failed on ${filename}: ${e.message}`); }
  }

  if (looksLikeCoi(extracted)) {
    const coi = await prisma.coi.create({
      data: {
        vendorId: vendor.id,
        orgId: vendor.orgId,
        pdfPath: result.savedAs,
        status: 'PENDING_REVIEW',
        aiExtractedData: extracted,
        submittedAt: new Date(),
        glPolicyNumber:   extracted.glPolicyNumber || null,
        glCoverageAmount: extracted.glCoverageAmount || null,
        glExpirationDate: extracted.glExpirationDate ? new Date(extracted.glExpirationDate) : null,
        wcPolicyNumber:   extracted.wcPolicyNumber || null,
        wcCoverageAmount: extracted.wcCoverageAmount || null,
        wcExpirationDate: extracted.wcExpirationDate ? new Date(extracted.wcExpirationDate) : null,
        umbPolicyNumber:   extracted.umbPolicyNumber || null,
        umbCoverageAmount: extracted.umbCoverageAmount || null,
        umbExpirationDate: extracted.umbExpirationDate ? new Date(extracted.umbExpirationDate) : null,
        autoPolicyNumber:   extracted.autoPolicyNumber || null,
        autoCoverageAmount: extracted.autoCoverageAmount || null,
        autoExpirationDate: extracted.autoExpirationDate ? new Date(extracted.autoExpirationDate) : null,
        coverageType:    extracted.coverageType || null,
        agentName:       extracted.agentName || null,
        agentEmail:      extracted.agentEmail || null,
        agentPhone:      extracted.agentPhone || null,
        insuranceCompany: extracted.insuranceCompany || null,
        certificateHolderName:    extracted.certificateHolderName || null,
        certificateHolderAddress: extracted.certificateHolderAddress || null,
      },
    });
    await updateVendorStatus(prisma, vendor.id, vendor.orgId);
    result.coiId = coi.id;
    result.classified = 'coi';
    console.log(`[Webhook] COI auto-created from reply attachment ${filename} for vendor ${vendor.name} -> coi ${coi.id}`);
  } else if (isImage) {
    // Photos of COIs are common but we can't extract from them yet — surface
    // as "image" so admin can decide.
    result.classified = 'image';
    console.log(`[Webhook] Image attachment saved (not auto-classified) for vendor ${vendor.name}: ${filename}`);
  } else {
    result.classified = 'pdf';
    console.log(`[Webhook] PDF attachment saved (no insurance data found) for vendor ${vendor.name}: ${filename}`);
  }
  return result;
}

// POST /api/webhooks/resend-inbound — inbound reply payload from Resend.
router.post('/resend-inbound', async (req, res) => {
  try {
    if (process.env.RESEND_WEBHOOK_SECRET && !verifySvixSignature(req, process.env.RESEND_WEBHOOK_SECRET)) {
      console.warn('[Webhook] Resend signature verification FAILED');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { type, data } = req.body || {};

    // Log every payload that reaches us so we can see what Resend is actually
    // sending. Useful while wiring up the integration.
    console.log(`[Webhook] Resend payload received: type=${type || '(none)'} keys=${Object.keys(data || {}).join(',')}`);

    // Accept anything that looks like inbound mail. Resend's event taxonomy
    // has shifted a few times; rather than maintain an allowlist, treat any
    // event carrying a from-address as inbound.
    const fromCandidate = data?.from?.email || data?.from || data?.envelope?.from || data?.headers?.from || null;
    if (!fromCandidate) {
      console.log(`[Webhook] No from address on payload; skipping (this is normal for outbound delivery events)`);
      return res.json({ received: true, skipped: type });
    }

    const fromEmail = (typeof fromCandidate === 'string' ? fromCandidate : fromCandidate?.email || '')
      .toLowerCase()
      .trim()
      // strip "Name <addr@domain>" wrapper if present
      .replace(/^.*<([^>]+)>.*$/, '$1');

    const subject = data?.subject || data?.headers?.subject || null;
    const body = (data?.text || data?.html || data?.body || data?.snippet || '').toString();

    if (!fromEmail) {
      console.warn('[Webhook] Could not parse from address; payload:', JSON.stringify(req.body).slice(0, 500));
      return res.json({ received: true });
    }

    const attachments = (data?.attachments || data?.files || []).filter(Boolean);

    const matches = await prisma.vendor.findMany({
      where: { email: fromEmail, deletedAt: null },
      select: { id: true, orgId: true, name: true },
    });

    if (matches.length === 0) {
      console.log(`[Webhook] No matching vendor for "${fromEmail}" (subject: ${subject || '(none)'}, attachments: ${attachments.length})`);
    } else {
      for (const v of matches) {
        const processed = [];
        for (const att of attachments) {
          try {
            processed.push(await processAttachment(att, v));
          } catch (err) {
            console.error(`[Webhook] Failed to process attachment ${att?.filename || '(unknown)'}: ${err.message}`);
            processed.push({ filename: att?.filename || null, error: err.message });
          }
        }

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
              attachments: processed,
            },
          },
        });
        console.log(`[Webhook] Reply recorded: ${fromEmail} -> vendor ${v.id} (${v.name}); attachments=${processed.length}`);
      }
    }

    res.json({ received: true, matched: matches.length, attachments: attachments.length });
  } catch (err) {
    console.error('[Webhook] Inbound handler error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
