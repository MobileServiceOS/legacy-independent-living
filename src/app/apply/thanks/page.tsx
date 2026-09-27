import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { Icon } from "@/components/icons";

export const metadata: Metadata = { title: "Application received" };

export default function ThanksPage() {
  return (
    <AuthShell title="Thank you — we got it" subtitle="Your application is with our team.">
      <div className="flex flex-col items-center text-center">
        <span className="mb-4 grid size-14 place-items-center rounded-full bg-ok-bg text-ok">
          <Icon name="check" className="size-7" />
        </span>
        <p>We review every application personally and usually reach out within 1–2 business days using the contact details you gave us.</p>
        <Link href="https://legacyindependentliving.net" className="btn-secondary mt-6">
          Back to our website
        </Link>
      </div>
    </AuthShell>
  );
}
