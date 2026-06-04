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

// Resend's inbound payload shape isn't 100% predictable across event types
// and versions. Pull the body from any text/html-looking field at any depth.
function extractBody(data) {
  if (!data || typeof data !== 'object') return '';
  const seen = new WeakSet();
  const bodyKeys = new Set(['text', 'html', 'body', 'plain', 'plainText', 'plain_text', 'htmlBody', 'html_body', 'bodyText', 'snippet', 'message']);
  function walk(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 5 || seen.has(obj)) return null;
    seen.add(obj);
    for (const k of bodyKeys) {
      if (typeof obj[k] === 'string' && obj[k].trim()) return obj[k];
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') {
        const found = walk(v, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(data, 0) || '';
}

// Best-effort mimetype: trust the claimed type when reasonable, otherwise fall
// back to the filename extension. Resend sometimes labels attachments as
// application/octet-stream or omits the type entirely.
function detectMimetype(att) {
  const claimed = (att.contentType || att.content_type || att.type || att.mimetype || '').toLowerCase().split(';')[0].trim();
  if (claimed && claimed !== 'application/octet-stream') return claimed;
  const filename = (att.filename || att.name || '').toLowerCase();
  const ext = filename.split('.').pop();
  const byExt = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png',
    heic: 'image/heic', heif: 'image/heif',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
    txt: 'text/plain',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return byExt[ext] || claimed || 'application/octet-stream';
}

// Fetch the raw bytes for an attachment. Resend may give us either a base64
// `content` payload, a temporary signed `url`, or a few other field names —
// handle the common shapes.
async function materializeAttachment(att) {
  const filename = att.filename || att.name || `attachment-${uuidv4()}`;
  const mimetype = detectMimetype(att);
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

  // Always save the attachment so it's at least downloadable from the UI. AI
  // extraction is gated to PDFs further down.
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

// POST /api/webhooks/resend-inbound — generic Resend webhook endpoint.
// Subscribe email.received (inbound replies), email.bounced, email.failed.
router.post('/resend-inbound', async (req, res) => {
  try {
    if (process.env.RESEND_WEBHOOK_SECRET && !verifySvixSignature(req, process.env.RESEND_WEBHOOK_SECRET)) {
      console.warn('[Webhook] Resend signature verification FAILED');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { type, data } = req.body || {};
    console.log(`[Webhook] Resend ${type || '(no type)'} keys=${Object.keys(data || {}).join(',')}`);

    if (type === 'email.received' || type === 'email.inbound' || type === 'inbound.email') {
      return handleInbound(req, res, data);
    }
    if (type === 'email.bounced' || type === 'email.failed' || type === 'email.complained') {
      return handleFailure(req, res, type, data);
    }

    // Other event types (delivered, sent, opened, clicked, etc.). Ack so
    // Resend doesn't retry, but otherwise ignore.
    return res.json({ received: true, skipped: type });
  } catch (err) {
    console.error('[Webhook] Inbound handler error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

async function handleInbound(req, res, data) {
  const fromCandidate = data?.from?.email || data?.from || data?.envelope?.from || data?.headers?.from || data?.sender?.email || data?.sender || null;
  if (!fromCandidate) {
    console.warn('[Webhook] email.received but no from address; payload preview:', JSON.stringify(data).slice(0, 600));
    return res.json({ received: true });
  }

  const fromEmail = (typeof fromCandidate === 'string' ? fromCandidate : fromCandidate?.email || '')
    .toLowerCase()
    .trim()
    .replace(/^.*<([^>]+)>.*$/, '$1');

  const subject = data?.subject || data?.headers?.subject || data?.email?.subject || null;
  const body = extractBody(data);
  const attachments = (data?.attachments || data?.files || data?.email?.attachments || []).filter(Boolean);

  console.log(`[Webhook] inbound from=${fromEmail} subject="${subject || ''}" bodyLen=${body.length} attachments=${attachments.length}`);
  if (body.length === 0) {
    // Help debug Resend's payload shape when extractBody can't find a body.
    console.log('[Webhook] inbound payload (truncated):', JSON.stringify(data).slice(0, 1500));
  }

  const matches = await prisma.vendor.findMany({
    where: { email: fromEmail, deletedAt: null },
    select: { id: true, orgId: true, name: true },
  });

  if (matches.length === 0) {
    console.log(`[Webhook] No matching vendor for "${fromEmail}"`);
    return res.json({ received: true, matched: 0, attachments: attachments.length });
  }

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
  res.json({ received: true, matched: matches.length, attachments: attachments.length });
}

async function handleFailure(req, res, type, data) {
  // Resend bounce/fail payloads carry the failed recipient and the original
  // email_id. We can't always reconnect to a specific NotificationLog row, but
  // we can mark the most recent SENT entry to that recipient as FAILED and
  // record the reason in an audit row so admins can see what happened.
  const to = data?.to?.[0] || data?.to || data?.email?.to?.[0] || data?.email?.to || null;
  const recipient = (Array.isArray(to) ? to[0] : to || '').toString().toLowerCase().trim().replace(/^.*<([^>]+)>.*$/, '$1');
  const reason = data?.reason || data?.bounce?.message || data?.error || data?.bounceType || type;

  console.log(`[Webhook] delivery failure (${type}) to=${recipient || '(unknown)'} reason="${reason || ''}"`);

  if (!recipient) return res.json({ received: true });

  // Update the most recent SENT NotificationLog for this recipient (within the
  // last 7 days) to FAILED.
  const recent = await prisma.notificationLog.findFirst({
    where: {
      recipientEmail: recipient,
      status: 'SENT',
      sentAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { sentAt: 'desc' },
    include: { vendor: { select: { id: true, orgId: true, name: true } } },
  });

  if (recent) {
    await prisma.notificationLog.update({
      where: { id: recent.id },
      data: { status: 'FAILED' },
    });
    if (recent.vendor) {
      await prisma.auditLog.create({
        data: {
          orgId: recent.vendor.orgId,
          action: 'vendor_email_failed',
          entity: 'vendor',
          entityId: recent.vendor.id,
          details: { type, recipient, reason, notificationLogId: recent.id, receivedAt: new Date().toISOString() },
        },
      });
      console.log(`[Webhook] Marked NotificationLog ${recent.id} FAILED (vendor ${recent.vendor.name})`);
    }
  } else {
    console.log(`[Webhook] No recent SENT NotificationLog found for ${recipient}`);
  }

  res.json({ received: true });
}

module.exports = router;
