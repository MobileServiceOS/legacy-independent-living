/** Authorized maintenance photo. Staff: any. Residents: only photos on their own requests. */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { storage } from "@/lib/storage";
import { getPhotoForViewer } from "@/server/maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Not found", { status: 404 });
  const { id } = await params;
  const photo = await getPhotoForViewer(id, { role: user.role, residentId: user.residentId });
  if (!photo) return new NextResponse("Not found", { status: 404 });
  const data = await storage.get(photo.storageKey);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": photo.mimeType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
