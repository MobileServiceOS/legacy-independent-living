import type { Metadata } from "next";
import Link from "next/link";
import { Disclosure } from "@/components/form";
import { OccupancyBoard } from "@/components/occupancy-board";
import { PropertyForm } from "@/components/property-form";
import { Card, DemoTag, EmptyState, Money, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/session";
import { businessToday, getSettings } from "@/lib/settings";
import { propertiesOverview } from "@/server/queries";

export const metadata: Metadata = { title: "Properties" };
export const dynamic = "force-dynamic";

export default async function PropertiesPage() {
  await requirePagePermission("properties:read");
  const properties = await propertiesOverview(businessToday(await getSettings()));
  return (
    <>
      <PageHeader title="Properties" description="Every home, every room, and who lives there." />
      <div className="mb-6">
        <Disclosure summary="Add a property">
          <PropertyForm />
        </Disclosure>
      </div>
      {properties.length === 0 ? (
        <EmptyState title="No properties yet" icon="building">
          Add your first Legacy home above, then add its rooms.
        </EmptyState>
      ) : (
        <div className="min-w-0 space-y-6">
          {properties.map((p) => (
            <Card key={p.id}>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-2xl">
                    <Link href={`/admin/properties/${p.id}`} className="text-forest-deep no-underline hover:underline">
                      {p.name}
                    </Link>
                    {p.isDemo ? <DemoTag /> : null}
                  </h2>
                  <p className="text-muted">
                    {p.addressLine1}, {p.city}, {p.state} {p.postalCode}
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4 sm:text-right">
                  <div>
                    <dt className="text-muted">Rooms</dt>
                    <dd className="font-bold">{p.occupancy.totalRooms}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Occupied</dt>
                    <dd className="font-bold">{p.occupancy.occupied}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Available</dt>
                    <dd className="font-bold text-ok">{p.occupancy.available}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Expected / mo</dt>
                    <dd className="font-bold">
                      <Money cents={p.monthlyExpectedCents} />
                    </dd>
                  </div>
                </dl>
              </div>
              {p.rooms.length ? (
                <OccupancyBoard rooms={p.rooms} propertyId={p.id} />
              ) : (
                <EmptyState title="No rooms yet">
                  <Link href={`/admin/properties/${p.id}`}>Add rooms</Link> to this property.
                </EmptyState>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
