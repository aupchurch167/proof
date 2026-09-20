# Audit notes — Proof pre-launch (`proof-2026-09-20`)

Auditor stance: senior staff, read-only on application code. Only files created/modified are under `audit/`.

## Scope and method

Static analysis of the npm workspaces monorepo at commit `71021a4` (`origin/main` at audit start). No production data, no live droplet SSH, no Neon queries. Local `.env` files were not present in this environment.

## Commands run

```
git fetch origin main
git log -1 --oneline origin/main          # 71021a4
git ls-files | rg -i '\.env|secret|credential|id_rsa'
git log --all --diff-filter=A --summary | rg -i 'env|secret|pem'
rg -n 'BEGIN (RSA|OPENSSH)|AKIA[0-9A-Z]{16}|sk_live_|sk-ant-' 
ls -la /workspace/.env /workspace/server/.env /workspace/client/.env
# none exist

cd server && npm audit --omit=dev
# 13 vulns: 0 critical, 7 high, 5 moderate, 1 low

cd client && npm audit --omit=dev
# 3 moderate (react-router open redirect)

rg -n 'router\.(get|post|put|patch|delete)\(' server/src/routes
rg -n '\$queryRaw|\$executeRaw' server
rg -n 'process\.env\.' --glob '*.js'
rg -n 'emailVerified|uploadToken|orgId: req.user.orgId' server
rg -n 'Sentry|stripe|privacy|HIPAA|dangerouslySetInnerHTML'
```

gitleaks / trufflehog were not installed. Secret scan was `git ls-files` + `git log --summary` + regex over tracked files. No live secrets found in tracked content. `.env.example` files contain placeholders only.

## What was not verified (owner)

- Whether production `NODE_ENV=production` (gates v1 `x-helm-test-org-slug` bypass and error-message leakage).
- Whether `RESEND_WEBHOOK_SECRET` is set on the droplet/Railway.
- Whether `HELM_CORE_INTEGRATION=true` in production (if yes, A2-03 is live cross-tenant mirroring).
- Neon PITR window, off-Neon backups, and any restore ever tested.
- Droplet: ufw, fail2ban, unattended-upgrades, disk, PM2 count, TLS cert expiry.
- Resend domain SPF/DKIM/DMARC actually passing.
- Whether a staging environment exists.
- Whether seed (`admin@markallancont.com` / `password123`) was ever run against production.

## Severity calibration notes

- Cross-tenant data writes (inbound webhook email match; optional webhook auth; Core mirror of every org into one Core slug) are Critical because they are reachable from the current code paths without a second bug.
- `uploadToken` disclosure is High, not Critical: it is intra-tenant privilege escalation (any org member → vendor portal write), not cross-tenant.
- Plan/billing is a display enum only; A7 is a skip.

## Test environment caveat

`server/tests/setup.js` `cleanupTestData()` issues unbounded `deleteMany({})` on every model. Do not point Jest at a shared or production database.
