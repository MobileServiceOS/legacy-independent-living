/** Instant feedback while an owner page loads, so a tap never looks unresponsive on a slow connection. */
export default function AdminLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-5" data-testid="page-loading">
      <span className="sr-only">Loading…</span>
      <div className="h-10 w-56 animate-pulse rounded-lg bg-paper-2" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-28 animate-pulse rounded-2xl bg-paper-2" />
        <div className="h-28 animate-pulse rounded-2xl bg-paper-2" />
      </div>
      <div className="h-56 w-full animate-pulse rounded-2xl bg-paper-2" />
    </div>
  );
}
