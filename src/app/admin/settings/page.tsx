import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Checkbox, Input, MoneyInput, SubmitButton } from "@/components/form";
import { Card, Notice, PageHeader } from "@/components/ui";
import { centsToInput } from "@/domain/money";
import { requirePagePermission } from "@/lib/auth/session";
import { paymentsStatus } from "@/lib/payments";
import { businessToday, getSettings } from "@/lib/settings";
import { runRentEngineAction, updateSettingsAction } from "@/app/actions/admin";
import { ChangePasswordForm } from "@/components/change-password";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const me = await requirePagePermission("settings:write");
  const s = await getSettings();
  const payments = paymentsStatus();
  const provider = payments.configured ? payments.provider : null;
  return (
    <>
      <PageHeader title="Settings" actions={<Link href="/admin/audit" className="btn-secondary btn-sm">Audit log</Link>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <Card title="Rent & payment rules">
          <ActionForm action={updateSettingsAction} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input name="businessName" label="Business name" defaultValue={s.businessName} required />
              <Input name="timezone" label="Timezone" defaultValue={s.timezone} hint="Houston: America/Chicago" required />
              <Input name="supportPhone" type="tel" label="Office phone (shown to residents)" defaultValue={s.supportPhone} />
              <Input name="supportEmail" type="email" label="Office email (shown to residents)" defaultValue={s.supportEmail} />
            </div>
            <fieldset className="space-y-4 rounded-xl border border-line p-4">
              <legend className="px-1 font-bold">Rent schedule</legend>
              <div className="grid gap-4 sm:grid-cols-3">
                <Input name="chargeLeadDays" type="number" inputMode="numeric" min={0} max={28} label="Post rent this many days early" defaultValue={s.chargeLeadDays} hint="Also the “Due soon” window." required />
                <Input name="graceDays" type="number" inputMode="numeric" min={0} max={28} label="Grace days before late fee" defaultValue={s.graceDays} required />
                <MoneyInput name="lateFee" label="Late fee" defaultValue={centsToInput(s.lateFeeCents)} hint="0 = no automatic late fees" />
              </div>
            </fieldset>
            <fieldset className="space-y-3 rounded-xl border border-line p-4">
              <legend className="px-1 font-bold">Online payments</legend>
              <Checkbox name="onlinePaymentsEnabled" label="Residents can pay online" defaultChecked={s.onlinePaymentsEnabled} />
              <Checkbox name="allowPartialPayments" label="Allow partial payments" defaultChecked={s.allowPartialPayments} />
              <div className="max-w-xs">
                <MoneyInput name="minPartialPayment" label="Minimum partial payment" defaultValue={centsToInput(s.minPartialPaymentCents)} />
              </div>
            </fieldset>
            <SubmitButton>Save settings</SubmitButton>
          </ActionForm>
        </Card>
        <div className="min-w-0 space-y-6">
          <Card title="Payment processor">
            {!provider ? (
              <Notice tone="bad" title="Online payments aren’t set up">
                Residents are asked to pay the office; offline payments work normally. {payments.configured ? null : payments.reason}{" "}
                See <code>docs/DEPLOYMENT.md</code> §6.
              </Notice>
            ) : provider.name === "MOCK" ? (
              <Notice tone="warn" title="Sandbox (demo) mode">
                No real money moves. Set <code>PAYMENTS_PROVIDER=paypal</code> with your PayPal API credentials to accept real payments.
              </Notice>
            ) : provider.isSandbox ? (
              <Notice tone="warn" title={`${provider.name === "PAYPAL" ? "PayPal" : "Stripe"} sandbox`}>
                Using test credentials — no real money moves. Switch to live credentials to accept real payments.
              </Notice>
            ) : (
              <Notice tone="ok" title={provider.name === "PAYPAL" ? "PayPal (live)" : "Stripe (live)"}>
                Residents pay on {provider.name === "PAYPAL" ? "PayPal" : "Stripe"}’s secure page. Card and bank details never touch this app.
              </Notice>
            )}
          </Card>
          <Card title="Your sign-in">
            <p className="mb-3 text-sm text-muted">
              Signed in as <strong>{me.email}</strong>. Changing your password signs you out everywhere else.
            </p>
            <ChangePasswordForm />
          </Card>
          <Card title="Rent engine">
            <p className="mb-3 text-sm text-muted">
              Posts rent and late fees and sends reminders. It runs daily via the scheduled job and on first dashboard load each day. Safe to run any time — it never double-charges. Today is {businessToday(s)}.
            </p>
            <ActionForm action={runRentEngineAction}>
              <SubmitButton variant="secondary" pendingText="Running…">
                Run rent engine now
              </SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
