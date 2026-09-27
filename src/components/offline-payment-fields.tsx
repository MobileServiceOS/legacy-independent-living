import { Input, MoneyInput, Select } from "./form";
import { OFFLINE_METHODS, PAYMENT_METHOD_LABELS } from "@/domain/payments";

/** Shared fields for recording cash / money order / check / external payments. */
export function OfflinePaymentFields({ today, defaultAmount }: { today: string; defaultAmount?: string }) {
  return (
    <>
      <MoneyInput name="amount" label="Amount" defaultValue={defaultAmount} required />
      <Input name="paidOn" type="date" label="Date received" defaultValue={today} max={today} required />
      <Select name="method" label="Payment method" defaultValue="CASH" options={OFFLINE_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
      <Input name="reference" label="Reference / note" placeholder="Money order #, check #, or who took the cash" required />
      <Input name="note" label="Additional note" />
      <p className="text-xs text-muted">Your name is recorded with this payment.</p>
    </>
  );
}
