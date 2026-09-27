import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { PushSettings, SignOutButton } from "@/components/push-controls";
import { ActionForm, Checkbox, Disclosure, Input, SubmitButton } from "@/components/form";
import { requestDeletionAction } from "@/app/actions/resident";
import { vapidConfig } from "@/lib/push";
import { Card, DefinitionList } from "@/components/ui";
import { dateOnlyFromDbDate, formatLong } from "@/domain/dates";
import { formatCents } from "@/domain/money";
import { requireResidentPage } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { logoutAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireResidentPage();
  const [r, settings] = await Promise.all([
    prisma.resident.findUniqueOrThrow({
      where: { id: user.residentId },
      include: {
        assignments: { orderBy: { startDate: "desc" }, take: 1, include: { room: { include: { property: true } } } },
        rentSchedules: { where: { endDate: null }, take: 1 },
      },
    }),
    getSettings(),
  ]);
  const a = r.assignments[0];
  const s = r.rentSchedules[0];
  return (
    <div className="space-y-5">
      <h1 className="text-4xl">Profile</h1>
      <Card title="Your information">
        <DefinitionList
          items={[
            ["Name", `${r.firstName} ${r.lastName}`],
            ["Email", r.email],
            ["Phone", r.phone],
            ["Emergency contact", r.emergencyContactName ? `${r.emergencyContactName}${r.emergencyContactRelation ? ` (${r.emergencyContactRelation})` : ""}${r.emergencyContactPhone ? ` · ${r.emergencyContactPhone}` : ""}` : null],
          ]}
        />
      </Card>
      <Card title="Your home">
        <DefinitionList
          items={[
            ["Home", a ? a.room.property.name : null],
            ["Room", a ? a.room.name : null],
            ["Address", a ? `${a.room.property.addressLine1}, ${a.room.property.city}, ${a.room.property.state}` : null],
            ["Move-in date", formatLong(dateOnlyFromDbDate(r.moveInDate))],
            ["Monthly rent", s ? formatCents(s.monthlyRentCents) : null],
            ["Rent due", s ? `Day ${s.dueDay} of each month` : null],
          ]}
        />
      </Card>
      <nav aria-label="More" className="card divide-y divide-line">
        <Link href="/documents" className="flex min-h-14 items-center justify-between px-5 font-bold no-underline">
          <span className="flex items-center gap-3">
            <Icon name="file" /> My documents
          </span>
          <Icon name="arrowRight" />
        </Link>
        <Link href="/maintenance" className="flex min-h-14 items-center justify-between px-5 font-bold no-underline">
          <span className="flex items-center gap-3">
            <Icon name="wrench" /> Repair requests
          </span>
          <Icon name="arrowRight" />
        </Link>
      </nav>
      <p className="text-center text-sm text-muted">
        Need to update something? Contact the office{settings.supportPhone ? ` at ${settings.supportPhone}` : ""}.
      </p>
      <PushSettings vapidKey={vapidConfig()?.publicKey ?? null} />
      <SignOutButton action={logoutAction} className="btn-secondary w-full" />
      <Disclosure summary={<span className="text-muted">Delete my account</span>}>
        <ActionForm action={requestDeletionAction} className="space-y-3">
          <p className="text-sm text-muted">
            We’ll remove your account and personal details. Payment and rent records are kept as the law requires. The office will contact you to confirm
            {settings.supportPhone ? ` (${settings.supportPhone})` : ""}.
          </p>
          <Input name="reason" label="Reason (optional)" />
          <Checkbox name="confirm" label="Yes, I want my account deleted" />
          <SubmitButton small variant="danger">
            Request account deletion
          </SubmitButton>
        </ActionForm>
      </Disclosure>
      <p className="text-center text-sm">
        <Link href="/privacy">Privacy policy</Link>
      </p>
    </div>
  );
}
