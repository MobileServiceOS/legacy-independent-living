/**
 * Document storage abstraction. MVP stores files on local disk OUTSIDE the
 * public folder; downloads go through an authorized route handler. Swap in
 * S3 / R2 / Supabase Storage by implementing StorageProvider.
 */
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "./env";

export interface StorageProvider {
  put(data: Buffer, ext: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;

const KEY_RE = /^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/;

class LocalDiskStorage implements StorageProvider {
  private root = resolve(env.storageDir);

  private path(key: string) {
    if (!KEY_RE.test(key)) throw new Error("Invalid storage key");
    return join(this.root, key);
  }
  async put(data: Buffer, ext: string) {
    await mkdir(this.root, { recursive: true });
    const key = `${randomUUID()}.${ext}`;
    await writeFile(this.path(key), data, { mode: 0o600 });
    return key;
  }
  async get(key: string) {
    return readFile(this.path(key));
  }
  async remove(key: string) {
    await unlink(this.path(key)).catch(() => undefined);
  }
}

export const storage: StorageProvider = new LocalDiskStorage();

/** Verify magic bytes so a renamed executable can't masquerade as a PDF. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.subarray(4, 12).toString().startsWith("ftyphei")) return "image/heic";
  return null;
}
