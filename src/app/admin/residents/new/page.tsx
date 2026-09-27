import type { Metadata } from "next";
import { PlacementForm } from "@/components/placement-form";
import { BackLink, Card, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/session";
import { businessToday, getSettings } from "@/lib/settings";
import { assignableRooms } from "@/server/rooms-query";

export const metadata: Metadata = { title: "Add resident" };
export const dynamic = "force-dynamic";

export default async function NewResidentPage({ searchParams }: { searchParams: Promise<{ roomId?: string }> }) {
  await requirePagePermission("residents:write");
  const { roomId } = await searchParams;
  const [rooms, settings] = await Promise.all([assignableRooms(), getSettings()]);
  return (
    <>
      <BackLink href="/admin/residents">Residents</BackLink>
      <PageHeader title="Add a resident" description="For someone moving in without an online application. Applicants are converted from the Applications page." />
      <Card>
        <PlacementForm rooms={rooms} defaults={{ roomId }} today={businessToday(settings)} />
      </Card>
    </>
  );
}
