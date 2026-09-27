import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Checkbox, Disclosure, Hidden, Input, MoneyInput, Select, SubmitButton, Textarea } from "@/components/form";
import {
  Badge,
  BackLink,
  Card,
  DefinitionList,
  DemoTag,
  EmptyState,
  Money,
  PageHeader,
  PaymentStatusBadge,
  MaintenanceStatusBadge,
  PriorityBadge,
  RentStatusBadge,
  RunningBalance,
  Stat,
  TableWrap,
} from "@/components/ui";
import { dateOnlyFromDbDate, formatLong, formatShort } from "@/domain/dates";
import { LEDGER_TYPE_LABELS, withRunningBalance } from "@/domain/ledger";
import { centsToInput } from "@/domain/money";
import { PAYMENT_METHOD_LABELS } from "@/domain/payments";
import { requirePagePermission } from "@/lib/auth/session";
import { formatDateTime, paymentDate } from "@/lib/format";
import { getPaymentProvider } from "@/lib/payments";
import { businessToday, getSettings } from "@/lib/settings";
import { residentProfile } from "@/server/queries";
import { assignableRooms } from "@/server/rooms-query";
import {
  addDocumentAction,
  addLedgerEntryAction,
  archiveDocumentAction,
  changeRentAction,
  moveOutAction,
  recordOfflinePaymentAction,
  refundPaymentAction,
  reissueInviteAction,
  simulateAchAction,
  transferRoomAction,
  updateResidentAction,
} from "@/app/actions/admin";
import { OfflinePaymentFields } from "@/components/offline-payment-fields";

export const metadata: Metadata = { title: "Resident" };
export const dynamic = "force-dynamic";

const DOC_KIND = { HOUSING_AGREEMENT: "Housing agreement", ID_REFERENCE: "ID / reference", OTHER: "Other" } as const;

