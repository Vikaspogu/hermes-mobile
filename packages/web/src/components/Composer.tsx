import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Message, RpcClient } from '@hermes-pwa/core';
import { Icon } from './Icon';
import { AttachMenu } from './AttachMenu';
import { registerBackLayer } from '../lib/backLayers';
import { haptic } from '../pwa/haptics';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_SELECTION,
  attachmentTooLargeMessage,
  isAllowedAttachmentMime,
  tooManyAttachmentsMessage,
  unsupportedAttachmentTypeMessage,
} from './attachmentLimits';

export interface AttachmentDraft {
  id: string;
  name: string;
  path: string;
  /** Image attachments ride on the session (image.attach_bytes) and are not inlined as @file: refs. */
  skipRef?: boolean;
  /** Sanitized basename used for the [Image: …] marker and server-side filename. */
  markerName?: string;
  uploading?: boolean;
  error?: string;
}

interface SlashCommandItem {
  command: string;
  display: string;
  description: string;
  group: string;
}

interface RawSlashEntry {
  text?: unknown;
  display?: unknown;
  meta?: unknown;
  group?: unknown;
}

const PWA_HIDDEN_SLASH_COMMANDS = new Set(['/whoami']);

function textValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (Array.isArray(part)) return String(part[1] ?? '');
        return '';
      })
      .join('')
      .trim();
  }
  return fallback;
}

function commandText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function slashCommandBase(command: string): string {
  return commandText(command).split(/\s+/, 1)[0]?.toLowerCase() ?? '';
}

function isPwaSlashSuggestion(command: string): boolean {
  return !PWA_HIDDEN_SLASH_COMMANDS.has(slashCommandBase(command));
}

function slashItemFromEntry(entry: RawSlashEntry, fallbackGroup = 'Commands'): SlashCommandItem | null {
  const command = commandText(textValue(entry.text));
  if (!command || !command.startsWith('/') || !isPwaSlashSuggestion(command)) return null;
  const display = textValue(entry.display, command);
  return {
    command,
    display: display.startsWith('/') ? display : commandText(display),
    description: textValue(entry.meta),
    group: textValue(entry.group, fallbackGroup),
  };
}

function normalizeSlashItems(raw: unknown): SlashCommandItem[] {
  const result = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const pushUnique = (items: SlashCommandItem[], item: SlashCommandItem | null) => {
    if (!item || seen.has(item.command)) return;
    seen.add(item.command);
    items.push(item);
  };
  const items: SlashCommandItem[] = [];

  if (Array.isArray(result.categories)) {
    for (const category of result.categories) {
      if (!category || typeof category !== 'object') continue;
      const record = category as Record<string, unknown>;
      const group = textValue(record.name, 'Commands');
      const pairs = Array.isArray(record.pairs) ? record.pairs : [];
      for (const pair of pairs) {
        if (!Array.isArray(pair)) continue;
        pushUnique(items, slashItemFromEntry({ text: pair[0], display: pair[0], meta: pair[1], group }, group));
      }
    }
  }

  if (Array.isArray(result.pairs)) {
    for (const pair of result.pairs) {
      if (!Array.isArray(pair)) continue;
      pushUnique(items, slashItemFromEntry({ text: pair[0], display: pair[0], meta: pair[1], group: 'Commands' }));
    }
  }

  if (Array.isArray(result.items)) {
    for (const entry of result.items) {
      if (!entry || typeof entry !== 'object') continue;
      pushUnique(items, slashItemFromEntry(entry as RawSlashEntry));
    }
  }

  return items;
}

function shouldShowSlashPalette(text: string): boolean {
  return /^\/[^\n]*$/u.test(text);
}

function insertSlashCommand(command: string): string {
  const normalized = commandText(command);
  if (!normalized) return '';
  return normalized.includes(' ') ? normalized : `${normalized} `;
}

