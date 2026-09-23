const Anthropic = require('@anthropic-ai/sdk');

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

const nullableString = (description) => ({ type: ['string', 'null'], description });
const nullableCents = (description) => ({ type: ['integer', 'null'], description });

// Enforced server-side via output_config.format, so the model cannot return
// prose, markdown fences, or a field we don't expect. Structured outputs
// requires every property to be listed in `required`; optional values are
// expressed as nullable types rather than by omission.
const COI_SCHEMA = {
  type: 'object',
  properties: {
    coverageType: {
      type: 'string',
      enum: ['GENERAL_LIABILITY', 'WORKERS_COMP', 'UMBRELLA', 'AUTO', 'OTHER'],
      description: 'Primary coverage type of the certificate.',
    },
    glPolicyNumber: nullableString('General liability policy number.'),
    glCoverageAmount: nullableCents('GL per-occurrence limit in cents (e.g. $1,000,000 = 100000000).'),
    glExpirationDate: nullableString('GL expiration date as YYYY-MM-DD.'),
    wcPolicyNumber: nullableString('Workers comp policy number.'),
    wcCoverageAmount: nullableCents('WC limit in cents.'),
    wcExpirationDate: nullableString('WC expiration date as YYYY-MM-DD.'),
    umbPolicyNumber: nullableString('Umbrella / excess liability policy number.'),
    umbCoverageAmount: nullableCents('Umbrella limit in cents.'),
    umbExpirationDate: nullableString('Umbrella expiration date as YYYY-MM-DD.'),
    autoPolicyNumber: nullableString('Automobile liability policy number.'),
    autoCoverageAmount: nullableCents('Auto limit in cents.'),
    autoExpirationDate: nullableString('Auto expiration date as YYYY-MM-DD.'),
    agentName: nullableString('Producer / agent name.'),
    agentEmail: nullableString('Producer / agent email.'),
    agentPhone: nullableString('Producer / agent phone.'),
    insuranceCompany: nullableString('Carrier providing the coverage.'),
    certificateHolderName: nullableString('Entity named in the CERTIFICATE HOLDER section.'),
    certificateHolderAddress: nullableString('Full address from the certificate holder section.'),
  },
  required: [
    'coverageType',
    'glPolicyNumber', 'glCoverageAmount', 'glExpirationDate',
    'wcPolicyNumber', 'wcCoverageAmount', 'wcExpirationDate',
    'umbPolicyNumber', 'umbCoverageAmount', 'umbExpirationDate',
    'autoPolicyNumber', 'autoCoverageAmount', 'autoExpirationDate',
    'agentName', 'agentEmail', 'agentPhone', 'insuranceCompany',
    'certificateHolderName', 'certificateHolderAddress',
  ],
  additionalProperties: false,
};

/**
 * Extract COI data from a PDF.
 * @param {Buffer|string} pdfInput - PDF buffer or file path (legacy support for migration)
 */
async function extractCoiData(pdfInput) {
  let pdfBuffer;
  if (Buffer.isBuffer(pdfInput)) {
    pdfBuffer = pdfInput;
  } else {
    // Legacy: accept file path for migration script
    const fs = require('fs');
    pdfBuffer = fs.readFileSync(pdfInput);
  }
  const base64Pdf = pdfBuffer.toString('base64');

  const response = await getClient().messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
    max_tokens: 4096,
    output_config: {
      format: { type: 'json_schema', schema: COI_SCHEMA },
    },
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
            text: `Extract the insurance details from this Certificate of Insurance (COI) PDF. For coverage amounts, convert to cents (e.g., $1,000,000 = 100000000). For dates, use ISO 8601 format (YYYY-MM-DD). Use null for anything the certificate does not state.

This PDF may have multiple pages. The first page is often a cover sheet, transmittal letter, or only contains vendor / insured-party information with no policy data. Scan EVERY page and extract the insurance details from whichever page(s) actually contain the ACORD 25 (or similar) form with policy numbers, coverage limits, and expiration dates. Ignore blank, cover, or non-COI pages. If multiple pages contain COI data, consolidate it into one result.

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
- For certificateHolderAddress, extract the full address from the certificate holder section`,
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
  // output_config.format guarantees this block is schema-valid JSON.
  const data = JSON.parse(textBlock.text);

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

module.exports = { extractCoiData, inferCoverageType };
