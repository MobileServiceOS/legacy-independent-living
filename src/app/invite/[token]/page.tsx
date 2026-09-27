import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, Hidden, Input, SubmitButton } from "@/components/form";
import { Notice } from "@/components/ui";
import { PASSWORD_MIN_LENGTH } from "@/lib/security/crypto";
import { findValidInvite } from "@/server/auth";
import { acceptInviteAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Set up your account" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = token.length <= 200 ? await findValidInvite(token) : null;
  if (!invite) {
    return (
      <AuthShell title="This link has expired" subtitle="Setup links work once and expire after 14 days.">
        <Notice tone="warn">Please contact the office and ask for a new setup link.</Notice>
        <p className="mt-6 text-center">
          <Link href="/login" className="font-bold">Go to sign in</Link>
        </p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={`Welcome, ${invite.user.name.split(" ")[0]}`} subtitle="Create a password to finish setting up your resident account.">
      <ActionForm action={acceptInviteAction} className="space-y-4">
        <Hidden name="token" value={token} />
        <div className="rounded-xl bg-paper-2 px-4 py-3 text-[0.95rem]">
          Signing in as <strong>{invite.user.email}</strong>
        </div>
        <Input
          name="password"
          type="password"
          label="New password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number.`}
          required
        />
        <Input name="confirm" type="password" label="Type it again" autoComplete="new-password" required />
        <SubmitButton className="w-full" pendingText="Setting up…">
          Create my account
        </SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
