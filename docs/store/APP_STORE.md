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
> Your Legacy home in your pocket — see what's due, pay rent with PayPal in seconds, get instant receipts, and report repairs with a photo.

**Description**:
> The official app for residents and owners of Legacy Independent Living homes in Houston.
>
> FOR RESIDENTS
> • See your current balance and next due date the moment you open the app
> • Pay rent in seconds with PayPal — use your PayPal balance, bank, or a debit/credit card
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
> Payments are processed securely by PayPal. Legacy never sees or stores your card or bank details.
> An account is provided by Legacy Independent Living when you move in.

**Keywords** (100 max, comma-separated, no spaces):
`rent,pay rent,housing,residents,tenant,landlord,maintenance,repair,receipts,Houston,veterans,room`

**Category**: Primary `Lifestyle` · Secondary `Finance`

**Support URL**: `https://legacyindependentliving.net/contact/`
**Marketing URL**: `https://legacyindependentliving.net`
**Privacy Policy URL**: required — publish one (e.g. `https://legacyindependentliving.net/privacy/`) before submitting.

## App Review notes (paste into "Notes" + sign-in info)

- Sign-in required. Provide a **review account** (create a resident in the owner portal and set a password), plus an owner account if you want reviewers to see the owner side.
- Accounts are created by the housing provider; there is no public sign-up (explain this in the notes — it's allowed for apps serving existing customers).
- Rent is a payment for real-world housing, so PayPal (not in-app purchase) is correct under App Review Guideline 3.1.3(e)/3.1.5.

## App Privacy ("nutrition label") answers

Data linked to the user, used for App Functionality only, **not** used for tracking:
- Contact Info — name, email address, phone number
- Financial Info — payment info (amounts, dates, receipt numbers; card/bank data handled by PayPal, not collected by the app)
- User Content — photos (repair requests), other user content (messages to the office)
- Identifiers — user ID

No third-party advertising, no tracking, no data sold.

## Before you submit — iOS wrapper

This is a web app (PWA). To appear in the App Store it must ship inside a native shell (e.g. **Capacitor**) pointing at the production URL, and Apple expects app-like value beyond a website (Guideline 4.2). This app qualifies well — sign-in, payments, repairs with camera photos, notifications — and the native build should add **push notifications** and the **camera** plugin for repair photos to make that clear.
