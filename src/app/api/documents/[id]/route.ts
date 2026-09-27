/** Authorized document download. Residents: own + visible docs only. Admins: all. */
import { NextResponse } from "next/server";
import { canAccessResidentRecord } from "@/domain/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Not found", { status: 404 });
  const { id } = await params;
  const doc = await prisma.document.findUnique({ where: { id } });
  const allowed =
    doc &&
    !doc.archivedAt &&
    doc.storageKey &&
    canAccessResidentRecord({ role: user.role, residentId: user.residentId }, doc.residentId) &&
    (user.role === "ADMIN" || doc.visibleToResident);
  if (!allowed) return new NextResponse("Not found", { status: 404 });
  const data = await storage.get(doc.storageKey!);
  const safeName = (doc.fileName ?? doc.title).replace(/[^\w.\- ]+/g, "_").slice(0, 100);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.mimeType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
