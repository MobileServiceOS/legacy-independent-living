"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "./icons";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: number;
  exact?: boolean;
  /** Hide from the phone tab bar (still in the desktop nav). */
  desktopOnly?: boolean;
  /** Admin tab bar only: show directly as a tab instead of under "More". */
  primary?: boolean;
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

/** Admin sidebar — desktop only. Phones use AdminTabBar instead (below). */
export function AdminNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <ul className="hidden space-y-1 md:block">
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
}

/**
 * Admin bottom tab bar (phones). Items flagged `primary` become tabs directly;
 * everything else (plus sign-out) lives behind a "More" tab that opens a
 * bottom sheet, since the full admin nav has too many sections for one row.
 */
export function AdminTabBar({ items, signOut }: { items: NavItem[]; signOut: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const primary = items.filter((i) => i.primary);
  const rest = items.filter((i) => !i.primary);
  const restBadge = rest.reduce((sum, i) => sum + (i.badge ?? 0), 0);
  const moreActive = rest.some((i) => isActive(pathname, i));

  return (
    <>
      <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-5">
          {primary.map((item) => {
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
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={open}
              className={`relative flex min-h-16 w-full flex-col items-center justify-center gap-1 text-[0.72rem] font-bold ${moreActive ? "text-forest" : "text-muted"}`}
            >
              <Icon name="menu" className={`size-6 ${moreActive ? "stroke-[2.2]" : ""}`} />
              More
              {restBadge ? (
                <span className="absolute right-[calc(50%-1.1rem)] top-2 min-w-5 rounded-full bg-bad px-1 text-center text-[0.65rem] leading-5 text-white">
                  {restBadge > 9 ? "9+" : restBadge}
                </span>
              ) : null}
              {moreActive ? <span className="absolute inset-x-6 top-0 h-1 rounded-b bg-forest" /> : null}
            </button>
          </li>
        </ul>
      </nav>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="More">
          <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/40" />
          <div className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-serif text-lg font-semibold text-forest-deep">More</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-2 text-muted hover:bg-paper-2">
                <Icon name="x" />
              </button>
            </div>
            <ul className="space-y-1">
              {rest.map((item) => {
                const active = isActive(pathname, item);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-12 items-center gap-3 rounded-lg px-3 font-bold no-underline ${active ? "bg-ok-bg text-forest-deep" : "text-ink hover:bg-paper-2"}`}
                    >
                      <Icon name={item.icon} />
                      <span className="flex-1">{item.label}</span>
                      {item.badge ? <span className="rounded-full bg-bad px-2 text-xs text-white">{item.badge}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 border-t border-line pt-3">{signOut}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
