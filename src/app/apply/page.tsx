import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, Checkbox, Input, Select, SubmitButton, Textarea } from "@/components/form";
import { CONTACT_PREFERENCES, HOUSING_SITUATIONS } from "@/domain/applications";
import { submitApplicationAction } from "@/app/actions/apply";

export const metadata: Metadata = { title: "Apply for housing" };

export default function ApplyPage() {
  return (
    <AuthShell wide title="Apply for a room" subtitle="Takes about 3 minutes. We only ask for what we need to reach you and find you a room.">
      <ActionForm action={submitApplicationAction} className="space-y-6">
        <fieldset className="space-y-4">
          <legend className="font-serif text-2xl text-forest-deep">About you</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input name="firstName" label="First name" autoComplete="given-name" required />
            <Input name="lastName" label="Last name" autoComplete="family-name" required />
            <Input name="phone" type="tel" label="Phone" autoComplete="tel" inputMode="tel" required />
            <Input name="email" type="email" label="Email" autoComplete="email" inputMode="email" required />
          </div>
          <Select name="preferredContact" label="Best way to reach you" placeholder="No preference" options={CONTACT_PREFERENCES.map((v) => ({ value: v, label: v }))} />
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="font-serif text-2xl text-forest-deep">Your housing needs</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input name="desiredMoveInDate" type="date" label="When would you like to move in?" />
            <Select name="housingSituation" label="Current housing situation" placeholder="Choose one (optional)" options={HOUSING_SITUATIONS.map((v) => ({ value: v, label: v }))} />
          </div>
          <Select
            name="isVeteran"
            label="Are you a veteran?"
            hint="Optional — some of our rooms are set aside for veterans."
            placeholder="Prefer not to say"
            options={[
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]}
          />
          <Input name="referralSource" label="How did you hear about us?" hint="Optional — a caseworker, program, friend, or website." />
          <Textarea name="message" label="Anything else we should know?" hint="Optional." rows={4} />
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="font-serif text-2xl text-forest-deep">Emergency contact <span className="font-sans text-base text-muted">(optional)</span></legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input name="emergencyContactName" label="Name" autoComplete="off" />
            <Input name="emergencyContactPhone" type="tel" label="Phone" inputMode="tel" autoComplete="off" />
          </div>
        </fieldset>

        {/* Honeypot: hidden from people, irresistible to bots */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Website <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <div className="rounded-xl bg-paper-2 p-4 text-[0.95rem] text-muted">
          We won't ask for your Social Security number, bank details or ID on this form. If we need anything else, we'll talk with you directly.
        </div>
        <Checkbox name="consent" label="The information I've entered is accurate, and Legacy Independent Living may contact me about housing." />
        <SubmitButton className="w-full" pendingText="Sending…">
          Send my application
        </SubmitButton>
        <p className="text-center text-sm text-muted">
          Already a resident? <Link href="/login" className="font-bold">Sign in</Link>
        </p>
      </ActionForm>
    </AuthShell>
  );
}
