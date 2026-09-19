#!/usr/bin/env node
/**
 * Mint an API token for a service-to-service consumer (Quill, Core, or any
 * future integration) and store only its hash.
 *
 * Usage:
 *   node scripts/create-api-client.js --name "Quill" --org buildco
 *   node scripts/create-api-client.js --name "Quill (all orgs)" --all-orgs
 *   node scripts/create-api-client.js --name "Read-only" --org buildco --scopes vendors:read
 *
 * Flags:
 *   --name <string>     Human label for the client (required).
 *   --org <slugOrId>    Scope the token to a single org (by slug or id).
 *   --all-orgs          Platform token: access every org (path-scoped). Mutually
 *                       exclusive with --org.
 *   --scopes <csv>      Comma-separated scopes. Defaults to all scopes.
 *   --env <live|test>   Token environment label in the prefix. Default: live.
 *
 * The raw token is printed ONCE. Store it in the consumer's PROOF_SERVICE_TOKEN.
 */

const { PrismaClient } = require('@prisma/client');
const { generateToken, hashToken, tokenPrefix } = require('../src/lib/apiTokens');
const { ALL_SCOPES } = require('../src/middleware/apiAuth');

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
  if (args.allOrgs && args.org) {
    console.error('Error: pass either --org or --all-orgs, not both.');
    process.exit(1);
  }
  if (!args.allOrgs && !args.org) {
    console.error('Error: scope the token with --org <slugOrId> or --all-orgs.');
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

  const scopes = typeof args.scopes === 'string'
    ? args.scopes.split(',').map((s) => s.trim()).filter(Boolean)
    : ALL_SCOPES;

  const env = args.env === 'test' ? 'test' : 'live';
  const token = generateToken(env);

  const client = await prisma.apiClient.create({
    data: {
      name: args.name,
      tokenHash: hashToken(token),
      tokenPrefix: tokenPrefix(token),
      scopes,
      orgId,
      allOrgs: Boolean(args.allOrgs),
    },
  });

  console.log('\nAPI client created:');
  console.log(`  id:      ${client.id}`);
  console.log(`  name:    ${client.name}`);
  console.log(`  org:     ${orgLabel}`);
  console.log(`  scopes:  ${scopes.join(', ')}`);
  console.log('\n  Token (shown once — store it now as PROOF_SERVICE_TOKEN):\n');
  console.log(`    ${token}\n`);
}

main()
  .catch((err) => {
    console.error('Failed to create API client:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
