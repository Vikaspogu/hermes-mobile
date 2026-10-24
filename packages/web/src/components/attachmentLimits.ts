export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_SELECTION = 5;

/** Upstream image.attach_bytes silently truncates base64 payloads past 600k chars; 450,000 raw bytes is the largest size that fits. */
export const MAX_IMAGE_ATTACHMENT_BYTES = 450_000;
export const MAX_IMAGE_ATTACHMENT_MIB = Math.round((MAX_IMAGE_ATTACHMENT_BYTES / (1024 * 1024)) * 100) / 100;


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

export function attachmentTooLargeMessage(name: string, maxMiB: number = MAX_ATTACHMENT_MIB): string {
  return `${name} is too large to upload (max ${maxMiB} MB).`;
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
