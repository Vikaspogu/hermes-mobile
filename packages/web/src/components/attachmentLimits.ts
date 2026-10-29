export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_SELECTION = 5;

/** Upstream image.attach_bytes silently truncates base64 payloads past 600k chars; 450,000 raw bytes is the largest size that fits. */
export const MAX_IMAGE_ATTACHMENT_BYTES = 450_000;
export const MAX_IMAGE_ATTACHMENT_MIB = Math.round((MAX_IMAGE_ATTACHMENT_BYTES / (1024 * 1024)) * 100) / 100;


const IMAGE_COMPRESS_MAX_DIMENSION = 2048;
const IMAGE_COMPRESS_SCALES = [1, 0.7, 0.5];
const IMAGE_COMPRESS_QUALITIES = [0.85, 0.7, 0.5, 0.35];

/**
 * Downscales and re-encodes an image to fit the upstream attach limit.
 * Returns a File under maxBytes, or null when the image cannot be compressed
 * enough (caller keeps the original too-large error). JPEG/PNG only: animated
 * GIF/WebP would silently lose their animation, and SVG would be rasterized,
 * so those fall back to the too-large error. PNG loses alpha in the JPEG
 * re-encode (ponytail: alpha edge accepted — vision use-cases rarely need it).
 * Calls are serialized because each attempt holds a full-resolution
 * ImageBitmap plus a 2048px canvas in memory — a real OOM risk on mobile
 * when several photos upload at once.
 */
let compressionQueue: Promise<unknown> = Promise.resolve();

export function compressImageForUpload(file: File, maxBytes: number = MAX_IMAGE_ATTACHMENT_BYTES): Promise<File | null> {
  const job = compressionQueue.then(() => compressImageImpl(file, maxBytes));
  compressionQueue = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

async function compressImageImpl(file: File, maxBytes: number): Promise<File | null> {
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') return null;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const baseScale = Math.min(1, IMAGE_COMPRESS_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height, 1));
    for (const scaleStep of IMAGE_COMPRESS_SCALES) {
      const scale = baseScale * scaleStep;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of IMAGE_COMPRESS_QUALITIES) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (blob && blob.size <= maxBytes) {
          const baseName = safeAttachmentBasename(file.name).replace(/\.[a-z0-9]+$/i, '') || SAFE_ATTACHMENT_FALLBACK;
          return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
        }
      }
    }
    return null;
  } finally {
    bitmap.close();
  }
}

const MAX_ATTACHMENT_MIB = Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024));

const SAFE_ATTACHMENT_FALLBACK = 'attachment';

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'application/json',
  'application/pdf',
  'text/csv',
  'text/markdown',
  'text/plain',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const ALLOWED_ATTACHMENT_MIME_PREFIXES = ['text/'];

export function attachmentTooLargeMessage(maxMiB: number = MAX_ATTACHMENT_MIB): string {
  return `Too large to upload (max ${maxMiB} MB).`;
}

export function tooManyAttachmentsMessage(): string {
  return `Only ${MAX_ATTACHMENTS_PER_SELECTION} files can be attached at once.`;
}

export function unsupportedAttachmentTypeMessage(name: string, mimeType: string): string {
  const type = mimeType || 'unknown type';
  return `${name} cannot be uploaded (${type} is not an allowed attachment type).`;
}

export function isAllowedAttachmentMime(file: Pick<File, 'type'>): boolean {
  const mimeType = String(file.type || '').trim().toLowerCase();
  if (!mimeType) return false;
  return ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType) || ALLOWED_ATTACHMENT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

export function safeAttachmentBasename(name: string): string {
  const normalized = String(name || '')
    .normalize('NFKC')
    .replace(/[\u202a-\u202e\u2066-\u2069\u200b-\u200d\ufeff]+/giu, '')
    .replace(/[\\/]+/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() ?? '';
  const cleaned = normalized
    // eslint-disable-next-line no-control-regex -- strips C0/DEL bytes from user-controlled filenames.
    .replace(/[\x00-\x1f\x7f]+/g, '_')
    .replace(/[<>:"|?*]+/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
  return cleaned || SAFE_ATTACHMENT_FALLBACK;
}
