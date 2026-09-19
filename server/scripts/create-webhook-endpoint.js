#!/usr/bin/env node
/**
 * Register an outbound webhook endpoint for a consumer and generate its signing
 * secret.
 *
 * Usage:
 *   node scripts/create-webhook-endpoint.js \
 *     --name "Quill" --url https://quill.example.com/api/webhooks/proof/coi \
 *     --all-orgs --events coi.updated
 *
 *   node scripts/create-webhook-endpoint.js \
 *     --name "BuildCo" --url https://buildco.example.com/hooks/proof \
 *     --org buildco
 *
 * Flags:
 *   --name <string>   Human label (required).
 *   --url <string>    HTTPS endpoint that receives POSTs (required).
 *   --org <slugOrId>  Scope to one org. Mutually exclusive with --all-orgs.
 *   --all-orgs        Receive events for every org.
 *   --events <csv>    Comma-separated event names. Default: coi.updated.
 *
 * The signing secret is printed ONCE. Store it as the consumer's
 * PROOF_WEBHOOK_SECRET; deliveries are signed as X-Proof-Signature (hex
 * HMAC-SHA256 of the raw body).
 */

const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { EVENTS } = require('../src/services/webhookDispatcher');

const prisma = new PrismaClient();

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all-orgs') args.allOrgs = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.name || typeof args.name !== 'string') {
    console.error('Error: --name is required.');
    process.exit(1);
  }
  if (!args.url || typeof args.url !== 'string') {
    console.error('Error: --url is required.');
    process.exit(1);
  }
  if (args.allOrgs && args.org) {
    console.error('Error: pass either --org or --all-orgs, not both.');
    process.exit(1);
  }
  if (!args.allOrgs && !args.org) {
    console.error('Error: scope the endpoint with --org <slugOrId> or --all-orgs.');
    process.exit(1);
  }

  let orgId = null;
  let orgLabel = 'ALL ORGS';
  if (args.org) {
    const org = await prisma.organization.findFirst({
      where: { OR: [{ slug: args.org }, { id: args.org }] },
      select: { id: true, name: true, slug: true },
    });
    if (!org) {
      console.error(`Error: no organization found for "${args.org}".`);
      process.exit(1);
    }
    orgId = org.id;
    orgLabel = `${org.name} (${org.slug || org.id})`;
  }

  const events = typeof args.events === 'string'
    ? args.events.split(',').map((s) => s.trim()).filter(Boolean)
    : [EVENTS.COI_UPDATED];

  const secret = `whsec_${crypto.randomBytes(24).toString('base64url')}`;

  const endpoint = await prisma.webhookEndpoint.create({
    data: {
      name: args.name,
      url: args.url,
      secret,
      events,
      orgId,
      allOrgs: Boolean(args.allOrgs),
    },
  });

  console.log('\nWebhook endpoint created:');
  console.log(`  id:      ${endpoint.id}`);
  console.log(`  name:    ${endpoint.name}`);
  console.log(`  url:     ${endpoint.url}`);
  console.log(`  org:     ${orgLabel}`);
  console.log(`  events:  ${events.join(', ')}`);
  console.log('\n  Signing secret (shown once — store as PROOF_WEBHOOK_SECRET):\n');
  console.log(`    ${secret}\n`);
}

main()
  .catch((err) => {
    console.error('Failed to create webhook endpoint:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
