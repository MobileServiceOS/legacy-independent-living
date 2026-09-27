import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Disclosure, Hidden, Input, MoneyInput, Select, SubmitButton, Textarea } from "@/components/form";
import { PropertyForm } from "@/components/property-form";
import { BackLink, Card, DemoTag, Money, PageHeader, RentStatusBadge, RoomStatusBadge, Stat, TableWrap } from "@/components/ui";
import { centsToInput } from "@/domain/money";
import { ROOM_STATUS_LABELS, MANUAL_ROOM_STATUSES } from "@/domain/rooms";
import { requirePagePermission } from "@/lib/auth/session";
import { businessToday, getSettings } from "@/lib/settings";
import { propertiesOverview } from "@/server/queries";
import { saveRoomAction, setRoomStatusAction } from "@/app/actions/admin";

export const metadata: Metadata = { title: "Property" };
export const dynamic = "force-dynamic";

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("properties:read");
  const { id } = await params;
  const all = await propertiesOverview(businessToday(await getSettings()));
  const p = all.find((x) => x.id === id);
  if (!p) notFound();

  return (
    <>
      <BackLink href="/admin/properties">All properties</BackLink>
      <PageHeader
        title={p.name}
        description={
          <>
            {p.addressLine1}
            {p.addressLine2 ? `, ${p.addressLine2}` : ""}, {p.city}, {p.state} {p.postalCode}
            {p.isDemo ? <DemoTag /> : null}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Rooms" value={p.occupancy.totalRooms} />
        <Stat label="Occupied" value={p.occupancy.occupied} />
        <Stat label="Available" value={p.occupancy.available} tone="ok" />
        <Stat label="Residents" value={p.residentCount} />
        <Stat label="Expected / month" value={<Money cents={p.monthlyExpectedCents} />} />
      </div>

      <Card title="Rooms" className="mt-6">
        <TableWrap>
          <table className="table min-w-[48rem]">
            <thead>
              <tr>
                <th>Room</th>
                <th>Status</th>
                <th>Current resident</th>
                <th className="text-right">Monthly rent</th>
                <th>Manage</th>
              </tr>
            </thead>
            <tbody>
              {p.rooms.map((room) => (
                <tr key={room.id} id={`room-${room.id}`}>
                  <td className="font-bold">{room.name}</td>
                  <td>
                    <RoomStatusBadge status={room.status} />
                  </td>
                  <td>
                    {room.resident ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/residents/${room.resident.id}`} className="font-bold">
                          {room.resident.name}
                        </Link>
                        <RentStatusBadge status={room.resident.position.status} />
                      </span>
                    ) : room.status === "AVAILABLE" || room.status === "RESERVED" ? (
                      <Link href={`/admin/residents/new?roomId=${room.id}`} className="font-bold">
                        Place resident
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="text-right tabular-nums">
                    <Money cents={room.resident?.monthlyRentCents ?? room.defaultRentCents} />
                    {room.resident && room.resident.monthlyRentCents !== room.defaultRentCents ? (
                      <span className="block text-xs text-muted">
                        room rate <Money cents={room.defaultRentCents} />
                      </span>
                    ) : null}
                  </td>
                  <td className="min-w-64">
                    <Disclosure summary="Edit room">
                      <div className="space-y-5">
                        <ActionForm action={saveRoomAction} className="space-y-3">
                          <Hidden name="roomId" value={room.id} />
                          <Hidden name="propertyId" value={p.id} />
                          <Input name="name" label="Room name" defaultValue={room.name} required />
                          <MoneyInput name="defaultRent" label="Default monthly rent" defaultValue={centsToInput(room.defaultRentCents)} hint="Used as the starting rent when placing a new resident." required />
                          <Textarea name="notes" label="Notes" defaultValue={room.notes} rows={2} />
                          <SubmitButton small>Save room</SubmitButton>
                        </ActionForm>
                        {room.resident ? (
                          <p className="text-sm text-muted">Status is “Occupied” while a resident is assigned. Transfer or move them out to change it.</p>
                        ) : (
                          <ActionForm action={setRoomStatusAction} className="space-y-3">
                            <Hidden name="roomId" value={room.id} />
                            <Select name="status" label="Room status" defaultValue={room.status === "OCCUPIED" ? "AVAILABLE" : room.status} options={MANUAL_ROOM_STATUSES.map((s) => ({ value: s, label: ROOM_STATUS_LABELS[s] }))} />
                            <SubmitButton small variant="secondary">
                              Update status
                            </SubmitButton>
                          </ActionForm>
                        )}
                      </div>
                    </Disclosure>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <div className="mt-5">
          <Disclosure summary="Add a room">
            <ActionForm action={saveRoomAction} className="grid gap-4 sm:grid-cols-2" resetOnSuccess>
              <Hidden name="propertyId" value={p.id} />
              <Input name="name" label="Room name" placeholder={`Room ${p.rooms.length + 1}`} required />
              <MoneyInput name="defaultRent" label="Monthly rent" required />
              <div className="sm:col-span-2">
                <Textarea name="notes" label="Notes" rows={2} />
              </div>
              <div className="sm:col-span-2">
                <SubmitButton>Add room</SubmitButton>
              </div>
            </ActionForm>
          </Disclosure>
        </div>
      </Card>

      <Card title="Property details" className="mt-6">
        <PropertyForm property={p} />
      </Card>
    </>
  );
}
