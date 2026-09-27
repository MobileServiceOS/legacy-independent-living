import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, Checkbox, Input, RadioCards, Select, SubmitButton, Textarea } from "@/components/form";
import { PhotoInput } from "@/components/photo-input";
import { BackLink, Card } from "@/components/ui";
import { MAINTENANCE_CATEGORIES, MAINTENANCE_CATEGORY_LABELS, MAINTENANCE_PRIORITIES, MAINTENANCE_PRIORITY_LABELS, MAX_MAINTENANCE_PHOTOS } from "@/domain/maintenance";
import { requireResidentPage } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { submitMaintenanceAction } from "@/app/actions/maintenance";
import { EmergencyNote } from "@/components/emergency-note";

export const metadata: Metadata = { title: "Report a problem" };
export const dynamic = "force-dynamic";

export default async function NewMaintenancePage() {
  const user = await requireResidentPage();
  const [resident, settings] = await Promise.all([
    prisma.resident.findUniqueOrThrow({
      where: { id: user.residentId },
      include: { assignments: { where: { endDate: null }, take: 1, include: { room: { include: { property: true } } } } },
    }),
    getSettings(),
  ]);
  if (resident.status !== "ACTIVE") redirect("/maintenance");
  const room = resident.assignments[0]?.room;

  return (
    <div className="space-y-5">
      <BackLink href="/maintenance">Repairs</BackLink>
      <h1 className="text-4xl">Report a problem</h1>
      <EmergencyNote phone={settings.supportPhone} />
      <Card>
        {room ? (
          <p className="mb-5 rounded-xl bg-paper-2 px-4 py-3 text-[0.95rem]">
            For <strong>{room.property.name} · {room.name}</strong>
          </p>
        ) : null}
        <ActionForm action={submitMaintenanceAction} className="space-y-5">
          <Select
            name="category"
            label="What kind of problem is it?"
            placeholder="Choose one"
            required
            options={MAINTENANCE_CATEGORIES.map((c) => ({ value: c, label: MAINTENANCE_CATEGORY_LABELS[c] }))}
          />
          <Input name="title" label="In a few words, what's wrong?" placeholder="e.g. Bathroom sink is leaking" required />
          <Textarea name="description" label="Tell us more" hint="When did it start? Is it getting worse?" rows={4} required />
          <Input name="location" label="Where is it?" placeholder="e.g. My room, shared kitchen, front door" />
          <RadioCards
            name="priority"
            label="How soon does it need fixing?"
            defaultValue="NORMAL"
            options={MAINTENANCE_PRIORITIES.map((p) => ({ value: p, label: MAINTENANCE_PRIORITY_LABELS[p] }))}
          />
          <PhotoInput max={MAX_MAINTENANCE_PHOTOS} />
          <div className="rounded-xl border border-line p-4">
            <Checkbox name="permissionToEnter" label="It's OK to enter my room if I'm not home" hint="Repairs usually happen faster when we can come in." />
            <Input name="entryNotes" label="Anything we should know before entering?" placeholder="e.g. Please knock first, I have a cat" />
          </div>
          <SubmitButton className="min-h-14 w-full text-lg" pendingText="Sending…">
            Send request
          </SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
