# App Store & PWA listing kit — Legacy Independent Living

Everything needed to fill in App Store Connect (and the PWA install sheet).

## Screenshots

| Folder | Pixel size | App Store Connect slot | Required? |
|---|---|---|---|
| `iphone-6.9/` | 1320 × 2868 | iPhone 6.9" Display | **Yes** (used for all newer iPhones) |
| `iphone-6.5/` | 1242 × 2688 | iPhone 6.5" Display | Optional — covers older iPhones if you want exact art |
| `ipad-13/` | 2064 × 2752 | iPad 13" Display | **Yes** if the app runs on iPad |
| `pwa-narrow/`, `pwa-wide/` | 1080 × 2340 / 1920 × 1080 | Web manifest (`/manifest.webmanifest`) | Already wired in — shows in Chrome's install sheet |

Each device folder has:
- `captioned/` — branded marketing screenshots (headline + app screen). **Upload these.**
- `raw/` — the plain app screen at the same size, if you prefer no captions.

All files are portrait PNG, RGB (no transparency), exact sizes — App Store Connect accepts them as-is.
Upload order = file number (01 first). Apple shows the first 3 in search results, so 01–03 are the strongest.
Demo labels and sandbox notes are hidden; names in shots are fictional demo data.

Regenerate anytime (e.g. after UI changes): push a commit whose message contains `[store-screenshots]` —
CI re-seeds demo data, captures every device, and commits the results. List of shots: [`INDEX.md`](INDEX.md).

## Listing text

**App name** (30 max): `Legacy Independent Living`

**Subtitle** (30 max): `Pay rent. Request repairs.`

**Promotional text** (170 max):
> Your Legacy home in your pocket — see what's due, pay rent by card, Cash App Pay or bank in seconds, get instant receipts, and report repairs with a photo.

**Description**:
> The official app for residents and owners of Legacy Independent Living homes in Houston.
>
> FOR RESIDENTS
> • See your current balance and next due date the moment you open the app
> • Pay rent in seconds with a debit or credit card, Cash App Pay, or your bank account
> • Get an instant receipt for every payment, ready to print or save
> • View your full payment history and account activity
> • Report a repair with photos and follow it from request to done
> • Get notified when rent is due, when a payment goes through, and when a repair is scheduled
> • Find your housing agreement and documents in one place
>
> FOR OWNERS
> • Live dashboard: occupancy, rent due, collected, outstanding and overdue
> • Visual room-by-room occupancy board for every home
> • Complete resident profiles with an auditable ledger
> • Application pipeline — approve and move someone in with a few taps
> • Maintenance queue with scheduling and resident updates
> • Rent collection, occupancy and outstanding-balance reports
>
> Payments are processed securely by Stripe. Legacy never sees or stores your card, Cash App or bank details.
> An account is provided by Legacy Independent Living when you move in.

**Keywords** (100 max, comma-separated, no spaces):
`rent,pay rent,housing,residents,tenant,landlord,maintenance,repair,receipts,Houston,veterans,room`

**Category**: Primary `Lifestyle` · Secondary `Finance`

**Support URL**: `https://legacyindependentliving.net/contact/`
**Marketing URL**: `https://legacyindependentliving.net`
**Privacy Policy URL**: `https://portal.legacyindependentliving.net/privacy` (built into the portal — review the wording before submitting).

## App Review — sign-in + notes

**1. Create the review account (once; re-run any time to reset its password):**
```bash
REVIEW_PASSWORD='choose-a-long-password-1' npm run review:account     # via `railway run` against production
```
It creates `appreview@legacyindependentliving.net` in a clearly labelled **"App Review test home (not a real home)"** with $1.00/month rent and a $1.00 sample charge. It's tagged *Demo* and left out of your dashboard and report totals.

**2. App Store Connect → App Review Information:** Sign-in required ✓ — username `appreview@legacyindependentliving.net`, the password you chose. Contact: your name, (713) 482-9021, service@legacyindependentliving.net.

**3. Notes (paste as-is):**
> Legacy Independent Living provides rooms in shared homes in Houston, TX for veterans and people leaving homelessness. This app is for our existing residents and office staff: residents see what they owe, pay rent, get receipts, report repairs with photos and receive notifications. Accounts are created by our office when a resident moves in, so there is no public sign-up (prospective residents can apply at /apply from the login screen).
>
> Review account: a test resident in a test home (not a real property) with a $1.00 balance.
> • Pay rent: Home → Pay rent → choose card, Cash App Pay or bank account → Continue to secure checkout. Rent is payment for real-world housing, so it is processed by Stripe and not In-App Purchase (Guideline 3.1.5(a)). You may cancel on Stripe's page; if you complete it, $1.00 is charged and we refund it.
> • Repairs: Repairs → Report a problem → take or choose a photo (camera / photo library permission).
> • Notifications: Notifications → Turn on notifications → then "Send a test notification".
> • Account deletion: Profile → Delete my account (request is confirmed by the office; payment records are kept as required by law, as stated in the privacy policy).
> • Password change: Profile → Change password.

## App Privacy ("nutrition label") answers

Data linked to the user, used for App Functionality only, **not** used for tracking:
- Contact Info — name, email address, phone number
- Financial Info — payment info (amounts, dates, receipt numbers; card, Cash App and bank data handled by Stripe, not collected by the app)
- User Content — photos (repair requests), other user content (messages to the office)
- Identifiers — user ID

No third-party advertising, no tracking, no data sold.

## Before you submit — iOS build

Run `npm run ios:preflight` in `native/` right before archiving: it fails if the build points at the wrong server, the portal/privacy pages don't load, or a permission string / push entitlement is missing.

### iOS wrapper

The native shell is ready in `native/` (Capacitor 7, loads the production portal, native push via APNs, camera/photo permissions for repair photos). Build it with Claude Code in VS Code on a Mac by following `native/CLAUDE.md`. Guideline 4.2 (minimum functionality) is covered by sign-in, payments, repair requests with photos, and native push notifications.

Account deletion (Guideline 5.1.1(v)): residents can request deletion in **Profile → Delete my account**; staff are alerted, and records required for housing/financial law are retained as the privacy policy explains.
