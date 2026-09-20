const Anthropic = require('@anthropic-ai/sdk');
const prisma = require('../lib/prisma');
const { isExtractLimitError } = require('../lib/extractErrors');

const DEFAULT_EXTRACT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_EXTRACT_DAILY_CAP = 10;
const EXTRACT_AUDIT_ACTION = 'extract';
const EXTRACT_AUDIT_ENTITY = 'ai';

class ExtractLimitError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'ExtractLimitError';
    this.status = status;
    this.code = code;
  }
}

function getExtractMaxBytes() {
  const n = parseInt(process.env.EXTRACT_MAX_BYTES, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_EXTRACT_MAX_BYTES;
}

function getExtractDailyCap() {
  const n = parseInt(process.env.EXTRACT_DAILY_CAP, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_EXTRACT_DAILY_CAP;
}

function utcDayStart(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function assertExtractAllowed(orgId, byteLength) {
  const maxBytes = getExtractMaxBytes();
  if (byteLength > maxBytes) {
    throw new ExtractLimitError(
      `PDF exceeds the AI extract size limit (${maxBytes} bytes)`,
      { status: 413, code: 'EXTRACT_BYTE_LIMIT' }
    );
  }

  if (!orgId) return;

  const cap = getExtractDailyCap();
  const count = await prisma.auditLog.count({
    where: {
      orgId,
      action: EXTRACT_AUDIT_ACTION,
      entity: EXTRACT_AUDIT_ENTITY,
      createdAt: { gte: utcDayStart() },
    },
  });
  if (count >= cap) {
    throw new ExtractLimitError(
      `Daily AI extract limit reached (${cap} per organization)`,
      { status: 429, code: 'EXTRACT_DAILY_CAP' }
    );
  }
}

async function recordExtract(orgId, byteLength) {
  if (!orgId) return;
  await prisma.auditLog.create({
    data: {
      orgId,
      action: EXTRACT_AUDIT_ACTION,
      entity: EXTRACT_AUDIT_ENTITY,
      details: { bytes: byteLength },
    },
  });
}

// Construct lazily so a missing key produces a clear, surfaced error at call
// time rather than a silent failure (the SDK defers the key check to the first
// request, which callers were swallowing).
let client;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set — AI extraction is disabled');
  }
  if (!client) {
    client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Extract COI data from a PDF.
 * @param {Buffer|string} pdfInput - PDF buffer or file path (legacy support for migration)
 * @param {{ orgId?: string }} [opts] - orgId enables the per-org daily spend cap
 */
async function extractCoiData(pdfInput, opts = {}) {
  let pdfBuffer;
  if (Buffer.isBuffer(pdfInput)) {
    pdfBuffer = pdfInput;
  } else {
    // Legacy: accept file path for migration script
    const fs = require('fs');
    pdfBuffer = fs.readFileSync(pdfInput);
  }

  const orgId = opts.orgId || null;
  await assertExtractAllowed(orgId, pdfBuffer.length);

  const anthropic = getClient();
  await recordExtract(orgId, pdfBuffer.length);

  const base64Pdf = pdfBuffer.toString('base64');

  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64Pdf,
            },
          },
          {
            type: 'text',
            text: `Extract the following information from this Certificate of Insurance (COI) PDF. Return ONLY a valid JSON object with these fields. For coverage amounts, convert to cents (e.g., $1,000,000 = 100000000). For dates, use ISO 8601 format (YYYY-MM-DD).

This PDF may have multiple pages. The first page is often a cover sheet, transmittal letter, or only contains vendor / insured-party information with no policy data. Scan EVERY page and extract the insurance details from whichever page(s) actually contain the ACORD 25 (or similar) form with policy numbers, coverage limits, and expiration dates. Ignore blank, cover, or non-COI pages. If multiple pages contain COI data, consolidate it into one JSON object.

{
  "coverageType": "GENERAL_LIABILITY | WORKERS_COMP | UMBRELLA | AUTO | OTHER",
  "glPolicyNumber": "string or null",
  "glCoverageAmount": "integer in cents or null",
  "glExpirationDate": "YYYY-MM-DD or null",
  "wcPolicyNumber": "string or null",
  "wcCoverageAmount": "integer in cents or null",
  "wcExpirationDate": "YYYY-MM-DD or null",
  "umbPolicyNumber": "string or null",
  "umbCoverageAmount": "integer in cents or null",
  "umbExpirationDate": "YYYY-MM-DD or null",
  "autoPolicyNumber": "string or null",
  "autoCoverageAmount": "integer in cents or null",
  "autoExpirationDate": "YYYY-MM-DD or null",
  "agentName": "string or null",
  "agentEmail": "string or null",
  "agentPhone": "string or null",
  "insuranceCompany": "string or null",
  "certificateHolderName": "string or null",
  "certificateHolderAddress": "string or null"
}

Important:
- If the first page has no policy information, do not stop there — continue to subsequent pages until you find the actual certificate data, then extract from there.
- For coverageType, determine the PRIMARY coverage type of this certificate:
  - "GENERAL_LIABILITY" if the certificate primarily covers General/Commercial General Liability
  - "WORKERS_COMP" if it primarily covers Workers Compensation
  - "UMBRELLA" if it primarily covers Umbrella/Excess Liability
  - "AUTO" if it primarily covers Automobile Liability
  - "OTHER" if it doesn't fit the above or covers multiple types equally
  - If the certificate is an ACORD 25 form covering multiple types, set to "OTHER"
- Look for "General Liability", "Commercial General Liability", or "CGL" for GL fields
- Look for "Workers Compensation" or "Workers Comp" for WC fields
- Look for "Umbrella" or "Excess Liability" for umbrella fields
- Look for "Automobile Liability" or "Auto Liability" for auto fields
- Extract the per-occurrence limit for General Liability, not the aggregate
- Extract each coverage section's expiration date independently
- For certificateHolderName, look for the "CERTIFICATE HOLDER" section (usually bottom-left of ACORD forms) and extract the company/entity name
- For certificateHolderAddress, extract the full address from the certificate holder section
- Return ONLY the JSON, no markdown formatting or explanation`,
          },
        ],
      },
    ],
  });

  // Find the text block rather than assuming it's first.
  const textBlock = Array.isArray(response.content) && response.content.find((b) => b.type === 'text');
  if (!textBlock || !textBlock.text) {
    throw new Error('Model returned no text content');
  }
  const text = textBlock.text.trim();

  // Parse the JSON, handling potential markdown code blocks
  let jsonStr = text;
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const data = JSON.parse(jsonStr);

  // Validate coverageType is a known enum value, fall back to inference
  const validTypes = ['GENERAL_LIABILITY', 'WORKERS_COMP', 'UMBRELLA', 'AUTO', 'OTHER'];
  if (!data.coverageType || !validTypes.includes(data.coverageType)) {
    data.coverageType = inferCoverageType(data);
  }

  return data;
}

function inferCoverageType(data) {
  // Count which coverage sections have data
  const has = {
    gl: !!(data.glPolicyNumber || data.glCoverageAmount),
    wc: !!(data.wcPolicyNumber || data.wcCoverageAmount),
    umb: !!(data.umbPolicyNumber || data.umbCoverageAmount),
    auto: !!(data.autoPolicyNumber || data.autoCoverageAmount),
  };

  const count = Object.values(has).filter(Boolean).length;

  if (count === 1) {
    if (has.gl) return 'GENERAL_LIABILITY';
    if (has.wc) return 'WORKERS_COMP';
    if (has.umb) return 'UMBRELLA';
    if (has.auto) return 'AUTO';
  }

  return 'OTHER';
}

module.exports = {
  extractCoiData,
  inferCoverageType,
  assertExtractAllowed,
  isExtractLimitError,
  ExtractLimitError,
  getExtractMaxBytes,
  getExtractDailyCap,
  EXTRACT_AUDIT_ACTION,
  EXTRACT_AUDIT_ENTITY,
};
