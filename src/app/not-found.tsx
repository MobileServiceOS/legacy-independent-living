import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";

export default function NotFound() {
  return (
    <AuthShell title="Page not found" subtitle="The page you're looking for doesn't exist or you don't have access to it.">
      <Link href="/" className="btn-primary w-full">
        Go home
      </Link>
    </AuthShell>
  );
}
