const prisma = require('../lib/prisma');
const { COVERAGE_TYPES } = require('../http/serializers');
const { generateUploadToken } = require('../utils/tokens');
const { sendUploadRequestEmail } = require('../services/email');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate the shared COI-request body fields.
 * Returns null when valid, or { message, details } describing the first problem.
 */
function validateCoiRequestBody(body) {
  const { coverageTypes, note, requestedBy, requestedByEmail, additionalInsured, dueDate } = body;

  if (coverageTypes !== undefined) {
    if (!Array.isArray(coverageTypes) || coverageTypes.some((t) => !COVERAGE_TYPES.includes(t))) {
      return {
        message: 'coverageTypes must be an array of known coverage types',
        details: { allowed: COVERAGE_TYPES },
      };
    }
  }
  if (note !== undefined && note !== null && typeof note !== 'string') {
    return { message: 'note must be a string' };
  }
  // `requestedBy` is a free-form actor label ("system", a username) — not an
  // address. Only `requestedByEmail` has to parse as an email.
  if (requestedBy !== undefined && requestedBy !== null && typeof requestedBy !== 'string') {
    return { message: 'requestedBy must be a string' };
  }
  if (additionalInsured !== undefined && additionalInsured !== null && typeof additionalInsured !== 'string') {
    return { message: 'additionalInsured must be a string' };
  }
  if (requestedByEmail !== undefined && requestedByEmail !== null && !EMAIL_RE.test(requestedByEmail || '')) {
    return { message: 'requestedByEmail must be a valid email' };
  }
  if (dueDate !== undefined && dueDate !== null) {
    if (typeof dueDate !== 'string' || Number.isNaN(new Date(dueDate).getTime())) {
      return { message: 'dueDate must be an ISO date or datetime string' };
    }
  }
  return null;
}

function openRequestFor(vendorId) {
  return prisma.coiRequest.findFirst({ where: { vendorId, status: 'REQUESTED' } });
}

/**
 * Create the COI request record and run Proof's existing request workflow:
 * rotate the vendor's upload token, email them the portal link, and log the
 * send so the app UI's cooldown and `lastRequestedAt` see API-originated
 * requests too.
 *
 * The record is the deliverable — a failed email leaves the request standing
 * rather than losing it, matching the app's own behaviour.
 */
async function createCoiRequest({ org, vendor, apiClientId = null, body = {} }) {
  const { coverageTypes, note, requestedBy, requestedByEmail, additionalInsured, dueDate } = body;

  const created = await prisma.coiRequest.create({
    data: {
      orgId: org.id,
      vendorId: vendor.id,
      coverageTypes: Array.isArray(coverageTypes) ? coverageTypes : [],
      note: typeof note === 'string' ? note : null,
      requestedBy: typeof requestedBy === 'string' ? requestedBy : null,
      requestedByEmail: requestedByEmail || null,
      additionalInsured: typeof additionalInsured === 'string' ? additionalInsured : null,
      dueDate: dueDate ? new Date(dueDate) : null,
      source: 'api',
      apiClientId,
    },
  });

  try {
    const uploadToken = generateUploadToken(vendor.id);
    await prisma.vendor.update({ where: { id: vendor.id }, data: { uploadToken } });
    const portalUrl = `${process.env.APP_URL}/portal/${uploadToken}`;
    const cc = vendor.additionalEmails?.length > 0 ? vendor.additionalEmails : undefined;
    await sendUploadRequestEmail(vendor.email, vendor.name, portalUrl, vendor.organization, cc);
    await prisma.notificationLog.create({
      data: {
        orgId: org.id,
        vendorId: vendor.id,
        type: 'UPLOAD_REQUEST',
        recipientEmail: vendor.email,
        status: 'SENT',
      },
    });
  } catch (mailErr) {
    console.error('[API v1] COI request email failed:', mailErr.message);
  }

  // Reflect the outstanding request as `pending` unless a COI already exists.
  if (vendor.coiStatus === 'NO_COI') {
    await prisma.vendor.update({ where: { id: vendor.id }, data: { coiStatus: 'PENDING' } });
  }

  return created;
}

module.exports = { validateCoiRequestBody, openRequestFor, createCoiRequest, EMAIL_RE };
