import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Privacy policy", robots: { index: true, follow: true } };
export const dynamic = "force-dynamic";

const UPDATED = "September 27, 2026";

export default async function PrivacyPage() {
  const s = await getSettings();
  const contact = [s.supportEmail, s.supportPhone].filter(Boolean).join(" · ") || "the Legacy Independent Living office";
  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/" className="text-sm font-bold">
        ← Legacy Independent Living
      </Link>
      <h1 className="mt-4 text-4xl">Privacy policy</h1>
      <p className="mt-1 text-muted">Last updated {UPDATED}</p>
      <div className="mt-6 space-y-6 leading-relaxed [&_h2]:mb-2 [&_h2]:text-2xl [&_li]:ml-5 [&_li]:list-disc">
        <section>
          <p>
            This policy explains what {s.businessName} (“Legacy”, “we”) collects through the Legacy Living app and website (the “portal”), why, and your choices.
          </p>
        </section>
        <section>
          <h2>What we collect</h2>
          <ul>
            <li><strong>Contact details</strong> — name, email, phone and an optional emergency contact, from your application or move-in.</li>
            <li><strong>Housing details</strong> — your home, room, move-in date and rent schedule.</li>
            <li><strong>Payment records</strong> — amounts, dates, receipt numbers and payment method type. Card, Cash App and bank details are entered on our payment processor Stripe’s secure page; we never see or store them. We may keep the card brand and last 4 digits Stripe shares with us.</li>
            <li><strong>Repair requests</strong> — descriptions, photos you attach, and messages with the office.</li>
            <li><strong>Documents</strong> — your housing agreement and papers the office adds.</li>
            <li><strong>Device and sign-in data</strong> — sign-in times, IP address and browser type for security; if you turn on notifications, a device notification token.</li>
            <li><strong>Applications</strong> — what you enter on the housing application. We don’t ask for Social Security numbers, bank details or ID numbers.</li>
          </ul>
        </section>
        <section>
          <h2>How we use it</h2>
          <ul>
            <li>To run your tenancy: rent charges, payments, receipts, repairs and notices.</li>
            <li>To send you notifications you turned on (rent due, payment status, repair updates, announcements).</li>
            <li>To keep accounts secure and prevent fraud.</li>
            <li>To meet legal and accounting obligations.</li>
          </ul>
          <p className="mt-2">We don’t sell your information, show ads, or track you across other apps or websites.</p>
        </section>
        <section>
          <h2>Who we share it with</h2>
          <ul>
            <li><strong>Stripe</strong>, to process rent payments (and Cash App, if you choose Cash App Pay).</li>
            <li><strong>Apple / your browser’s push service</strong>, only to deliver notifications you turned on.</li>
            <li>Our hosting and database providers, who store data on our behalf.</li>
            <li>Authorities, when the law requires it.</li>
          </ul>
        </section>
        <section>
          <h2>How long we keep it</h2>
          <p>Account and contact details are kept while you are a resident and for a reasonable period after move-out. Payment and rent records are kept as long as tax and housing laws require.</p>
        </section>
        <section>
          <h2>Your choices</h2>
          <ul>
            <li>Turn notifications on or off anytime in Profile or your device settings.</li>
            <li>Ask us to correct your details.</li>
            <li>Request deletion of your account from <strong>Profile → Delete my account</strong>, or by contacting us. We delete your account and personal details except records we must keep by law.</li>
          </ul>
        </section>
        <section>
          <h2>Security</h2>
          <p>Passwords are stored as one-way hashes, connections are encrypted, financial history can’t be edited, and staff access is limited and logged.</p>
        </section>
        <section>
          <h2>Children</h2>
          <p>The portal is for adult residents and applicants. We don’t knowingly collect information from children under 13.</p>
        </section>
        <section>
          <h2>Contact</h2>
          <p>Questions or requests: {contact}.</p>
        </section>
      </div>
    </main>
  );
}
