import type { Metadata } from "next";
import { Card, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { dateOnlyFromInstant, formatShort } from "@/domain/dates";
import { requireResidentPage } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

const KIND_LABEL = { HOUSING_AGREEMENT: "Housing agreement", ID_REFERENCE: "ID / reference", OTHER: "Document" } as const;

export default async function DocumentsPage() {
  const user = await requireResidentPage();
  const settings = await getSettings();
  const docs = await prisma.document.findMany({
    where: { residentId: user.residentId, visibleToResident: true, archivedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return (
    <div className="space-y-5">
      <h1 className="text-4xl">Documents</h1>
      <Card>
        {docs.length === 0 ? (
          <EmptyState title="No documents yet" icon="file">
            Your housing agreement and other papers from the office will appear here.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {docs.map((d) => (
              <li key={d.id} className="flex min-h-16 items-center justify-between gap-3 py-3">
                <div className="flex items-start gap-3">
                  <Icon name="file" className="mt-1 size-6 text-sage" />
                  <div>
                    <p className="font-bold">{d.title}</p>
                    <p className="text-sm text-muted">
                      {KIND_LABEL[d.kind]} · Added {formatShort(dateOnlyFromInstant(d.createdAt, settings.timezone))}
                    </p>
                    {d.referenceNote ? <p className="text-sm text-muted">{d.referenceNote}</p> : null}
                  </div>
                </div>
                {d.storageKey ? (
                  <a href={`/api/documents/${d.id}`} className="btn-secondary btn-sm shrink-0" target="_blank" rel="noopener">
                    Open
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
