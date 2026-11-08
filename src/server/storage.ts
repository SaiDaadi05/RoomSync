import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { invalid } from "./errors";

/**
 * Minimal storage abstraction for receipts. The local driver writes outside /public,
 * so files are only reachable through the authorized /api/receipts route.
 * Swap in an S3/R2 driver later by implementing the same three functions.
 */
const root = () => path.resolve(process.env.STORAGE_DIR || "./storage");

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  "image/png": { ext: "png", magic: (b) => b.subarray(0, 4).toString("hex") === "89504e47" },
  "image/webp": { ext: "webp", magic: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  "image/heic": { ext: "heic", magic: (b) => b.subarray(4, 8).toString() === "ftyp" },
  "application/pdf": { ext: "pdf", magic: (b) => b.subarray(0, 4).toString() === "%PDF" },
};

export function validateReceipt(buf: Buffer, mime: string) {
  const spec = ALLOWED[mime];
  if (!spec) throw invalid("Receipts must be a JPG, PNG, WEBP, HEIC or PDF");
  if (buf.length === 0) throw invalid("That file is empty");
  if (buf.length > RECEIPT_MAX_BYTES) throw invalid("Receipts must be 5 MB or smaller");
  if (!spec.magic(buf)) throw invalid("That file doesn't look like the type it claims to be");
  return spec.ext;
}

function resolveKey(key: string) {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Invalid storage key");
  return full;
}

export async function putReceipt(householdId: string, buf: Buffer, mime: string) {
  const ext = validateReceipt(buf, mime);
  const key = `receipts/${householdId}/${crypto.randomUUID()}.${ext}`;
  const full = resolveKey(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf);
  return key;
}

export async function readObject(key: string) {
  return fs.readFile(resolveKey(key));
}

export async function deleteObject(key: string) {
  await fs.rm(resolveKey(key), { force: true });
}
