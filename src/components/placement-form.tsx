import { ActionForm, Hidden, Input, MoneyInput, Select, SubmitButton, Textarea } from "./form";
import { centsToInput, formatCents } from "@/domain/money";
import { placeResidentAction } from "@/app/actions/admin";

export interface PlacementRoom {
  id: string;
  name: string;
  propertyName: string;
  defaultRentCents: number;
  status: string;
}

/**
 * Convert an approved applicant (or add a resident directly):
 * property/room, monthly rent, move-in date and rent due day.
 */
export function PlacementForm({
  rooms,
  defaults,
  applicationId,
  today,
}: {
  rooms: PlacementRoom[];
  defaults: {
    roomId?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    moveInDate?: string;
  };
  applicationId?: string;
  today: string;
}) {
  const selected = rooms.find((r) => r.id === defaults.roomId);
  return (
    <ActionForm action={placeResidentAction} className="space-y-6" copyResult={{ key: "inviteUrl", label: "Resident setup link (share by text or email — valid 14 days)" }} linkResult={{ key: "residentUrl", label: "Open resident profile" }}>
      {applicationId ? <Hidden name="applicationId" value={applicationId} /> : null}
      <fieldset className="space-y-4">
        <legend className="font-serif text-2xl text-forest-deep">Housing</legend>
        {rooms.length === 0 ? (
          <p className="rounded-xl bg-warn-bg p-3 font-semibold text-warn">No rooms are available. Free up or add a room first.</p>
        ) : null}
        <Select
          name="roomId"
          label="Property & room"
          required
          defaultValue={defaults.roomId ?? ""}
          placeholder="Choose an available room"
          options={rooms.map((r) => ({
            value: r.id,
            label: `${r.propertyName} · ${r.name} — ${formatCents(r.defaultRentCents)}/mo${r.status === "RESERVED" ? " (reserved)" : ""}`,
          }))}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <MoneyInput name="monthlyRent" label="Monthly rent" defaultValue={selected ? centsToInput(selected.defaultRentCents) : undefined} hint={selected ? undefined : "Room rates are shown in the list above."} required />
          <Input name="moveInDate" type="date" label="Move-in date" defaultValue={defaults.moveInDate ?? today} required />
          <Input name="dueDay" type="number" inputMode="numeric" min={1} max={28} label="Rent due day" defaultValue="1" hint="Day of the month (1–28)" required />
        </div>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="font-serif text-2xl text-forest-deep">Resident</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input name="firstName" label="First name" defaultValue={defaults.firstName} required />
          <Input name="lastName" label="Last name" defaultValue={defaults.lastName} required />
          <Input name="email" type="email" label="Email (used to sign in)" defaultValue={defaults.email} required />
          <Input name="phone" type="tel" label="Phone" defaultValue={defaults.phone} required />
          <Input name="emergencyContactName" label="Emergency contact" defaultValue={defaults.emergencyContactName} />
          <Input name="emergencyContactPhone" type="tel" label="Emergency contact phone" defaultValue={defaults.emergencyContactPhone} />
          <Input name="emergencyContactRelation" label="Relationship" />
        </div>
        <Textarea name="notes" label="Internal notes" rows={2} />
      </fieldset>
      <div className="rounded-xl bg-paper-2 p-4 text-sm text-muted">
        This will create the resident, assign the room and mark it occupied, set the rent schedule (posting rent due within the billing window), and create a sign-in setup link.
      </div>
      <SubmitButton pendingText="Creating resident…">{applicationId ? "Convert to resident" : "Add resident"}</SubmitButton>
    </ActionForm>
  );
}