export default async function ResidentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("residents:read");
  const { id } = await params;
  const settings = await getSettings();
  const today = businessToday(settings);
  const data = await residentProfile(id, today);
  if (!data) notFound();
  const { resident: r, row, audits } = data;
  const rooms = await assignableRooms();
  const active = r.status === "ACTIVE";
  const current = r.assignments.find((a) => a.endDate === null);
  const schedule = r.rentSchedules.find((s) => s.endDate === null);
  const ledger = withRunningBalance(
    r.ledgerEntries.map((e) => ({
      id: e.id,
      type: e.type,
      amountCents: e.amountCents,
      effectiveDate: dateOnlyFromDbDate(e.effectiveDate),
      dueDate: e.dueDate ? dateOnlyFromDbDate(e.dueDate) : null,
      createdAt: e.createdAt,
      description: e.description,
    })),
  ).reverse();
  const totalPaid = r.payments.filter((p) => p.status === "SUCCEEDED").reduce((s, p) => s + p.amountCents, 0);
  const sandbox = getPaymentProvider().name === "MOCK";

  return (
    <>
      <BackLink href="/admin/residents">Residents</BackLink>
      <PageHeader
        eyebrow={current ? `${current.room.property.name} · ${current.room.name}` : r.status === "MOVED_OUT" ? "Moved out" : "No room assigned"}
        title={`${r.firstName} ${r.lastName}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <RentStatusBadge status={row.position.status} />
            {r.status === "MOVED_OUT" ? <Badge>Moved out</Badge> : <Badge tone="ok">Active resident</Badge>}
            {r.user?.status === "INVITED" ? <Badge tone="warn">Account not set up</Badge> : null}
            {r.isDemo ? <DemoTag /> : null}
          </span>
        }
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Financial summary">
        <Stat label="Current balance" value={<Money cents={row.position.balanceCents} />} tone={row.position.status === "OVERDUE" ? "bad" : undefined} />
        <Stat
          label={row.position.status === "PAID" ? "Next rent due" : "Oldest unpaid due"}
          value={row.position.nextDueDate ? formatShort(row.position.nextDueDate) : "—"}
          sub={row.position.status === "OVERDUE" ? `${row.position.daysOverdue} days overdue` : undefined}
        />
        <Stat label="Outstanding (past due)" value={<Money cents={row.position.pastDueCents} />} tone={row.position.pastDueCents > 0 ? "warn" : undefined} />
        <Stat label="Total paid" value={<Money cents={totalPaid} />} tone="ok" />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Personal information">
              <DefinitionList
                items={[
                  ["Phone", <a key="p" href={`tel:${r.phone}`}>{r.phone}</a>],
                  ["Email", <a key="e" href={`mailto:${r.email}`}>{r.email}</a>],
                  ["Emergency contact", r.emergencyContactName ? `${r.emergencyContactName}${r.emergencyContactRelation ? ` (${r.emergencyContactRelation})` : ""}` : null],
                  ["Emergency phone", r.emergencyContactPhone],
                ]}
              />
              {r.notes ? <p className="mt-4 rounded-lg bg-paper-2 p-3 text-sm">{r.notes}</p> : null}
            </Card>
            <Card title="Housing">
              <DefinitionList
                items={[
                  ["Property", current?.room.property.name ?? null],
                  ["Room", current?.room.name ?? null],
                  ["Move-in date", formatLong(dateOnlyFromDbDate(r.moveInDate))],
                  ["Move-out date", r.moveOutDate ? formatLong(dateOnlyFromDbDate(r.moveOutDate)) : null],
                  ["Monthly rent", schedule ? <Money key="m" cents={schedule.monthlyRentCents} /> : null],
                  ["Rent due day", schedule ? `Day ${schedule.dueDay}` : null],
                ]}
              />
              {r.application ? (
                <Link href={`/admin/applications/${r.application.id}`} className="mt-4 inline-block text-sm font-bold">
                  View original application
                </Link>
              ) : null}
            </Card>
          </div>

          <Card title="Payment history">
            {r.payments.length === 0 ? (
              <EmptyState title="No payments yet" icon="receipt" />
            ) : (
              <TableWrap>
                <table className="table min-w-[44rem]">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="text-right">Amount</th>
                      <th>Method</th>
                      <th>Status</th>
                      <th>Receipt / reference</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {r.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="whitespace-nowrap">{formatShort(paymentDate(p, settings.timezone))}</td>
                        <td className="text-right font-semibold tabular-nums">
                          <Money cents={p.amountCents} />
                        </td>
                        <td>{PAYMENT_METHOD_LABELS[p.method]}</td>
                        <td>
                          <PaymentStatusBadge status={p.status} />
                          {p.failureReason ? <span className="block text-xs text-bad">{p.failureReason}</span> : null}
                        </td>
                        <td>
                          <span className="font-mono text-xs">{p.receiptNumber}</span>
                          {p.reference ? <span className="block text-xs text-muted">{p.reference}</span> : null}
                        </td>
                        <td className="min-w-40 text-right">
                          {p.status !== "PENDING" && p.status !== "CANCELED" ? (
                            <Link href={`/receipts/${p.id}`} className="text-sm font-bold">
                              Receipt
                            </Link>
                          ) : null}
                          {p.status === "SUCCEEDED" ? (
                            <Disclosure summary={<span className="text-sm">Refund</span>}>
                              <ActionForm action={refundPaymentAction} className="space-y-3 text-left">
                                <Hidden name="paymentId" value={p.id} />
                                <Input name="reason" label="Reason" required />
                                <Checkbox name="confirm" label={`Refund the full ${centsToInput(p.amountCents)}`} hint="Adds a refund entry to the ledger; the balance goes back up." />
                                <SubmitButton small variant="danger">
                                  Refund payment
                                </SubmitButton>
                              </ActionForm>
                            </Disclosure>
                          ) : null}
                          {p.status === "PROCESSING" && sandbox && p.provider === "MOCK" ? (
                            <div className="mt-1 flex justify-end gap-2">
                              <ActionForm action={simulateAchAction}>
                                <Hidden name="paymentId" value={p.id} />
                                <Hidden name="result" value="cleared" />
                                <SubmitButton small variant="secondary">
                                  ACH clears
                                </SubmitButton>
                              </ActionForm>
                              <ActionForm action={simulateAchAction}>
                                <Hidden name="paymentId" value={p.id} />
                                <Hidden name="result" value="returned" />
                                <SubmitButton small variant="danger">
                                  ACH returns
                                </SubmitButton>
                              </ActionForm>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <Card title="Ledger" action={<span className="text-sm text-muted">Newest first · append-only</span>}>
            {ledger.length === 0 ? (
              <EmptyState title="No ledger activity" icon="receipt" />
            ) : (
              <TableWrap>
                <table className="table min-w-[40rem]">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Description</th>
                      <th className="text-right">Amount</th>
                      <th className="text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((l) => (
                      <tr key={l.id}>
                        <td className="whitespace-nowrap">{formatShort(l.effectiveDate)}</td>
                        <td>{LEDGER_TYPE_LABELS[l.type]}</td>
                        <td className="text-sm">{l.description}</td>
                        <td className={`text-right font-semibold tabular-nums ${l.amountCents < 0 ? "text-ok" : ""}`}>
                          <Money cents={l.amountCents} signed />
                        </td>
                        <td className="text-right tabular-nums">
                          <RunningBalance cents={l.runningBalanceCents} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <Card title="Repair requests" action={<Link href={`/admin/maintenance?q=${encodeURIComponent(r.lastName)}&status=ALL`} className="text-sm font-bold">All</Link>}>
            {r.maintenance.length === 0 ? (
              <p className="text-muted">No repair requests.</p>
            ) : (
              <ul className="divide-y divide-line">
                {r.maintenance.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <Link href={`/admin/maintenance/${m.id}`} className="font-bold">
                      {m.title}
                    </Link>
                    <span className="flex items-center gap-2">
                      {m.priority === "URGENT" ? <PriorityBadge priority="URGENT" /> : null}
                      <MaintenanceStatusBadge status={m.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Documents">
            {r.documents.length === 0 ? (
              <p className="mb-4 text-muted">No documents yet.</p>
            ) : (
              <ul className="mb-4 divide-y divide-line">
                {r.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-bold">{d.title}</p>
                      <p className="text-sm text-muted">
                        {DOC_KIND[d.kind]} · {d.visibleToResident ? "Visible to resident" : "Staff only"}
                        {d.referenceNote ? ` · ${d.referenceNote}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {d.storageKey ? (
                        <a href={`/api/documents/${d.id}`} target="_blank" rel="noopener" className="btn-secondary btn-sm">
                          Open
                        </a>
                      ) : null}
                      <ActionForm action={archiveDocumentAction}>
                        <Hidden name="documentId" value={d.id} />
                        <SubmitButton small variant="secondary">
                          Remove
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Disclosure summary="Add a document">
              <ActionForm action={addDocumentAction} className="space-y-3" resetOnSuccess>
                <Hidden name="residentId" value={r.id} />
                <Select
                  name="kind"
                  label="Type"
                  defaultValue="HOUSING_AGREEMENT"
                  options={[
                    { value: "HOUSING_AGREEMENT", label: "Housing agreement" },
                    { value: "ID_REFERENCE", label: "ID / document reference" },
                    { value: "OTHER", label: "Other" },
                  ]}
                />
                <Input name="title" label="Title" required />
                <div>
                  <label htmlFor="doc-file" className="label">
                    File (PDF or image, up to 10 MB)
                  </label>
                  <input id="doc-file" type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" className="input py-2" />
                </div>
                <Input name="referenceNote" label="Reference note" hint="For ID references, note what was verified (e.g. “TX ID checked 10/1”). Don't type ID numbers." />
                <Checkbox name="visibleToResident" label="Resident can see this document" defaultChecked />
                <SubmitButton small>Add document</SubmitButton>
              </ActionForm>
            </Disclosure>
          </Card>
        </div>

        <aside className="min-w-0 space-y-3" aria-label="Actions">
          <h2 className="text-2xl">Actions</h2>
          <Disclosure summary="Record offline payment" defaultOpen={row.position.balanceCents > 0}>
            <ActionForm action={recordOfflinePaymentAction} className="space-y-3" resetOnSuccess linkResult={{ key: "receiptUrl", label: "Open receipt" }}>
              <Hidden name="residentId" value={r.id} />
              <OfflinePaymentFields today={today} defaultAmount={row.position.balanceCents > 0 ? centsToInput(row.position.balanceCents) : undefined} />
              <SubmitButton small>Record payment</SubmitButton>
            </ActionForm>
          </Disclosure>

          <Disclosure summary="Add charge, credit or adjustment">
            <ActionForm action={addLedgerEntryAction} className="space-y-3" resetOnSuccess>
              <Hidden name="residentId" value={r.id} />
              <Select
                name="kind"
                label="Entry type"
                defaultValue="OTHER_CHARGE"
                options={[
                  { value: "OTHER_CHARGE", label: "Charge (adds to balance)" },
                  { value: "LATE_FEE", label: "Late fee (adds to balance)" },
                  { value: "CREDIT", label: "Credit (reduces balance)" },
                  { value: "ADJUSTMENT_UP", label: "Adjustment — increase balance" },
                  { value: "ADJUSTMENT_DOWN", label: "Adjustment — decrease balance" },
                ]}
              />
              <MoneyInput name="amount" label="Amount" required />
              <Input name="effectiveDate" type="date" label="Date" defaultValue={today} required />
              <Input name="description" label="Description" placeholder="e.g. Replacement key" required />
              <SubmitButton small>Post to ledger</SubmitButton>
            </ActionForm>
          </Disclosure>

          {active ? (
            <>
              <Disclosure summary="Edit resident">
                <ActionForm action={updateResidentAction} className="space-y-3" resetKey={r.updatedAt.toISOString()}>
                  <Hidden name="residentId" value={r.id} />
                  <Input name="firstName" label="First name" defaultValue={r.firstName} required />
                  <Input name="lastName" label="Last name" defaultValue={r.lastName} required />
                  <Input name="email" type="email" label="Email (sign-in)" defaultValue={r.email} required />
                  <Input name="phone" type="tel" label="Phone" defaultValue={r.phone} required />
                  <Input name="emergencyContactName" label="Emergency contact" defaultValue={r.emergencyContactName} />
                  <Input name="emergencyContactPhone" type="tel" label="Emergency phone" defaultValue={r.emergencyContactPhone} />
                  <Input name="emergencyContactRelation" label="Relationship" defaultValue={r.emergencyContactRelation} />
                  <Textarea name="notes" label="Internal notes" defaultValue={r.notes} />
                  <SubmitButton small>Save changes</SubmitButton>
                </ActionForm>
              </Disclosure>

              <Disclosure summary={current ? "Transfer room" : "Assign room"}>
                <ActionForm action={transferRoomAction} className="space-y-3">
                  <Hidden name="residentId" value={r.id} />
                  <Select
                    name="roomId"
                    label="New room"
                    placeholder="Choose an available room"
                    options={rooms.map((x) => ({ value: x.id, label: `${x.propertyName} · ${x.name}` }))}
                    required
                  />
                  <Input name="effectiveDate" type="date" label="Transfer date" defaultValue={today} required />
                  <Input name="reason" label="Reason" />
                  <p className="text-sm text-muted">Rent stays the same — use “Change rent” if the new room costs more or less.</p>
                  <SubmitButton small>Save transfer</SubmitButton>
                </ActionForm>
              </Disclosure>

              <Disclosure summary="Change rent">
                <ActionForm action={changeRentAction} className="space-y-3" resetKey={schedule?.id ?? "none"}>
                  <Hidden name="residentId" value={r.id} />
                  <MoneyInput name="monthlyRent" label="New monthly rent" defaultValue={schedule ? centsToInput(schedule.monthlyRentCents) : undefined} required />
                  <Input name="dueDay" type="number" inputMode="numeric" min={1} max={28} label="Rent due day" defaultValue={schedule?.dueDay ?? 1} required />
                  <Input name="effectiveDate" type="date" label="Effective from" required hint="Rent already posted for the current month isn't changed; add an adjustment if needed." />
                  <Input name="reason" label="Reason" />
                  <SubmitButton small>Update rent</SubmitButton>
                </ActionForm>
              </Disclosure>

              {r.user?.status === "INVITED" ? (
                <Disclosure summary="Account setup link">
                  <ActionForm action={reissueInviteAction} copyResult={{ key: "inviteUrl", label: "New setup link" }}>
                    <Hidden name="residentId" value={r.id} />
                    <p className="mb-3 text-sm text-muted">The resident hasn’t set a password yet. Create a fresh link to text or email them.</p>
                    <SubmitButton small variant="secondary">
                      Create new setup link
                    </SubmitButton>
                  </ActionForm>
                </Disclosure>
              ) : null}

              <Disclosure summary={<span className="text-bad">Move resident out</span>}>
                <ActionForm action={moveOutAction} className="space-y-3">
                  <Hidden name="residentId" value={r.id} />
                  <Input name="moveOutDate" type="date" label="Move-out date" defaultValue={today} required />
                  <Input name="reason" label="Reason / notes" />
                  <Checkbox name="confirm" label="Confirm move-out" hint="Frees the room and stops future rent. Rent posted for after this date is reversed. Payment and ledger history is kept." />
                  <SubmitButton small variant="danger">
                    Move out
                  </SubmitButton>
                </ActionForm>
              </Disclosure>
            </>
          ) : null}

          <Card title="Activity" className="mt-4">
            {audits.length === 0 ? (
              <p className="text-muted">No activity recorded.</p>
            ) : (
              <ol className="space-y-3 text-sm">
                {audits.map((a) => (
                  <li key={a.id}>
                    <p className="font-bold">{a.action.replace(/[._]/g, " ")}</p>
                    <p className="text-muted">
                      {a.actorEmail ?? "system"} · {formatDateTime(a.createdAt, settings.timezone)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
