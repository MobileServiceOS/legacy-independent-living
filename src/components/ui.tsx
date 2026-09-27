/** Server-safe presentational components. */
import Link from "next/link";
import type { ReactNode } from "react";
import { APPLICATION_STATUS_LABELS, type ApplicationStatus } from "@/domain/applications";
import { formatCents } from "@/domain/money";
import { PAYMENT_STATUS_LABELS, type PaymentStatus } from "@/domain/payments";
import { RENT_STATUS_LABELS, type RentStatus } from "@/domain/rent";
import { ROOM_STATUS_LABELS, type RoomStatus } from "@/domain/rooms";
import {
  MAINTENANCE_PRIORITY_SHORT,
  MAINTENANCE_STATUS_LABELS,
  type MaintenancePriority,
  type MaintenanceStatus,
} from "@/domain/maintenance";
import { Icon, type IconName } from "./icons";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type Tone = "ok" | "warn" | "bad" | "info" | "partial" | "neutral";

const TONE: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok border-ok/20",
  warn: "bg-warn-bg text-warn border-warn/20",
  bad: "bg-bad-bg text-bad border-bad/20",
  info: "bg-info-bg text-info border-info/20",
  partial: "bg-partial-bg text-partial border-partial/20",
  neutral: "bg-paper-2 text-muted border-line",
};

export function Badge({ tone = "neutral", children, icon, size = "md" }: { tone?: Tone; children: ReactNode; icon?: IconName; size?: "md" | "lg" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-extrabold uppercase tracking-wide",
        size === "lg" ? "px-4 py-1.5 text-sm" : "px-2.5 py-0.5 text-[0.72rem]",
        TONE[tone],
      )}
    >
      {icon ? <Icon name={icon} className={size === "lg" ? "size-4" : "size-3.5"} /> : null}
      {children}
    </span>
  );
}

const RENT_TONE: Record<RentStatus, { tone: Tone; icon: IconName }> = {
  PAID: { tone: "ok", icon: "check" },
  DUE_SOON: { tone: "info", icon: "clock" },
  DUE: { tone: "warn", icon: "clock" },
  OVERDUE: { tone: "bad", icon: "alert" },
  PARTIAL: { tone: "partial", icon: "dollar" },
  PENDING: { tone: "neutral", icon: "clock" },
};

export function RentStatusBadge({ status, size }: { status: RentStatus; size?: "md" | "lg" }) {
  const t = RENT_TONE[status];
  return (
    <Badge tone={t.tone} icon={t.icon} size={size}>
      {RENT_STATUS_LABELS[status]}
    </Badge>
  );
}

const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  PENDING: "neutral",
  PROCESSING: "info",
  SUCCEEDED: "ok",
  FAILED: "bad",
  REFUNDED: "partial",
  CANCELED: "neutral",
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={PAYMENT_TONE[status]}>{PAYMENT_STATUS_LABELS[status]}</Badge>;
}

const ROOM_TONE: Record<RoomStatus, Tone> = { AVAILABLE: "ok", OCCUPIED: "info", RESERVED: "warn", MAINTENANCE: "bad" };

export function RoomStatusBadge({ status }: { status: RoomStatus }) {
  return <Badge tone={ROOM_TONE[status]}>{ROOM_STATUS_LABELS[status]}</Badge>;
}

const APP_TONE: Record<ApplicationStatus, Tone> = {
  NEW: "info",
  UNDER_REVIEW: "warn",
  APPROVED: "ok",
  DECLINED: "bad",
  WAITLISTED: "partial",
  CONVERTED: "neutral",
};

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return <Badge tone={APP_TONE[status]}>{APPLICATION_STATUS_LABELS[status]}</Badge>;
}

const MAINT_TONE: Record<MaintenanceStatus, { tone: Tone; icon: IconName }> = {
  SUBMITTED: { tone: "info", icon: "inbox" },
  ACKNOWLEDGED: { tone: "partial", icon: "check" },
  SCHEDULED: { tone: "warn", icon: "clock" },
  IN_PROGRESS: { tone: "warn", icon: "wrench" },
  COMPLETED: { tone: "ok", icon: "check" },
  CANCELED: { tone: "neutral", icon: "x" },
};

export function MaintenanceStatusBadge({ status, size }: { status: MaintenanceStatus; size?: "md" | "lg" }) {
  const t = MAINT_TONE[status];
  return (
    <Badge tone={t.tone} icon={t.icon} size={size}>
      {MAINTENANCE_STATUS_LABELS[status]}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: MaintenancePriority }) {
  if (priority === "NORMAL") return <Badge tone="neutral">{MAINTENANCE_PRIORITY_SHORT[priority]}</Badge>;
  return (
    <Badge tone={priority === "URGENT" ? "bad" : "neutral"} icon={priority === "URGENT" ? "alert" : undefined}>
      {MAINTENANCE_PRIORITY_SHORT[priority]}
    </Badge>
  );
}

export function DemoTag() {
  return (
    <span className="ml-1.5 rounded border border-dashed border-trunk/50 px-1.5 py-px align-middle text-[0.62rem] font-extrabold uppercase tracking-wider text-trunk">
      Demo
    </span>
  );
}

export function Money({ cents, className, signed }: { cents: number; className?: string; signed?: boolean }) {
  return <span className={cx("tabular-nums", className)}>{formatCents(cents, { signed })}</span>;
}

/** Running balance: negative balances read as a credit rather than a minus sign. */
export function RunningBalance({ cents }: { cents: number }) {
  return cents < 0 ? <span className="tabular-nums text-ok">{formatCents(-cents)} credit</span> : <Money cents={cents} />;
}

export function PageHeader({ title, eyebrow, description, actions }: { title: string; eyebrow?: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <h1 className="text-3xl sm:text-4xl">{title}</h1>
        {description ? <div className="mt-1 text-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx("card min-w-0 p-5", className)}>
      {title || action ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title ? <h2 className="text-xl sm:text-2xl">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "bad" | "ok" | "warn" }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-extrabold uppercase tracking-wider text-muted">{label}</p>
      <p
        className={cx(
          "mt-1 font-serif text-3xl font-semibold tabular-nums",
          tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-forest-deep",
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-sm text-muted">{sub}</p> : null}
    </div>
  );
}

export function EmptyState({ title, children, icon = "inbox" }: { title: string; children?: ReactNode; icon?: IconName }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-paper px-6 py-10 text-center">
      <Icon name={icon} className="mb-2 size-8 text-sage" />
      <p className="font-bold">{title}</p>
      {children ? <div className="mt-1 max-w-md text-sm text-muted">{children}</div> : null}
    </div>
  );
}

export function Notice({ tone = "info", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cx("rounded-xl border px-4 py-3 text-[0.95rem]", TONE[tone])}>
      {title ? <p className="font-extrabold">{title}</p> : null}
      <div className={title ? "mt-0.5 font-normal normal-case" : ""}>{children}</div>
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="no-print mb-4 inline-flex items-center gap-1.5 text-sm font-bold no-underline hover:underline">
      <Icon name="arrowLeft" className="size-4" /> {children}
    </Link>
  );
}

export function DefinitionList({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-extrabold uppercase tracking-wider text-muted">{k}</dt>
          <dd className="mt-0.5 break-words">{v ?? <span className="text-muted">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Horizontal scroll wrapper so wide tables never break the page on phones. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="-mx-5 overflow-x-auto px-5">{children}</div>;
}
