import type { Metadata } from "next";
import Link from "next/link";
import { ApplicationStatusBadge, Card, DemoTag, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { APPLICATION_STATUSES, APPLICATION_STATUS_LABELS, type ApplicationStatus } from "@/domain/applications";
import { dateOnlyFromDbDate, formatShort } from "@/domain/dates";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Applications" };
export const dynamic = "force-dynamic";

const TABS: ApplicationStatus[] = ["NEW", "UNDER_REVIEW", "APPROVED", "WAITLISTED", "DECLINED", "CONVERTED"];

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requirePagePermission("applications:read");
  const sp = await searchParams;
  const status = APPLICATION_STATUSES.includes(sp.status as ApplicationStatus) ? (sp.status as ApplicationStatus) : "NEW";
  const [counts, apps, settings] = await Promise.all([
    prisma.application.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.application.findMany({ where: { status }, orderBy: { createdAt: status === "NEW" || status === "UNDER_REVIEW" ? "asc" : "desc" }, take: 200 }),
    getSettings(),
  ]);
  const countOf = (s: ApplicationStatus) => counts.find((c) => c.status === s)?._count._all ?? 0;

  return (
    <>
      <PageHeader
        title="Applications"
        description={
          <>
            Public application form: <a href="/apply" target="_blank" rel="noopener">/apply</a> — link it from the website’s “How to apply” page.
          </>
        }
      />
      <nav aria-label="Application status" className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/admin/applications?status=${t}`}
            aria-current={t === status ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 font-bold no-underline ${t === status ? "border-forest bg-forest text-white" : "border-line bg-white text-ink hover:bg-paper-2"}`}
          >
            {APPLICATION_STATUS_LABELS[t]}
            <span className={`rounded-full px-2 text-xs ${t === status ? "bg-white/20" : "bg-paper-2"}`}>{countOf(t)}</span>
          </Link>
        ))}
      </nav>
      <Card>
        {apps.length === 0 ? (
          <EmptyState title={`No ${APPLICATION_STATUS_LABELS[status].toLowerCase()} applications`} icon="inbox" />
        ) : (
          <TableWrap>
            <table className="table min-w-[44rem]">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Contact</th>
                  <th>Desired move-in</th>
                  <th>Received</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/admin/applications/${a.id}`} className="font-bold">
                        {a.firstName} {a.lastName}
                      </Link>
                      {a.isDemo ? <DemoTag /> : null}
                      {a.isVeteran ? <span className="block text-xs text-muted">Veteran</span> : null}
                    </td>
                    <td className="text-sm">
                      {a.phone}
                      <span className="block text-muted">{a.email}</span>
                    </td>
                    <td>{a.desiredMoveInDate ? formatShort(dateOnlyFromDbDate(a.desiredMoveInDate)) : "—"}</td>
                    <td className="text-sm">{formatDateTime(a.createdAt, settings.timezone)}</td>
                    <td>
                      <ApplicationStatusBadge status={a.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
