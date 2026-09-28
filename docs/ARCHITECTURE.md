# Architecture

## 1. Layers

| Layer | Folder | Rules |
|---|---|---|
| Domain | `src/domain` | Pure functions, no I/O, no framework. Money, dates, ledger allocation, rent planning, status derivation, payment state machine, RBAC. 100% unit-tested. |
| Services | `src/server` | Prisma + transactions + audit. Take an explicit `Actor`. No Next.js imports (so integration tests call them directly). |
| Infrastructure | `src/lib` | DB client, sessions/guards, validation, payment providers, notifications, storage, crypto, rate limiting. |
| Delivery | `src/app` | Server Components render; Server Actions do **authorize → validate (zod) → service → revalidate**. |

## 2. Data model

```
users ─1:1─ residents ─┬─< room_assignments >── rooms >── properties
                       ├─< rent_schedules
                       ├─< ledger_entries >── payments ─< payment_events
                       ├─< payments
                       ├─< payment_methods   (tokens only; autopay-ready)
                       └─< documents
applications ─1:1─ residents (conversion)
users ─< sessions, invite_tokens, notifications ─< notification_deliveries
audit_logs, announcements, settings (singleton)
```

Integrity rules enforced **in PostgreSQL** (see `prisma/migrations/0001_init/migration.sql`, part 2):

| Rule | Mechanism |
|---|---|
| Ledger is append-only | `BEFORE UPDATE OR DELETE` trigger |
| Ledger sign per type (rent/fees/refunds > 0, payments/credits < 0, adjustments ≠ 0) | CHECK |
| Payment/refund entries reference a payment; one entry per payment per type | CHECK + partial unique index |
| One rent charge per resident per month, one late fee per charge | unique `idempotency_key` |
| One active assignment per room and per resident | partial unique indexes (`end_date IS NULL`) |
| One active rent schedule per resident; due day 1–28 | partial unique index + CHECK |
| Payments: amount/resident/method/receipt immutable; FAILED/REFUNDED/CANCELED terminal; SUCCEEDED → REFUNDED only; never deleted | trigger |
| Residents, schedules, assignments never hard-deleted; rooms/properties with history can't be deleted | triggers + `ON DELETE RESTRICT` |
| Offline payments must record who entered them and when | CHECK |
| No raw card numbers (last4 must be exactly 4 digits) | CHECK |
| Audit log + payment events append-only | triggers |

`scripts/check-schema-drift.mjs` (CI + `npm run db:check`) proves `schema.prisma` and the migrated database agree column-by-column.

## 3. Rent engine

`src/domain/rent.ts` decides; `src/server/rent-engine.ts` writes.

- **Charges**: for each schedule, every month from move-in whose due date is within `chargeLeadDays` (default 7) of today. First month's due date is never before move-in. Days 29–31 clamp. Stops at schedule end (rent change / move-out).
- **Rent changes** end the current schedule the day before the new one starts; months already posted keep their amount (add an adjustment if needed).
- **Late fees**: optional; one per rent charge still unpaid `graceDays` after its due date.
- **Status** (`deriveRentPosition`), precedence: `PAID` (balance ≤ 0) → `PENDING` (in-flight ACH covers balance) → `OVERDUE` (oldest unpaid due date passed) → `PARTIAL` (oldest open charge part-paid) → `DUE` (due today) → `DUE_SOON`.
- **Runs**: daily `POST /api/cron/rent` (Bearer `CRON_SECRET`), once per business day lazily on dashboard load, on conversion/rent change, and the admin "Run now" button. Each resident runs in its own row-locked transaction.
- "Today" is the business timezone's calendar date (`settings.timezone`, default `America/Chicago`). `APP_TODAY` overrides it for demos/tests.

## 4. Payments

```
Resident ─ Pay rent ─▶ startOnlinePayment()  (validates vs balance − in-flight, creates PENDING payment)
                          └─▶ provider.createCheckout() ─▶ hosted checkout (Stripe) / sandbox page (Mock)
Processor ─ webhook ─▶ /api/webhooks/stripe ─▶ verify signature ─▶ mapStripeEvent() ─▶ applyProviderEvent()
                                                                    (dedupe by event id, row lock, state machine)
                    SUCCEEDED  ─▶ ledger PAYMENT (−amount, key payment:<id>) + notification + receipt
                    PROCESSING ─▶ status only (ACH in flight → "Payment pending")
                    FAILED     ─▶ status + resident & admin notified, ledger untouched
                    REFUNDED   ─▶ ledger REFUND (+amount, key refund:<id>)
Admin ─ Record offline payment ─▶ SUCCEEDED OFFLINE payment + ledger + audit (recorded_by)
```

