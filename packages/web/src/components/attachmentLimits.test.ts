import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressImageForUpload, isAllowedAttachmentMime, MAX_IMAGE_ATTACHMENT_BYTES, safeAttachmentBasename, unsupportedAttachmentTypeMessage } from './attachmentLimits';

describe('attachment limits', () => {
  it('sanitizes user-controlled attachment names to a basename', () => {
    expect(safeAttachmentBasename('../secret.txt')).toBe('secret.txt');
    expect(safeAttachmentBasename('C:\\Users\\Alice\\evil.pdf')).toBe('evil.pdf');
    expect(safeAttachmentBasename('\u0000../..//')).toBe('attachment');
    expect(safeAttachmentBasename('...')).toBe('attachment');
  });

  it('strips bidi, zero-width, and normalizes compatibility characters in attachment names', () => {
    expect(safeAttachmentBasename('invoice\u202Egpj.exe')).toBe('invoicegpj.exe');
    expect(safeAttachmentBasename('report\u200Bfinal.txt')).toBe('reportfinal.txt');
    expect(safeAttachmentBasename('full\u00A0width-ＦＯＯ.txt')).toBe('full width-FOO.txt');
  });

  it('allows a small explicit MIME surface', () => {
    expect(isAllowedAttachmentMime({ type: 'text/plain' })).toBe(true);
    expect(isAllowedAttachmentMime({ type: 'text/x-python' })).toBe(true);
    expect(isAllowedAttachmentMime({ type: 'application/json' })).toBe(true);
    expect(isAllowedAttachmentMime({ type: 'application/pdf' })).toBe(true);
    expect(isAllowedAttachmentMime({ type: 'image/png' })).toBe(true);
  });

  it('rejects unknown, empty, and executable-ish MIME types', () => {
    expect(isAllowedAttachmentMime({ type: '' })).toBe(false);
    expect(isAllowedAttachmentMime({ type: 'application/octet-stream' })).toBe(false);
    expect(isAllowedAttachmentMime({ type: 'application/x-msdownload' })).toBe(false);
    expect(unsupportedAttachmentTypeMessage('malware.exe', 'application/x-msdownload')).toContain('not an allowed attachment type');
  });
});

describe('compressImageForUpload', () => {
  const realCreateElement = document.createElement.bind(document);

  function mockCanvas(sizeFor: (width: number, height: number, quality: number) => number, attemptedWidths: number[] = []) {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() }) as unknown as ImageBitmap),
    );
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') return realCreateElement(tag);
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (cb: (blob: Blob | null) => void, _type: string, quality = 1) => {
          if (attemptedWidths[attemptedWidths.length - 1] !== canvas.width) attemptedWidths.push(canvas.width);
          cb(new Blob([new Uint8Array(sizeFor(canvas.width, canvas.height, quality))], { type: 'image/jpeg' }));
        },
      };
      return canvas;
    }) as unknown as typeof document.createElement);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('downscales a large photo into a JPEG under the byte limit', async () => {
    mockCanvas((width, height, quality) => Math.round(width * height * quality * 0.02));
    const file = new File([new Uint8Array(2_000_000)], 'PXL_20261024.png', { type: 'image/png' });
    const out = await compressImageForUpload(file);
    expect(out?.type).toBe('image/jpeg');
    expect(out?.name).toBe('PXL_20261024.jpg');
    expect(out?.size ?? 0).toBeLessThanOrEqual(MAX_IMAGE_ATTACHMENT_BYTES);
  });

  it('returns null when no scale/quality fits, keeping the too-large error path', async () => {
    // coefficient 2 keeps every ladder step over the limit, so all scale runs execute
    const attemptedWidths: number[] = [];
    mockCanvas((width, height, quality) => Math.round(width * height * quality * 2), attemptedWidths);
    const file = new File([new Uint8Array(2_000_000)], 'huge.jpg', { type: 'image/jpeg' });
    expect(await compressImageForUpload(file)).toBeNull();
    // the ladder must start at the 2048px cap and strictly descend
    expect(attemptedWidths[0]).toBe(2048);
    expect(attemptedWidths.length).toBeGreaterThan(1);
    expect(attemptedWidths.every((w, i) => i === 0 || w < (attemptedWidths[i - 1] ?? 0))).toBe(true);
  });

  it('refuses animated formats instead of silently flattening them', async () => {
    const gif = new File([new Uint8Array(2_000_000)], 'clip.gif', { type: 'image/gif' });
    expect(await compressImageForUpload(gif)).toBeNull();
  });
});
