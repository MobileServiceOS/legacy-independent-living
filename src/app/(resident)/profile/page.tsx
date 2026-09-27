import type { Metadata } from "next";
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
      <p className="text-center text-sm text-muted">
        Need to update something? Contact the office{settings.supportPhone ? ` at ${settings.supportPhone}` : ""}.
      </p>
      <form action={logoutAction}>
        <button type="submit" className="btn-secondary w-full">
          Sign out
        </button>
      </form>
    </div>
  );
}
