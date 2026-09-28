import Image from "next/image";
import Link from "next/link";
import { AdminNav, type NavItem } from "@/components/nav";
import { SignOutButton } from "@/components/push-controls";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { unreadCount } from "@/server/notifications";
import { logoutAction } from "@/app/actions/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePagePermission("admin:access");
  const [newApps, newRepairs, unread, demo] = await Promise.all([
    prisma.application.count({ where: { status: "NEW" } }),
    prisma.maintenanceRequest.count({ where: { status: "SUBMITTED" } }),
    unreadCount(user.id),
    prisma.property.count({ where: { isDemo: true } }),
  ]);
  const items: NavItem[] = [
    { href: "/admin", label: "Dashboard", icon: "grid", exact: true },
    { href: "/admin/properties", label: "Properties", icon: "building" },
    { href: "/admin/residents", label: "Residents", icon: "users" },
    { href: "/admin/applications", label: "Applications", icon: "inbox", badge: newApps },
    { href: "/admin/maintenance", label: "Maintenance", icon: "wrench", badge: newRepairs },
    { href: "/admin/payments", label: "Payments", icon: "dollar" },
    { href: "/admin/reports", label: "Reports", icon: "chart" },
    { href: "/admin/notifications", label: "Notifications", icon: "bell", badge: unread },
    { href: "/admin/settings", label: "Settings", icon: "cog" },
  ];
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr] lg:grid-cols-[16rem_1fr]">
      <aside className="no-print bg-forest-deep pt-[env(safe-area-inset-top)] text-white md:sticky md:top-0 md:h-dvh md:overflow-y-auto">
        <div className="flex items-center justify-between gap-3 px-4 py-4 md:block">
          <Link href="/admin" className="flex items-center gap-3 text-white no-underline">
            <Image src="/brand/logo-mark.webp" alt="" width={44} height={44} className="rounded-full bg-white" />
            <span>
              <span className="block font-serif text-xl font-semibold leading-tight">Legacy</span>
              <span className="block text-xs font-bold uppercase tracking-widest text-cream/80">Owner portal</span>
            </span>
          </Link>
        </div>
        <div className="px-3 pb-3 md:pb-6">
          <AdminNav items={items} />
          <div className="mt-4 border-t border-white/15 pt-4 md:mt-8">
            <p className="truncate px-3 text-sm text-white/70">{user.name}</p>
            <SignOutButton action={logoutAction} label="Sign out" className="mt-1 flex min-h-11 w-full items-center gap-3 rounded-lg px-3 font-bold text-white/80 hover:bg-white/10 hover:text-white" />
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        {demo > 0 ? (
          <div data-demo className="no-print border-b border-warn/20 bg-warn-bg px-4 py-2 text-center text-sm font-semibold text-warn">
            Demo data is loaded. Records marked <span className="rounded border border-dashed border-trunk/50 px-1 text-[0.7rem] uppercase text-trunk">Demo</span> are
            fictional examples — not real Legacy residents or properties.
          </div>
        ) : null}
        <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 md:px-6 md:py-8 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
