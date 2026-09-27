# Deployment runbook

The portal is a standard Next.js 15 server app + PostgreSQL. It does **not** run on GitHub Pages (it needs a server for auth, payments and the database). Good fits: **Railway**, **Render**, **Fly.io**, or **Vercel + Neon/Supabase Postgres**.

## 1. Provision
- PostgreSQL 14+ (managed). Note the connection string.
- A persistent volume for uploaded documents (or switch `StorageProvider` to S3/R2 — required on Vercel).

## 2. Environment
| Variable | Value |
|---|---|
| `DATABASE_URL` | managed Postgres URL (with `?sslmode=require` if needed) |
| `APP_URL` | `https://portal.legacyindependentliving.net` |
| `PAYMENTS_PROVIDER` | `paypal` (mock is blocked in production) |
| `PAYPAL_ENV` | `sandbox` while testing, then `live` |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | developer.paypal.com → Apps & Credentials |
| `PAYPAL_WEBHOOK_ID` | the ID of the webhook created in step 6 |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `STORAGE_DIR` | path on the persistent volume |

## 3. Build & release
```bash
npm ci
npm run build
npx prisma migrate deploy      # run on every release, before starting the new version
npm run start                  # PORT is respected
```
Health check: `GET /api/health`.

## 4. First owner account
Don't run the demo seed in production. Create the owner once:
```bash
npx tsx -e '
import { prisma } from "./src/lib/db"; import { hashPassword } from "./src/lib/security/crypto";
(async () => { await prisma.user.create({ data: { email: process.env.OWNER_EMAIL!, name: process.env.OWNER_NAME!, role: "ADMIN", status: "ACTIVE", passwordHash: await hashPassword(process.env.OWNER_PASSWORD!) } }); await prisma.$disconnect(); })();'
```
Then sign in, open **Settings** (timezone, office phone/email, late fee, partial-payment rules) and add properties/rooms.

## 5. Scheduled job
Daily (e.g. 6:00 America/Chicago):
```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://portal.legacyindependentliving.net/api/cron/rent
```
(Vercel: add a cron in `vercel.json` hitting `/api/cron/rent`; it sends a GET with the bearer header when `CRON_SECRET` is set.)

## 6. PayPal
1. Use a **PayPal Business** account. At developer.paypal.com → **Apps & Credentials**, create an app (Sandbox first, then Live) and copy the Client ID + Secret.
2. In the app, **Add webhook**: URL `https://<domain>/api/webhooks/paypal`, events
   `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`, `CHECKOUT.ORDER.VOIDED`. Copy its **Webhook ID** into `PAYPAL_WEBHOOK_ID`.
3. Test end to end with a sandbox buyer account (Sandbox → Accounts): pay rent, confirm the receipt and $0 balance, then refund from the owner portal.
4. Switch to live: `PAYPAL_ENV=live` + live Client ID/Secret/Webhook ID.

How it works: the resident is sent to PayPal, pays with PayPal balance, bank, or a debit/credit card (no PayPal account needed), and is returned to `/api/pay/return`, which **captures the payment server-side** and posts it to the ledger. Webhooks are the backup if the resident closes the tab. Refunds from the owner portal go straight to PayPal.

(Stripe is still supported as an alternative: `PAYMENTS_PROVIDER=stripe` with `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`.)

## 7. DNS
`portal.legacyindependentliving.net` → CNAME to the host. Keep the marketing site on GitHub Pages at the apex domain.

## 8. Backups
Enable daily automated backups + point-in-time recovery on the Postgres provider. The ledger is the financial record.
