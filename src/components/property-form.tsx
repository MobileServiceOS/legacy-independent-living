import { ActionForm, Hidden, Input, SubmitButton, Textarea } from "./form";
import { savePropertyAction } from "@/app/actions/admin";

export function PropertyForm({ property }: { property?: { id: string; name: string; addressLine1: string; addressLine2: string | null; city: string; state: string; postalCode: string; notes: string | null } }) {
  return (
    <ActionForm action={savePropertyAction} className="space-y-4">
      {property ? <Hidden name="propertyId" value={property.id} /> : null}
      <Input name="name" label="Property name" defaultValue={property?.name} placeholder="Legacy House #1" required />
      <Input name="addressLine1" label="Street address" defaultValue={property?.addressLine1} autoComplete="address-line1" required />
      <Input name="addressLine2" label="Address line 2" defaultValue={property?.addressLine2} autoComplete="address-line2" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Input name="city" label="City" defaultValue={property?.city ?? "Houston"} required />
        <Input name="state" label="State" defaultValue={property?.state ?? "TX"} required />
        <Input name="postalCode" label="ZIP" defaultValue={property?.postalCode} inputMode="numeric" required />
      </div>
      <Textarea name="notes" label="Internal notes" defaultValue={property?.notes} />
      <SubmitButton>{property ? "Save property" : "Add property"}</SubmitButton>
    </ActionForm>
  );
}
