import Image from "next/image";
import type { ReactNode } from "react";

/** Centered, warm single-column layout for sign-in / setup / apply screens. */
export function AuthShell({ title, subtitle, children, wide }: { title: string; subtitle?: string; children: ReactNode; wide?: boolean }) {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center bg-[radial-gradient(ellipse_at_top,_var(--color-cream),_var(--color-paper)_60%)] px-4 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-10 sm:py-16">
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <div className="mb-6 flex flex-col items-center text-center">
          <Image src="/brand/logo-mark.webp" alt="" width={96} height={96} priority className="rounded-full bg-white shadow-md" />
          <p className="eyebrow mt-4">Legacy Independent Living</p>
          <h1 className="mt-1 text-4xl">{title}</h1>
          {subtitle ? <p className="mt-2 max-w-sm text-muted">{subtitle}</p> : null}
        </div>
        <div className="card p-6 sm:p-8">{children}</div>
        <p className="mt-6 text-center text-xs text-muted">Live well. Live independently. Live legacy.</p>
      </div>
    </main>
  );
}
