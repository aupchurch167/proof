const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic.default();

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

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
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

  const text = response.content[0].text.trim();

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

module.exports = { extractCoiData, inferCoverageType };
