import type { DocumentKind } from "@prisma/client";
import { audit, AUDIT_ACTIONS, type Actor } from "../lib/audit";
import { prisma } from "../lib/db";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, sniffMime, storage } from "../lib/storage";
import { NotFoundError, UserError } from "./errors";

export async function addDocument(
  actor: Actor,
  input: { residentId: string; kind: DocumentKind; title: string; referenceNote: string | null; visibleToResident: boolean; file: File | null },
) {
  const resident = await prisma.resident.findUnique({ where: { id: input.residentId }, select: { id: true } });
  if (!resident) throw new NotFoundError("Resident");
  const hasFile = input.file && input.file.size > 0;
  if (!hasFile && !input.referenceNote) throw new UserError("Attach a file or enter a reference note", "file");

  let stored: { key: string; mime: string; size: number; name: string } | null = null;
  if (hasFile) {
    const file = input.file!;
    if (file.size > MAX_UPLOAD_BYTES) throw new UserError("Files must be 10 MB or smaller", "file");
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = sniffMime(buf);
    const ext = mime ? ALLOWED_UPLOAD_TYPES[mime] : undefined;
    if (!mime || !ext) throw new UserError("Upload a PDF, JPG, PNG, WEBP or HEIC file", "file");
    stored = { key: await storage.put(buf, ext), mime, size: buf.length, name: file.name.slice(0, 200) };
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          residentId: input.residentId,
          kind: input.kind,
          title: input.title,
          referenceNote: input.referenceNote,
          visibleToResident: input.visibleToResident,
          storageKey: stored?.key ?? null,
          fileName: stored?.name ?? null,
          mimeType: stored?.mime ?? null,
          sizeBytes: stored?.size ?? null,
          uploadedById: actor.id,
        },
      });
      await audit(tx, actor, AUDIT_ACTIONS.documentAdded, "resident", input.residentId, {
        documentId: doc.id,
        kind: input.kind,
        title: input.title,
        hasFile: Boolean(stored),
      });
      return doc;
    });
  } catch (err) {
    if (stored) await storage.remove(stored.key);
    throw err;
  }
}

export async function archiveDocument(actor: Actor, documentId: string) {
  await prisma.$transaction(async (tx) => {
    const doc = await tx.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundError("Document");
    await tx.document.update({ where: { id: documentId }, data: { archivedAt: new Date() } });
    await audit(tx, actor, AUDIT_ACTIONS.documentArchived, "resident", doc.residentId, { documentId, title: doc.title });
  });
}
