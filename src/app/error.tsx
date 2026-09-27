"use client";
import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-4xl">Something went wrong</h1>
      <p className="mt-2 text-muted">Nothing was lost — please try again. If it keeps happening, contact the office.</p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-muted">Ref: {error.digest}</p> : null}
      <button type="button" onClick={reset} className="btn-primary mt-6">
        Try again
      </button>
    </main>
  );
}
