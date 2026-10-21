import type { Tx } from './db';

const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

/** Save an uploaded File from FormData as an Attachment. Returns null when no file was chosen. */
export async function saveUpload(tx: Tx, file: FormDataEntryValue | null, userId: number, jobId?: number) {
  if (!file || typeof file === 'string' || file.size === 0) return null;
  if (file.size > MAX_BYTES) throw new Error('File is too large (max 3 MB).');
  if (!ALLOWED.includes(file.type)) throw new Error('Only images or PDF files can be uploaded.');
  const data = Buffer.from(await file.arrayBuffer());
  return tx.attachment.create({
    data: { filename: file.name || 'upload', mimeType: file.type, size: file.size, data, jobId: jobId ?? null, createdById: userId },
  });
}
