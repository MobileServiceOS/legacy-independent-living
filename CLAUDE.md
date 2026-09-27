# Legacy Independent Living — Resident & Owner Portal

Next.js 15 (App Router) + TypeScript + Prisma/PostgreSQL + Tailwind v4. Installable PWA, wrapped for iOS with Capacitor in `native/`.
Read `README.md` and `docs/ARCHITECTURE.md` before larger changes.

## Commands
- `npm run dev` — local app (needs `.env` with `DATABASE_URL`; see `.env.example`)
- `npx prisma migrate deploy` then `npm run db:seed` — schema + demo data
- `npm run verify` — typecheck + lint + unit + DB + integration tests (DB tests need `psql` and a Postgres superuser URL in `TEST_DATABASE_ADMIN_URL`)
- `npm run test:e2e` — Playwright (builds, resets the DB, starts on :3100)
- `npm run db:check` — schema.prisma ↔ database drift check
- `npm run owner:create` / `npm run push:keys` — first owner account / VAPID keys

## Rules that must not be broken
- Money is integer cents. Never floats. Parse user input with `parseDollarsToCents`.
- Balances are derived from `ledger_entries` (append-only, DB-enforced). Correct mistakes with new entries.
- Business logic lives in `src/domain` (pure) and `src/server` (transactional services that audit). Pages/actions stay thin: authorize → validate (zod) → service → revalidate.
- Every admin mutation writes an audit record in the same transaction.
- Residents only ever see their own records — 404 (not 403) for anything else.
- New schema changes need a hand-written SQL migration in `prisma/migrations/NNNN_name/` and must pass `npm run db:check`.
- CI (`.github/workflows/portal-ci.yml`) must stay green. Commit messages with `[screenshots]` / `[store-screenshots]` regenerate images.

## iOS app
See `native/CLAUDE.md` — the step-by-step build for Xcode lives there.
