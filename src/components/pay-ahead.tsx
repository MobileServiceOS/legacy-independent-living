"use client";
/**
 * Amount picker for the resident "Pay rent" form. Lets a resident either pay
 * (part of) what's currently due, or pay ahead — current balance plus N
 * months of future rent, prepaid in one payment. The prepaid amount is
 * banked as a ledger credit and applies automatically as future rent posts.
 */
import { useState } from "react";
import { Hidden, MoneyInput } from "./form";
import { centsToInput, formatCents } from "@/domain/money";

export function PayAheadAmount({
  payableCents,
  monthlyRentCents,
  maxMonths,
  allowPartialPayments,
  minPartialPaymentCents,
}: {
  payableCents: number;
  monthlyRentCents: number;
  maxMonths: number;
  allowPartialPayments: boolean;
  minPartialPaymentCents: number;
}) {
  const [months, setMonths] = useState(0);
  const canPayAhead = monthlyRentCents > 0 && maxMonths > 0;
  const total = Math.max(payableCents, 0) + months * monthlyRentCents;

  return (
    <div className="space-y-4">
      {canPayAhead ? (
        <div>
          <p className="mb-2 text-sm font-extrabold uppercase tracking-wider text-muted">Want to get ahead on rent?</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Months of rent to prepay">
            {Array.from({ length: maxMonths + 1 }, (_, m) => m).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={months === m}
                onClick={() => setMonths(m)}
                className={`min-h-11 rounded-full border-2 px-4 text-sm font-bold transition-colors ${
                  months === m ? "border-forest bg-forest text-white" : "border-line bg-paper-2 text-ink hover:border-forest"
                }`}
              >
                {m === 0 ? "Just what's due" : `+${m} month${m > 1 ? "s" : ""} ahead`}
              </button>
            ))}
          </div>
          {months > 0 ? (
            <p className="mt-2 rounded-xl bg-paper-2 px-4 py-3 text-[0.95rem]">
              Pays {payableCents > 0 ? `your current balance of ${formatCents(payableCents)} plus ` : ""}
              {months} month{months > 1 ? "s" : ""} of rent ahead ({formatCents(monthlyRentCents)}/mo) —{" "}
              <strong>total {formatCents(total)}</strong>.
            </p>
          ) : null}
        </div>
      ) : null}

      {months > 0 ? (
        <Hidden name="amount" value={centsToInput(total)} />
      ) : allowPartialPayments ? (
        <MoneyInput
          name="amount"
          label="How much would you like to pay?"
          defaultValue={centsToInput(Math.max(payableCents, 0))}
          hint={`Full balance is ${formatCents(payableCents)}. You can pay part of it (at least ${formatCents(Math.min(minPartialPaymentCents, payableCents))}).`}
          required
        />
      ) : (
        <Hidden name="amount" value={centsToInput(Math.max(payableCents, 0))} />
      )}
    </div>
  );
}
