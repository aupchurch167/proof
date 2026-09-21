# License inventory

Proof's own source is proprietary (all rights reserved). See `LICENSE` and `NOTICE`.

Third-party packages keep their own licenses (MIT, Apache-2.0, BSD, vendor ToS such as Anthropic and AWS). This file is how to audit them — it is not legal advice.

## How to generate a production dependency list

From the repo root (after `npm ci` in each workspace you care about):

```bash
# Root + workspaces, production only, skip this private package
npx license-checker --production --excludePrivatePackages --summary

# Machine-readable tree
npx license-checker --production --excludePrivatePackages --csv
```

Useful variants:

| Flag | Why |
|---|---|
| `--production` | Ignore jest/vite/prisma-CLI dev trees when answering "what ships" |
| `--excludePrivatePackages` | Skip `proof`, `proof-server`, `proof-client` |
| `--failOn 'GPL-3.0;AGPL-3.0'` | Optional CI tripwire — do not add until counsel picks a policy |
| `--onlyAllow 'MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC'` | Too strict today (AWS / Anthropic SDKs are vendor ToS) |

There is a convenience script on the root package: `npm run licenses`.

## What to attach to a questionnaire

Regenerate the CSV at release time and attach it. Do not commit a stale dump as if it were the live tree — `package-lock.json` is the source of truth.

Known production runtimes (from `server/package.json` / `client/package.json`):

- Express, Prisma Client, bcryptjs, jsonwebtoken, helmet, cors, morgan, multer, zod, uuid, pdf-lib, cron, dotenv, pg
- AWS SDK (DigitalOcean Spaces), Anthropic SDK, Resend, Google auth library
- React, React DOM, React Router

## Residual

Counsel still needs to approve the app `LICENSE` and any "only allow" fail list. This batch does not invent an OSS grant.
