-- Cash App Pay (via Stripe Checkout) as an online payment method.
ALTER TYPE "PaymentMethodType" ADD VALUE IF NOT EXISTS 'CASH_APP';
