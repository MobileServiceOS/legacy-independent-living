import Image from "next/image";
import Link from "next/link";
import { ResidentTabBar, TopNav, type NavItem } from "@/components/nav";
import { requireResidentPage } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { unreadCount } from "@/server/notifications";
import { logoutAction } from "@/app/actions/auth";

export default async function ResidentLayout({ children }: { children: React.ReactNode }) {
  const user = await requireResidentPage();
  const [unread, openRepairs] = await Promise.all([
    unreadCount(user.id),
    prisma.maintenanceRequest.count({ where: { residentId: user.residentId, status: { notIn: ["COMPLETED", "CANCELED"] } } }),
  ]);
  const items: NavItem[] = [
    { href: "/home", label: "Home", icon: "home" },
    { href: "/payments", label: "Payments", icon: "receipt" },
    { href: "/maintenance", label: "Repairs", icon: "wrench", badge: openRepairs || undefined },
    { href: "/documents", label: "Documents", icon: "file", desktopOnly: true },
    { href: "/notifications", label: "Alerts", icon: "bell", badge: unread },
    { href: "/profile", label: "Profile", icon: "user" },
  ];
  return (
    <div className="min-h-dvh pb-24 md:pb-10">
      <header className="no-print sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2.5">
          <Link href="/home" className="flex items-center gap-2.5 no-underline">
            <Image src="/brand/logo-mark.webp" alt="" width={40} height={40} className="rounded-full bg-white" />
            <span className="font-serif text-xl font-semibold text-forest-deep">Legacy Living</span>
          </Link>
          <TopNav items={items} />
          <form action={logoutAction}>
            <button className="btn-secondary btn-sm" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 py-6">
        {children}
      </main>
      <ResidentTabBar items={items} />
    </div>
  );
}
