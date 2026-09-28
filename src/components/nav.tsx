"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icons";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: number;
  exact?: boolean;
  /** Hide from the phone tab bar (still in the desktop nav). */
  desktopOnly?: boolean;
}

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Resident bottom tab bar (phones) — big targets, labels always visible. */
export function ResidentTabBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="grid grid-cols-5">
        {items.filter((i) => !i.desktopOnly).map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-16 flex-col items-center justify-center gap-1 text-[0.72rem] font-bold no-underline ${active ? "text-forest" : "text-muted"}`}
              >
                <Icon name={item.icon} className={`size-6 ${active ? "stroke-[2.2]" : ""}`} />
                {item.label}
                {item.badge ? (
                  <span className="absolute right-[calc(50%-1.1rem)] top-2 min-w-5 rounded-full bg-bad px-1 text-center text-[0.65rem] leading-5 text-white">
                    {item.badge > 9 ? "9+" : item.badge}
                  </span>
                ) : null}
                {active ? <span className="absolute inset-x-6 top-0 h-1 rounded-b bg-forest" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Horizontal top nav (resident, tablet/desktop). */
export function TopNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="hidden md:block">
      <ul className="flex gap-1">
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-2 rounded-lg px-3 font-bold no-underline ${active ? "bg-ok-bg text-forest-deep" : "text-muted hover:bg-paper-2"}`}
              >
                <Icon name={item.icon} />
                {item.label}
                {item.badge ? <span className="rounded-full bg-bad px-1.5 text-xs text-white">{item.badge}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Admin sidebar (desktop) + slide-down menu (mobile). */
export function AdminNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const list = (
    <ul className="space-y-1">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-lg px-3 font-bold no-underline ${active ? "bg-white/15 text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`}
            >
              <Icon name={item.icon} />
              <span className="flex-1">{item.label}</span>
              {item.badge ? <span className="rounded-full bg-cream px-2 text-xs text-forest-deep">{item.badge}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
  return (
    <>
      <div className="hidden md:block">{list}</div>
      <details className="group md:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 font-bold text-white [&::-webkit-details-marker]:hidden">
          <Icon name="menu" /> Menu
        </summary>
        <div className="pb-3 pt-2">{list}</div>
      </details>
    </>
  );
}
