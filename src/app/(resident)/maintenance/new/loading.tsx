/** Instant feedback while a resident page loads, so a tap never looks unresponsive on a slow connection. */
export default function ResidentLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-5" data-testid="page-loading">
      <span className="sr-only">Loading…</span>
      <div className="h-10 w-48 animate-pulse rounded-lg bg-paper-2" />
      <div className="h-14 w-full animate-pulse rounded-xl bg-paper-2" />
      <div className="h-40 w-full animate-pulse rounded-2xl bg-paper-2" />
      <div className="h-28 w-full animate-pulse rounded-2xl bg-paper-2" />
    </div>
  );
}
