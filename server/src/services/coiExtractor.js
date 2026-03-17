const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');

const client = new Anthropic.default();

async function extractCoiData(pdfPath) {
  const pdfBuffer = fs.readFileSync(pdfPath);
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

{
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
  "insuranceCompany": "string or null"
}

Important:
- Look for "General Liability", "Commercial General Liability", or "CGL" for GL fields
- Look for "Workers Compensation" or "Workers Comp" for WC fields
- Look for "Umbrella" or "Excess Liability" for umbrella fields
- Look for "Automobile Liability" or "Auto Liability" for auto fields
- Extract the per-occurrence limit for General Liability, not the aggregate
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

  return JSON.parse(jsonStr);
}

module.exports = { extractCoiData };
