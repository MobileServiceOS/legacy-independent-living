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
| `PAYMENTS_PROVIDER` | `paypal`. Leave unset until you have PayPal keys — the portal runs with online payments off (residents are told to pay the office; offline payments work). The sandbox `mock` provider is refused in production. |
| `PAYPAL_ENV` | `sandbox` while testing, then `live` |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | developer.paypal.com → Apps & Credentials |
| `PAYPAL_WEBHOOK_ID` | the ID of the webhook created in step 6 |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `TRUSTED_PROXY_HOPS` | `1` on Railway (default). Set `2` only if Cloudflare's orange-cloud proxy sits in front. |
| `STORAGE_DIR` | path on the persistent volume |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | `npm run push:keys` (once — never rotate casually) |
| `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_BUNDLE_ID` / `APNS_PRIVATE_KEY` / `APNS_ENV` | see §9 (native iOS app only) |

## 3. Build & release
**Railway:** `railway.json` in the repo sets everything — build `npm run build`, migrations as the pre-deploy step, start `npm run start`, health check `/api/health` (it checks the database). In the service settings, set **Root Directory** to the folder containing `package.json`, add the Postgres plugin and reference its URL as `DATABASE_URL` (`${{Postgres.DATABASE_URL}}`), and attach a volume mounted at `/data` with `STORAGE_DIR=/data`.

**Troubleshooting a crash loop** (`railway logs`):
| Log says | Fix |
|---|---|
| `Missing required environment variable DATABASE_URL` / health check 503 | add/reference the Postgres `DATABASE_URL` on the web service |
| `P3009` / `migrate found failed migrations` | the database has a half-applied migration — `railway run npx prisma migrate resolve --rolled-back <name>` then redeploy |
| `Could not find a production build in the '.next' directory` | build command didn't run — keep `railway.json` at the service root |
| `[payments] online payments are not set up` | not a crash — the portal runs and tells residents to pay the office until PayPal keys are set |

Generic hosts:
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
OWNER_EMAIL=you@example.com OWNER_NAME="Your Name" OWNER_PASSWORD='a-long-passphrase' npm run owner:create
```
Then sign in, open **Settings** (timezone, office phone/email, late fee, partial-payment rules) and add properties/rooms.

## 5. Scheduled jobs
| Job | Schedule | Call |
|---|---|---|
| Rent engine (charges, late fees, reminders) | daily, ~6:00 America/Chicago | `POST /api/cron/rent` |
| Notification sweep (push retry/backstop) | every 5 minutes | `POST /api/cron/notify` |
```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://portal.legacyindependentliving.net/api/cron/rent
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://portal.legacyindependentliving.net/api/cron/notify
```
(Vercel: add both to `vercel.json` crons; Vercel sends a GET with the bearer header when `CRON_SECRET` is set — both routes accept GET.)
Pushes normally go out within a second of the event; the sweep only catches retries and anything interrupted by a restart.

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

## 9. Push notifications
**Web Push** (desktop browsers, Android, and iPhone/iPad when the portal is added to the Home Screen on iOS 16.4+):
1. `npm run push:keys` → put the three `VAPID_*` lines in the environment. Deploy.
2. Residents see "Turn on notifications" on Home / Profile; staff under Notifications.

**Apple Push** (native iOS app in `native/`):
1. developer.apple.com → Certificates, IDs & Profiles → **Keys** → **+** → enable *Apple Push Notifications service (APNs)* → download the `.p8` (only downloadable once). Note the **Key ID** and your **Team ID**.
2. Set `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID=net.legacyindependentliving.app`, `APNS_PRIVATE_KEY` (the .p8 contents; `\n` escapes are fine), `APNS_ENV=production` (TestFlight + App Store builds) or `sandbox` (Xcode debug installs).
3. Build the app per `native/CLAUDE.md`.

What gets pushed: rent due soon / today / overdue, payment received / pending / failed / refunded, repair status changes and staff replies, new applications and repair requests (staff), and account notices. Devices that return "gone" (410 / `Unregistered`) or fail 5 times in a row are switched off automatically; signing out removes the device.
