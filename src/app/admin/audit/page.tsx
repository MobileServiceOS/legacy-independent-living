import type { Metadata } from "next";
import Link from "next/link";
import { BackLink, Card, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

const PAGE = 100;

function entityHref(type: string, id: string | null): string | null {
  if (!id) return null;
  if (type === "resident") return `/admin/residents/${id}`;
  if (type === "application") return `/admin/applications/${id}`;
  if (type === "payment") return `/receipts/${id}`;
  return null;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string; action?: string }> }) {
  await requirePagePermission("audit:read");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = sp.action ? { action: { startsWith: sp.action.slice(0, 60) } } : {};
  const [rows, total, settings] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    prisma.auditLog.count({ where }),
    getSettings(),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <>
      <BackLink href="/admin/settings">Settings</BackLink>
      <PageHeader title="Audit log" description={`${total} events · append-only, cannot be edited or deleted`} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No events" icon="shield" />
        ) : (
          <TableWrap>
            <table className="table min-w-[60rem]">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const href = entityHref(a.entityType, a.entityId);
                  return (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap text-sm">{formatDateTime(a.createdAt, settings.timezone)}</td>
                      <td className="text-sm">{a.actorEmail ?? "system"}</td>
                      <td className="font-mono text-xs font-bold">{a.action}</td>
                      <td className="text-sm">
                        {a.entityType}
                        {href ? (
                          <Link href={href} className="ml-1 font-mono text-xs">
                            {a.entityId?.slice(-8)}
                          </Link>
                        ) : a.entityId ? (
                          <span className="ml-1 font-mono text-xs">{a.entityId.slice(-8)}</span>
                        ) : null}
                      </td>
                      <td>
                        <code className="block max-w-md whitespace-pre-wrap break-all text-xs text-muted">{JSON.stringify(a.metadata)}</code>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        {pages > 1 ? (
          <nav className="mt-4 flex items-center justify-between" aria-label="Pagination">
            {page > 1 ? <Link href={`?page=${page - 1}`} className="btn-secondary btn-sm">Newer</Link> : <span />}
            <span className="text-sm text-muted">
              Page {page} of {pages}
            </span>
            {page < pages ? <Link href={`?page=${page + 1}`} className="btn-secondary btn-sm">Older</Link> : <span />}
          </nav>
        ) : null}
      </Card>
    </>
  );
}
