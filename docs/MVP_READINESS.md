# MVP readiness — Legacy Independent Living portal

**Verdict:** the software is MVP-ready. Launch is blocked only on accounts/credentials that must be created by the owner
(hosting, PayPal live, Apple). Everything below marked ✅ is covered by automated tests in CI
(unit, database-integrity, integration, and Playwright end-to-end).

## Product
| Area | Status |
|---|---|
| Resident portal: balance, due date, pay, receipts, history, documents | ✅ |
| Owner portal: dashboard, properties → rooms → residents, occupancy board | ✅ |
| Applications → approve → **Convert to resident** (room assigned, invite link) | ✅ |
| Append-only ledger (DB-enforced), rent engine, late fees, derived statuses | ✅ |
| PayPal checkout (server-side capture, webhooks, refunds) — card/bank never stored | ✅ sandbox-tested in code; **do one live sandbox run** (below) |
| Offline payments (cash / money order / check), reports, CSV, audit log | ✅ |
| Maintenance requests with photos, status timeline, staff notes | ✅ |
| **Push notifications** — Web Push (PWA) + Apple Push (native app) | ✅ crypto verified vs RFC 8291; **needs one real-device check** |
| Change password (owner: Settings → Your sign-in; residents: Profile), password reset links from the office, turn sign-in off/on | ✅ |
| Account deletion request (App Store 5.1.1(v)) | ✅ |
| Privacy policy page (`/privacy`) | ✅ — review wording |
| PWA install, offline page, iPhone/iPad/PWA store screenshots | ✅ |
| iOS app shell (`native/`, Capacitor 7) | ✅ scaffolded — build on a Mac per `native/CLAUDE.md` |

## Owner to-do before launch (in order)
1. **Host it** (Railway/Render/Fly or Vercel + Neon). Set env vars from `docs/DEPLOYMENT.md` §2. Point `portal.legacyindependentliving.net` at it.
2. `npx prisma migrate deploy`, then `npm run owner:create`. Do **not** seed demo data in production.
3. **Cron:** `/api/cron/rent` daily, `/api/cron/notify` every 5 min.
4. **PayPal:** Business account → app → webhook → `PAYPAL_ENV=sandbox`, pay rent with a sandbox buyer, refund it; then switch to `live`.
5. **Push:** `npm run push:keys` → VAPID vars. Apple: create an APNs key → `APNS_*` vars.
6. **iOS app:** open the repo in VS Code on the Mac, ask Claude Code to "follow native/CLAUDE.md". It needs your Apple team in Xcode.
7. **App Store Connect:** listing copy, screenshots, privacy answers, review account — all in `docs/store/APP_STORE.md`.

## Known MVP limits (deliberate, not bugs)
- **No outgoing email/SMS yet.** Invites and reset links are copied by staff and sent by text/email by hand. Adding email = one `ChannelAdapter` (e.g. Resend/Postmark); the queue already exists.
- **Rate limits are in-memory** — correct for one server instance. Move to Redis/Postgres before running multiple instances.
- **Uploads use local disk** (`STORAGE_DIR`) — needs a persistent volume, or swap the `StorageProvider` for S3/R2 on serverless hosts.
- **PayPal inside the iOS web view** is allowed by `allowNavigation`; if PayPal ever blocks embedded checkout, the documented fallback is `@capacitor/browser`.
- Account deletion is a **request** reviewed by staff (financial records have legal retention); it is not instant self-deletion.