interface ComposerProps {
  onSend: (text: string) => void;
  slashCommandsRpc?: RpcClient;
  onSteer?: (text: string) => void;
  busySubmitLabel?: string;
  onStop: () => void;
  busy: boolean;
  placeholder?: string;
  modelLabel?: string | undefined;
  messages?: Message[];
  onOpenVoice?: (() => void) | undefined;
  onUploadFile?: (file: File) => Promise<{ path?: string; skipRef?: boolean; markerName?: string } | string | undefined>;
  onLayoutChange?: () => void;
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function Composer({
  onSend,
  slashCommandsRpc,
  onSteer,
  busySubmitLabel = 'Steer agent',
  onStop,
  busy,
  placeholder = 'Message Hermes…',
  modelLabel,
  onOpenVoice,
  onUploadFile,
  onLayoutChange,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [slashLoading, setSlashLoading] = useState(false);
  const [slashItems, setSlashItems] = useState<SlashCommandItem[]>([]);
  const [slashError, setSlashError] = useState<string | undefined>();
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashSuppressedText, setSlashSuppressedText] = useState<string | undefined>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaHeightRef = useRef<string>('');

  const hasText = text.trim().length > 0;
  const hasPayload = hasText || attachments.some((a) => !a.uploading && !a.error && (a.path || a.skipRef));
  const slashPaletteOpen = shouldShowSlashPalette(text) && Boolean(slashCommandsRpc) && slashSuppressedText !== text;



  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = Math.round((window.visualViewport?.height ?? window.innerHeight) * 0.5); // Telegram-style: grow to half the visible area, then scroll
    const nextHeight = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.height = nextHeight;
    if (textareaHeightRef.current !== nextHeight) {
      textareaHeightRef.current = nextHeight;
      onLayoutChange?.();
    }
  }, [onLayoutChange]);

  useEffect(() => {
    resize();
  }, [text, placeholder, resize]);

  // Re-clamp when the viewport changes (device rotation, on-screen keyboard).
  useEffect(() => {
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, [resize]);

  useEffect(() => {
    if (!slashPaletteOpen || !slashCommandsRpc) {
      setSlashItems([]);
      setSlashLoading(false);
      setSlashError(undefined);
      setSlashActiveIndex(0);
      return;
    }

    let cancelled = false;
    setSlashLoading(true);
    setSlashError(undefined);

    const load = async () => {
      try {
        const raw = text === '/'
          ? await slashCommandsRpc.request('commands.catalog')
          : await slashCommandsRpc.request('complete.slash', { text });
        if (cancelled) return;
        const items = normalizeSlashItems(raw).slice(0, 24);
        setSlashItems(items);
        setSlashActiveIndex(0);
        setSlashError(undefined);
      } catch (err) {
        if (cancelled) return;
        setSlashItems([]);
        setSlashError(err instanceof Error ? err.message : 'Slash commands unavailable');
      } finally {
        if (!cancelled) setSlashLoading(false);
      }
    };

    const timer = window.setTimeout(load, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [slashPaletteOpen, slashCommandsRpc, text]);

  const groupedSlashItems = useMemo(() => {
    const groups: Array<{ name: string; items: Array<{ item: SlashCommandItem; index: number }> }> = [];
    slashItems.forEach((item, index) => {
      const groupName = item.group || 'Commands';
      let group = groups.find((candidate) => candidate.name === groupName);
      if (!group) {
        group = { name: groupName, items: [] };
        groups.push(group);
      }
      group.items.push({ item, index });
    });
    return groups;
  }, [slashItems]);

  const closeSlashPalette = useCallback(() => {
    setSlashItems([]);
    setSlashLoading(false);
    setSlashError(undefined);
    setSlashActiveIndex(0);
  }, []);

  const selectSlashCommand = useCallback(
    (item: SlashCommandItem) => {
      const inserted = insertSlashCommand(item.command);
      setText(inserted);
      setSlashSuppressedText(inserted);
      closeSlashPalette();
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
        resize();
      });
    },
    [closeSlashPalette, resize],
  );

  // Back layers (Android/browser Back): sheets and the slash palette close
  // before navigation; a focused composer dismisses the keyboard first.
  useEffect(() => {
    if (!attachMenuOpen) return undefined;
    return registerBackLayer({ priority: 20, dismiss: () => setAttachMenuOpen(false) });
  }, [attachMenuOpen]);

  useEffect(() => {
    if (!slashPaletteOpen) return undefined;
    return registerBackLayer({ priority: 20, dismiss: closeSlashPalette });
  }, [slashPaletteOpen, closeSlashPalette]);

  const keyboardLayerDispose = useRef<(() => void) | null>(null);
  useEffect(() => () => keyboardLayerDispose.current?.(), []);
  const handleTextareaFocus = useCallback(() => {
    keyboardLayerDispose.current?.();
    keyboardLayerDispose.current = registerBackLayer({ priority: 10, dismiss: () => textareaRef.current?.blur() });
  }, []);
  const handleTextareaBlur = useCallback(() => {
    keyboardLayerDispose.current?.();
    keyboardLayerDispose.current = null;
  }, []);


  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();

    const trimmed = text.trim();
    const refs = attachments
      .filter((a) => !a.uploading && !a.error)
      // skipRef images already reached the agent via image.attach_bytes; the marker
      // keeps the sent image visible in the chat bubble and in durable history.
      .map((a) => (a.skipRef ? `[Image: ${a.markerName ?? a.name}]` : a.path ? `@file:${a.path}` : ''))
      .filter(Boolean);
    const finalText = [trimmed, ...refs].filter(Boolean).join('\n\n');
    if (!finalText) return;
    if (busy) {
      if (!onSteer) return;
      haptic('tap');
      onSteer(finalText);
    } else {
      haptic('tap');
      onSend(finalText);
    }
    setText('');
    setSlashSuppressedText(undefined);
    setAttachments([]);
    closeSlashPalette();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (slashPaletteOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSlashPalette();
        return;
      }
      if (slashItems.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        setSlashActiveIndex((index) => {
          const delta = e.key === 'ArrowDown' ? 1 : -1;
          return (index + delta + slashItems.length) % slashItems.length;
        });
        return;
      }
      if (slashItems.length > 0 && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))) {
        e.preventDefault();
        selectSlashCommand(slashItems[Math.min(slashActiveIndex, slashItems.length - 1)]!);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || !onUploadFile) return;
    const selected = Array.from(files).map((file, index) => {
      const error =
        index >= MAX_ATTACHMENTS_PER_SELECTION
          ? tooManyAttachmentsMessage()
          : file.size > MAX_ATTACHMENT_BYTES
            ? attachmentTooLargeMessage(file.name)
            : !isAllowedAttachmentMime(file)
              ? unsupportedAttachmentTypeMessage(file.name, file.type)
              : undefined;
      const draft: AttachmentDraft = error
        ? { id: makeId(), name: file.name, path: '', uploading: false, error }
        : { id: makeId(), name: file.name, path: '', uploading: true };
      return {
        file,
        draft,
        error,
      };
    });
    setAttachments((prev) => [...prev, ...selected.map((item) => item.draft)]);

    await Promise.all(
      selected
        .filter((item) => !item.error)
        .map(async ({ file, draft }) => {
          try {
            const result = await onUploadFile(file);
            if (typeof result === 'object' && result?.skipRef) {
              setAttachments((prev) =>
                prev.map((a) =>
                  a.id === draft.id
                    ? { ...a, skipRef: true, uploading: false, ...(result.markerName ? { markerName: result.markerName } : {}) }
                    : a,
                ),
              );
              return;
            }
            const path = typeof result === 'string' ? result : result?.path;
            if (!path) throw new Error('Upload did not return a path.');
            setAttachments((prev) =>
              prev.map((a) => (a.id === draft.id ? { ...a, path, uploading: false } : a)),
            );
          } catch (err) {
            setAttachments((prev) =>
              prev.map((a) =>
                a.id === draft.id
                  ? { ...a, uploading: false, error: err instanceof Error ? err.message : 'Upload failed' }
                  : a,
              ),
            );
          }
        }),
    );
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }



  return (
    <form className="hm-composer" onSubmit={handleSubmit}>
      {attachments.length > 0 && (
        <div className="hm-composer__attachments">
          {attachments.map((a) => (
            <span key={a.id} className={`hm-composer__chip ${a.error ? 'hm-composer__chip--error' : ''}`}>
              <span className="hm-composer__chip-name">{a.name}</span>
              {a.uploading && <span className="hm-composer__chip-spin" />}
              {a.error && <span className="hm-composer__chip-error" aria-label={a.error}>{a.error}</span>}
              {!a.uploading && (
                <button
                  type="button"
                  className="hm-composer__chip-remove"
                  onClick={() => removeAttachment(a.id)}
                  aria-label={`Remove ${a.name}`}
                >
                  <Icon name="close" size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {slashPaletteOpen && (
        <div className="hm-slash-palette" role="listbox" aria-label="Slash commands">
          <div className="hm-slash-palette__header">
            <span>Slash commands</span>
            {slashLoading ? <span className="hm-slash-palette__status">Loading…</span> : null}
          </div>
          {slashError ? <div className="hm-slash-palette__empty">{slashError}</div> : null}
          {!slashError && !slashLoading && slashItems.length === 0 ? (
            <div className="hm-slash-palette__empty">No matching commands</div>
          ) : null}
          {!slashError && groupedSlashItems.map((group) => (
            <div className="hm-slash-palette__group" key={group.name}>
              <div className="hm-slash-palette__group-title">{group.name}</div>
              {group.items.map(({ item, index }) => (
                <button
                  key={`${item.command}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === slashActiveIndex}
                  className={`hm-slash-palette__item ${index === slashActiveIndex ? 'hm-slash-palette__item--active' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSlashCommand(item)}
                >
                  <span className="hm-slash-palette__command">{item.display}</span>
                  {item.description ? <span className="hm-slash-palette__description">{item.description}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="hm-composer__pill">
        {modelLabel && <span className="hm-composer__model">{modelLabel}</span>}
          <button
            type="button"
            className="hm-composer__action"
            onClick={() => {
              haptic('tap');
              setAttachMenuOpen((v) => !v);
            }}
            disabled={!onUploadFile}
            aria-label="Add attachment"
          >
            <Icon name="plus" size={19} />
          </button>
          <AttachMenu open={attachMenuOpen} onClose={() => setAttachMenuOpen(false)} onFiles={handleFilesSelected} />
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            const nextText = e.target.value;
            setText(nextText);
            if (slashSuppressedText !== undefined && nextText !== slashSuppressedText) {
              setSlashSuppressedText(undefined);
            }
          }}
          onKeyDown={handleKeyDown}
          onFocus={handleTextareaFocus}
          onBlur={handleTextareaBlur}
          placeholder={placeholder}
          aria-label="Message input"
          rows={text ? 1 : placeholder.split('\n').length}
        />

        <div className="hm-composer__toolbar">


          {onOpenVoice && (
            <button
              type="button"
              className="hm-composer__action"
              onClick={onOpenVoice}
              aria-label="Open voice call"
              title="Voice call"
            >
              <Icon name="mic" size={19} />
            </button>
          )}

          {busy && !hasPayload ? (
            <button
              type="button"
              className="hm-composer__stop"
              onClick={() => {
                haptic('tap');
                onStop();
              }}
              aria-label="Stop generating"
            >
              <Icon name="close" size={16} />
            </button>
          ) : (
            <button
              type="submit"
              className="hm-composer__send"
              disabled={!hasPayload || (busy && !onSteer)}
              aria-label={busy ? busySubmitLabel : 'Send message'}
            >
              <Icon name="arrowUp" size={19} />
            </button>
          )}
        </div>
      </div>

    </form>
  );
}