- **Stripe (production)**: `src/lib/payments/stripe.ts` — hosted Checkout Sessions (card / Cash App Pay / ACH, one method per session so the resident's choice is honored), server-side confirmation on return (`completeReturn` retrieves the session), `cancelCheckout` expires abandoned sessions, signed webhooks as backup, refunds against the payment intent. `eventMismatch()` checks every event's checkout id, amount and currency against the payment before anything settles.
- **PayPal (alternative)**: `src/lib/payments/paypal.ts` — Orders v2 with `intent: CAPTURE`, `custom_id` = our payment id, `invoice_id` = receipt number (PayPal rejects duplicates). Return URL `/api/pay/return` captures server-side (idempotent `PayPal-Request-Id`; handles already-captured). Capture `COMPLETED` → succeeded, `PENDING` (eCheck) → processing, `DECLINED` → failed. After capture, `provider_ref` becomes the **capture id**, which refunds use. Webhooks verified through PayPal's `verify-webhook-signature` API (cert URL pinned to paypal.com); cancel URL `/api/pay/cancel` closes the pending payment.
- **Adding a processor**: implement `PaymentProvider` (`createCheckout`, `refund`, `parseWebhook`) and register it in `src/lib/payments/index.ts`.
- **Stripe setup**: `PAYMENTS_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; webhook events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`.
- **Autopay (architecture)**: `payment_methods` stores processor tokens with `autopay_enabled`; an autopay job would call a provider `chargeSavedMethod()` for residents with a due balance and feed the result through `applyProviderEvent()` — the same settlement path as every other payment.
- **Partial payments**: `settings.allowPartialPayments` + `minPartialPaymentCents`.
- **Pay ahead**: `settings.allowPayAhead` + `maxPayAheadMonths` let a resident pay more than their current balance (up to `maxPayAheadMonths × monthlyRentCents` extra) in one online payment. The excess posts as an ordinary `PAYMENT` ledger entry and shows up as `unappliedCreditCents` (`position.creditCents`) — no special-casing needed, since `allocate()` (FIFO, `src/domain/ledger.ts`) applies that credit to future `RENT_CHARGE` rows automatically as the rent engine posts them each month. `validatePaymentAmount`/`payAheadCeilingCents` (`src/domain/payments.ts`) enforce the ceiling; beyond it is refused with "most you can pay".

## 5. Authentication & authorization

- Email + password. Passwords hashed with **scrypt** (N=2¹⁵, r=8, p=1, 16-byte salt); constant-time compare; dummy hash on unknown emails (no enumeration via timing or message).
- Sessions: 256-bit random token in an `HttpOnly`, `SameSite=Lax`, `Secure` (prod) cookie; only its SHA-256 is stored. Revoked on sign-out and when a password is set.
- Residents are created by the owner and receive a single-use **setup link** (14 days); the link sets their password.
- Rate limits: sign-in (8 / 15 min per IP+email), invite (10 / 15 min), applications (5 / hour per IP), payments (20 / 15 min per user). In-memory for a single instance — swap the store behind `RateLimiter` for multi-instance hosting.
- RBAC in `src/domain/permissions.ts`: permissions per role; every page (`requirePagePermission`), server action (`requireActionPermission`) and route handler re-checks on the server. Record-level: `canAccessResidentRecord` — residents only ever see their own payments, receipts, documents and ledger; other records return 404.
- Adding **Property Manager / Staff**: add the enum value + a permission set; optionally scope by property with a user↔property join.
- CSRF: Server Actions verify `Origin`; cookies are `SameSite=Lax`; webhooks are signature-verified; cron requires a bearer secret.
- Headers: CSP, HSTS (prod), `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, `Cache-Control: private, no-store` on authenticated pages.

## 6. Routes

| Area | Route | Notes |
|---|---|---|
| Public | `/login`, `/invite/[token]`, `/apply`, `/apply/thanks` | |
| Resident | `/home`, `/pay`, `/pay/sandbox/[id]` (mock only), `/pay/return`, `/payments`, `/documents`, `/notifications`, `/profile` | bottom tab bar on phones |
| Shared | `/receipts/[paymentId]` | owner or the paying resident; printable |
| Admin | `/admin`, `/admin/properties(/[id])`, `/admin/residents(/new, /[id])`, `/admin/applications(/[id])`, `/admin/payments`, `/admin/reports`, `/admin/notifications`, `/admin/settings`, `/admin/audit` | |
| API | `POST /api/webhooks/stripe`, `GET|POST /api/cron/rent`, `GET /api/documents/[id]`, `GET /api/health` | |
| PWA | `/manifest.webmanifest`, `/sw.js`, `/offline.html`, `/icons/*` | |

## 7. Notifications

`notify()` writes an in-app notification plus one `notification_deliveries` row per registered channel (`src/lib/notify.ts`). Dedupe keys make reminders fire once per due date.

**Push** is the registered channel today (`src/lib/push/`), dependency-free:
- **Web Push** — RFC 8291 `aes128gcm` payload encryption + RFC 8292 VAPID (ES256) signing, verified against the RFC 8291 test vector in `tests/unit/push.test.ts`. The service worker (`public/sw.js`) shows the notification, focuses/opens the linked page and re-subscribes on `pushsubscriptionchange`.
- **APNs** — HTTP/2 to `api.push.apple.com` with a cached ES256 provider token (.p8 key). The iOS shell forwards the device token to `POST /api/push/subscribe` via `NativePushBridge`.
- Devices live in `push_subscriptions` (CHECK constraint enforces the WEB vs APNS shape). Registration is idempotent (upsert by endpoint / token); sign-out, "turn sign-in off" and 410/`Unregistered` disable them; 5 consecutive failures disable them.
- Delivery: `notify()` queues `PENDING` PUSH rows and `scheduleDelivery()` drains them ~0.4s later (retry at 4s); `/api/cron/notify` is the backstop sweep. Rows are **claimed** by setting `attemptedAt` in a conditional update, so concurrent sweeps never double-send. No devices → `SKIPPED`. The app badge = unread count.
- Email/SMS: add a `ChannelAdapter` with a `send()` and register it — no other code changes.

Types: rent due soon / due today / overdue, payment succeeded / pending / failed / refunded, application received / status, maintenance updates, announcements, account.

## 8. PWA

Manifest with standard + maskable icons (generated from the brand mark), standalone display, shortcuts to *Pay rent* and *Payments*. The service worker caches only hashed static assets and an offline page; **financial pages are never served from cache**.

## 9. Documents

Stored outside `public/` (`STORAGE_DIR`) with random keys; type verified by magic bytes (PDF/JPEG/PNG/WEBP/HEIC), 10 MB max; served only through `/api/documents/[id]` after an ownership check, with a sandboxing CSP. The UI asks staff to record *what was verified* for IDs rather than ID numbers. Swap `LocalDiskStorage` for S3/R2/Supabase Storage via `StorageProvider`.

## 10. Maintenance requests

```
Resident: Report a problem ──▶ SUBMITTED ──▶ ACKNOWLEDGED ──▶ SCHEDULED ──▶ IN_PROGRESS ──▶ COMPLETED
          (photos, urgency,        │              │               │              │              │
           OK-to-enter)            └──────────────┴───────────────┴──────────────┴──▶ CANCELED   └─▶ reopen (14 days)
```

- Tables: `maintenance_requests` (property/room captured at submission so history survives transfers), `maintenance_updates` (append-only timeline: comments + status changes, `internal` = staff-only), `maintenance_photos`.
- DB rules: `completed_at`/`canceled_at` must match status, SCHEDULED needs a visit time, only staff can write internal notes, timeline can't be edited, nothing is hard-deleted.
- Residents: submit (active residents only, 3 photos max, images verified by magic bytes), message, cancel before work starts, reopen within 14 days. Only their own requests/photos are reachable (404 otherwise); staff-only notes are never queried for residents.
- Staff: queue sorted urgent → oldest; status/priority/visit time (entered in business time, stored UTC)/assignee/notes/photos in one update. Every change is audited; residents are notified of anything they can see; admins are notified of new requests (URGENT flagged), resident messages, cancels and reopens.
- Routes: `/maintenance`, `/maintenance/new`, `/maintenance/[id]`, `/admin/maintenance`, `/admin/maintenance/[id]`, `GET /api/maintenance-photos/[id]`.
