import type { MaintenanceUpdate } from "@prisma/client";
import { MAINTENANCE_STATUS_LABELS } from "@/domain/maintenance";
import { formatDateTime } from "@/lib/format";
import { cx } from "./ui";

/** Chronological activity for a request. Pass only resident-visible updates to residents. */
export function MaintenanceTimeline({ updates, timeZone, viewer }: { updates: MaintenanceUpdate[]; timeZone: string; viewer: "RESIDENT" | "ADMIN" }) {
  return (
    <ol className="relative space-y-4 border-l-2 border-line pl-5">
      {updates.map((u) => {
        const fromOffice = u.authorRole === "ADMIN";
        const who = fromOffice ? (viewer === "RESIDENT" ? "Legacy office" : u.authorName) : viewer === "RESIDENT" ? "You" : u.authorName;
        return (
          <li key={u.id} className="relative">
            <span
              aria-hidden
              className={cx(
                "absolute -left-[1.72rem] top-1.5 size-3 rounded-full border-2 border-white",
                u.toStatus ? "bg-forest" : fromOffice ? "bg-sage" : "bg-trunk",
              )}
            />
            <div className={cx("rounded-xl p-3", u.internal ? "border border-dashed border-warn/40 bg-warn-bg/50" : fromOffice ? "bg-ok-bg/40" : "bg-paper-2")}>
              <p className="text-sm">
                <span className="font-bold">{who}</span>
                {u.toStatus ? (
                  <span className="text-muted">
                    {" "}
                    {u.toStatus === "SUBMITTED" ? "submitted this request" : <>marked it <strong className="text-ink">{MAINTENANCE_STATUS_LABELS[u.toStatus]}</strong></>}
                  </span>
                ) : null}
                {u.internal ? <span className="ml-2 text-xs font-extrabold uppercase tracking-wider text-warn">Staff only</span> : null}
              </p>
              {u.body ? <p className="mt-1 whitespace-pre-wrap">{u.body}</p> : null}
              <p className="mt-1 text-xs text-muted">{formatDateTime(u.createdAt, timeZone)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function PhotoGrid({ photos }: { photos: Array<{ id: string }> }) {
  if (!photos.length) return null;
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {photos.map((p, i) => (
        <li key={p.id}>
          <a href={`/api/maintenance-photos/${p.id}`} target="_blank" rel="noopener" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/maintenance-photos/${p.id}`} alt={`Photo ${i + 1}`} loading="lazy" className="aspect-square w-full rounded-lg border border-line object-cover" />
          </a>
        </li>
      ))}
    </ul>
  );
}
