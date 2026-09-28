-- Let residents pay ahead of their current balance (future rent, paid in advance).
-- The overpayment becomes a ledger credit, applied automatically as future rent posts.
ALTER TABLE "settings" ADD COLUMN "allow_pay_ahead" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "settings" ADD COLUMN "max_pay_ahead_months" INTEGER NOT NULL DEFAULT 6;
