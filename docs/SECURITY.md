# Security — Legacy Independent Living portal + iOS app

What protects residents' money and data, and how each piece is verified. Every item marked **(tested)** has an automated test that runs on every push.

## Payments
- **No card or bank data ever touches our servers.** Residents pay on PayPal's hosted page; we store only PayPal's order/capture ids, amount and a receipt number. A database CHECK constraint rejects anything that looks like a card number in `last4`. **(tested)**
- **The server decides the amount.** The resident's browser never sends a price that is trusted: the server computes the balance, validates partial-payment rules and creates the PayPal order itself with our credentials. **(tested)**
- **Server-side capture.** Money is captured by our server when the resident returns from PayPal, not by the browser. Refreshing or replaying the return URL is harmless (idempotent). **(tested)**
- **Webhooks are verified** with PayPal's `verify-webhook-signature` API against our webhook id, from a PayPal-owned certificate host only; replays are de-duplicated by event id. **(tested)**
- **Every processor event must match the payment it names** — same PayPal order (or capture), exact amount in cents, USD. This stops a buyer from creating their own cheap PayPal order carrying our payment id and having the verified webhook mark a full rent payment as paid. Mismatches are ignored, audited (`payment.event_mismatch`) and flagged to the owner. **(tested: 4 spoof variants)**
- **Append-only ledger.** Ledger rows can't be edited or deleted — enforced by database triggers, not just app code. Balances are always a sum of entries in integer cents. **(tested)**
- Sandbox (mock) payments are refused in production; without PayPal keys the portal runs with online payments off.

## Accounts & sessions
- Passwords hashed with **scrypt**; minimum 10 characters with a letter and a number. Session tokens are random 256-bit values stored only as SHA-256 hashes. Cookies: `HttpOnly`, `Secure`, `SameSite=Lax`.
- **Rate limits:** sign-in per IP+email and per account across all IPs; password change, invites, payments, repairs and push also limited. The client IP is read from the proxy-appended `X-Forwarded-For` entry so it can't be forged (`TRUSTED_PROXY_HOPS`). **(tested)**
- No user enumeration: identical message and constant work for unknown email vs wrong password.
- Change password requires the current password and signs out every other device; reset links are single-use, expire, and are voided by a password change or turning sign-in off. **(tested)**
- Role-based access on every page, action and API; residents can only ever read their own records, receipts, documents and photos. **(tested)**
- Audit log of every money movement, account change and admin action.

## Web & app hardening
- Content-Security-Policy (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, form posts only to self/PayPal), HSTS (2 years, preload), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, strict referrer policy, restrictive Permissions-Policy.
- Authenticated pages are `Cache-Control: private, no-store`.
- Server actions are origin-checked by Next.js; JSON APIs check `Origin` explicitly; cron endpoints require a bearer secret compared in constant time.
- Uploads: magic-byte file-type check (not the file name), 10 MB cap, stored outside the web root with random names, served only after an ownership check with `nosniff` and a sandboxing CSP.
- iOS app loads only our HTTPS portal plus PayPal's domains; no cleartext traffic; `npm run ios:preflight` blocks an archive that points anywhere else.
- CI fails the build on any **high/critical** vulnerability in production dependencies (`npm audit`).

## Operational checklist
- [ ] Owner password is unique and long; change it under **Settings → Your sign-in** after anyone else has seen it.
- [ ] `CRON_SECRET`, `PAYPAL_CLIENT_SECRET`, `VAPID_PRIVATE_KEY`, `APNS_PRIVATE_KEY` live only in Railway variables — never in the repo or chat.
- [ ] PayPal webhook configured (DEPLOYMENT.md §6) so payments settle even if a resident closes the app mid-checkout.
- [ ] Railway Postgres backups on (DEPLOYMENT.md §8).
- [ ] Review the audit log (Admin → Settings → Audit log) monthly; the owner is notified automatically of any payment mismatch.

## Reporting a problem
Email service@legacyindependentliving.net with "Security" in the subject.
