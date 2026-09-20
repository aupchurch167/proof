# Production server checklist (owner-run)

This audit did **not** SSH to the droplet and did **not** assume access. Print this, run it on `app.proofcoi.com`’s host, file the answers next to `/audit/NOTES.md` open questions.

## Identity

- [ ] Hostname / public IP: `________`
- [ ] Provider: DigitalOcean droplet / Railway / both: `________`
- [ ] Who has SSH keys: `________`
- [ ] `NODE_ENV` on the running process (`pm2 env` / systemd): must be `production`

## SSH

- [ ] Password auth off (`PasswordAuthentication no`)
- [ ] Root login off or key-only
- [ ] Fail2ban or equivalent
- [ ] SSH on 22 or nonstandard; no 22 open to 0.0.0.0 if you can help it

## Firewall

- [ ] `ufw status` (or DO cloud firewall): 22/admin, 80, 443 only
- [ ] Postgres **not** listening on 0.0.0.0 (Neon = OK if not self-hosted)
- [ ] Port 4000 **not** public (Nginx proxies localhost)

## TLS / Nginx

- [ ] Config matches repo `nginx/proof.conf` (or attach the live file)
- [ ] `sudo nginx -t` OK
- [ ] Cert expiry `app.proofcoi.com` > 14 days (`certbot certificates`)
- [ ] HTTP → HTTPS 301
- [ ] HSTS header present
- [ ] `client_max_body_size` ≥ 12m (uploads are 10MB)

## Process

- [ ] Process manager: PM2 / systemd / Railway: `________`
- [ ] Instance count (must be 1 until cron has a lock — A3-04): `________`
- [ ] Restart policy on crash
- [ ] `git rev-parse HEAD` on the box = intended release
- [ ] How deploys happen (script / manual): `________`
- [ ] Who runs `npx prisma migrate deploy`, and from where

## Disk

- [ ] `df -h` — root > 20% free
- [ ] App does **not** write COI PDFs locally (code uses Spaces; confirm no growing `uploads/` or `/tmp` PDFs)
- [ ] Log rotation (`pm2-logrotate` / journald)

## Secrets on the box

- [ ] `.env` mode 600, not in the git checkout’s tracked files
- [ ] `JWT_SECRET` / `JWT_REFRESH_SECRET` ≥ 32 random bytes, not the example string
- [ ] `RESEND_WEBHOOK_SECRET` **set** (A2-02)
- [ ] `HELM_CORE_INTEGRATION` is **not** `true` unless explicitly intended (A2-03)
- [ ] `APP_URL=https://app.proofcoi.com` (no trailing slash issues)
- [ ] Spaces bucket is private; no public list

## Data

- [ ] Neon (or host) PITR window: `________` days
- [ ] Last restore rehearsal: `________` (A3-01)
- [ ] Spaces versioning: on/off
- [ ] Seed user `admin@markallancont.com` does **not** exist

## Observability

- [ ] Uptime check on `https://app.proofcoi.com/api/health` every 60s
- [ ] Phone/SMS on 2 failures
- [ ] Sentry (or equivalent) DSN set (A6-01)
- [ ] `pm2 logs` is not the only place errors go

## Email

- [ ] Resend domain: SPF / DKIM / DMARC all pass
- [ ] `FROM_EMAIL` and `REPLY_TO_EMAIL` on that domain
- [ ] Send a real request-coi to a personal inbox, check spam

## Staging

- [ ] Exists? URL: `________`
- [ ] Separate JWT secrets, Spaces bucket, and database from prod
- [ ] If `proof.up.railway.app` is dead, remove it from CORS (`app.js:57`)
