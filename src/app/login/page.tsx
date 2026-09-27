import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, Hidden, Input, SubmitButton } from "@/components/form";
import { Notice } from "@/components/ui";
import { homePathFor } from "@/domain/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { loginAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; signedOut?: string }> }) {
  const user = await getSessionUser();
  if (user) redirect(homePathFor(user.role));
  const { next, signedOut } = await searchParams;
  return (
    <AuthShell title="Welcome home" subtitle="Sign in to see your balance, pay rent, and get your receipts.">
      {signedOut ? (
        <div className="mb-4">
          <Notice tone="ok">You’ve been signed out.</Notice>
        </div>
      ) : null}
      <ActionForm action={loginAction} className="space-y-4">
        {next ? <Hidden name="next" value={next} /> : null}
        <Input name="email" type="email" label="Email" autoComplete="email" inputMode="email" required />
        <Input name="password" type="password" label="Password" autoComplete="current-password" required />
        <SubmitButton className="w-full" pendingText="Signing in…">
          Sign in
        </SubmitButton>
      </ActionForm>
      <div className="mt-6 space-y-2 text-center text-[0.95rem] text-muted">
        <p>New resident? Use the link the office sent you to set your password.</p>
        <p>
          Looking for a home? <Link href="/apply" className="font-bold">Apply to Legacy</Link>
        </p>
      </div>
    </AuthShell>
  );
}
