import { create } from 'zustand';
import {
  findSessionByAlias,
  sessionLineageKey,
  type Message,
  type ToolCall,
} from '../domain/session';
import { useSessionsStore } from './sessions';
import { JsonRpcError, type RpcClient } from '../transport/jsonrpc';
import { HermesHttpError } from '../transport/http';
import type { RestClient } from '../transport/rest';
import { LONG_RPC_TIMEOUT_MS } from '../transport/timeouts';

const LEGACY_ACTIVE_SESSION_STORAGE_KEYS = ['hermes-pwa.activeSession.v1', 'hermes-pwa.activeSession.v2'] as const;
const ACTIVE_SESSION_STORAGE_KEY = 'hermes-pwa.activeSession.v3';
const PROFILED_ACTIVE_SESSION_STORAGE_KEY_PREFIX = 'hermes-pwa.activeSession.v4';
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
const PWA_UNSUPPORTED_SLASH_COMMANDS = new Set(['/whoami']);
const MAX_ALIAS_DISPATCH_DEPTH = 8;
const PROMPT_SUBMIT_TIMEOUT_MS = 90_000;
let assistantMessageSequence = 0;
let systemMessageSequence = 0;
let userMessageSequence = 0;
const submitInFlightKeys = new Set<string>();
const interruptInFlightKeys = new Set<string>();
const aliasDispatchStack: string[] = [];

function nextAssistantMessageId(): string {
  assistantMessageSequence += 1;
  return `a-${Date.now()}-${assistantMessageSequence}`;
}

function nextUserMessageId(): string {
  userMessageSequence += 1;
  return `u-${Date.now()}-${userMessageSequence}`;
}

function nextSystemMessageId(): string {
  systemMessageSequence += 1;
  return `sys-${Date.now()}-${systemMessageSequence}`;
}

interface ActiveSessionCache {
  sessionId: string | undefined;
  storedSessionId: string | undefined;
  messages: Message[];
  streaming: boolean;
  profile: string | undefined;
}

const ACTIVE_SESSION_PERSIST_THROTTLE_MS = 1000;

export type SubmitResult = 'submitted' | 'busy' | 'failed';

export interface InterruptOptions {
  keepStreaming?: boolean;
}

interface SlashExecResponse {
  output?: string | undefined;
  warning?: string | undefined;
}

interface ExecCommandDispatchResponse {
  type: 'exec';
  output?: string | undefined;
}

interface PluginCommandDispatchResponse {
  type: 'plugin';
  output?: string | undefined;
}

interface AliasCommandDispatchResponse {
  type: 'alias';
  target: string;
}

interface SkillCommandDispatchResponse {
  type: 'skill';
  name: string;
  message?: string | undefined;
}

interface SendCommandDispatchResponse {
  type: 'send';
  message: string;
  notice?: string | undefined;
}

type CommandDispatchResponse =
  | ExecCommandDispatchResponse
  | PluginCommandDispatchResponse
  | AliasCommandDispatchResponse
  | SkillCommandDispatchResponse
  | SendCommandDispatchResponse;

export interface ChatStore {
  /** Live runtime session id used for prompt.submit/history/interrupt. */
  sessionId: string | undefined;
  /** Durable stored session id used for session.resume and drawer selection. */
  storedSessionId: string | undefined;
  /** Session id the in-flight prompt was submitted on; WS events for it belong to this chat even if a mid-turn refresh swaps sessionId. Cleared on session switch and turn end. */
  lastSubmittedSessionId: string | undefined;
  /** Stored id minted by session.create in this app run; its server row is deferred to the first turn, so absence/404 is not proof it ended. */
  locallyCreatedStoredId: string | undefined;
  messages: Message[];
  streaming: boolean;
  error: string | undefined;

  /** Internal cache scope; not shown in UI. */
  cacheProfile: string | undefined;
  setSessionId(id: string | undefined, storedSessionId?: string | undefined): void;
  loadHistory(rest: RestClient, sessionId: string): Promise<void>;
  refreshHistory(rest: RestClient, profile?: string): Promise<void>;
  restore(rest: RestClient, rpc: RpcClient, profile?: string): Promise<void>;
  resumeSessionIntoChat(rest: RestClient, rpc: RpcClient, storedSessionId: string, profile?: string): Promise<void>;
  startNewSession(profile?: string): void;
  ensureLiveSession(rpc: RpcClient, profile?: string): Promise<{ sessionId: string; storedSessionId?: string | undefined }>;
  submit(rpc: RpcClient, text: string, profile?: string): Promise<SubmitResult>;
  executeSlashCommand(rpc: RpcClient, text: string, profile?: string): Promise<SubmitResult>;
  steer(rpc: RpcClient, text: string): Promise<boolean>;
  interrupt(rpc: RpcClient, options?: InterruptOptions): Promise<void>;
  appendDelta(text: string): void;
  finishAssistant(finalText?: string | undefined): void;
  failAssistant(error: string): void;
  markIdle(): void;
  appendToolCall(tool: ToolCall): void;
  updateToolCall(id: string, patch: Partial<ToolCall>): void;
  appendThinking(text: string, replace?: boolean): void;
  beginAssistant(): void;
  clear(profile?: string): void;
}

interface InternalMessage extends Message {
  /** Populated for raw tool messages so we can attach their output to the matching assistant tool call. */
  toolCallId?: string | undefined;
  toolName?: string | undefined;
}

type ActiveSessionPersistState = Pick<ChatStore, 'sessionId' | 'storedSessionId' | 'messages' | 'streaming'> & {
  cacheProfile?: string | undefined;
};

let pendingActiveSessionPersist: ActiveSessionPersistState | undefined;
let activeSessionPersistTimer: ReturnType<typeof setTimeout> | undefined;
let visibilityFlushListenerInstalled = false;

function toolMessageText(raw: Record<string, unknown>): string {
  const content = raw.content ?? raw.text ?? raw.context;
  return messageContentText(content);
}

function messageContentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const record = part as Record<string, unknown>;
          return messageContentText(record.text ?? record.content ?? record.value ?? record.input ?? record.output);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const nested = messageContentText(record.text ?? record.content ?? record.value ?? record.message);
    if (nested) return nested;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseToolInput(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return { raw: value };
  }
}

function normalizeToolCall(raw: unknown, index: number): ToolCall | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const fn = record.function && typeof record.function === 'object' ? (record.function as Record<string, unknown>) : undefined;
  const name =
    (typeof record.name === 'string' && record.name) ||
    (typeof fn?.name === 'string' && fn.name) ||
    (typeof record.tool_name === 'string' && record.tool_name) ||
    'tool';
  const tool: ToolCall = {
    id: String(record.id ?? record.tool_call_id ?? `tool-${index}`),
    name,
  };
  const input = parseToolInput(record.input ?? record.args ?? record.arguments ?? fn?.arguments ?? fn?.args);
  if (input) tool.input = input;
  const output = record.output ?? record.result;
  if (typeof output === 'string') tool.output = output;
  else if (output !== undefined) {
    try {
      tool.output = JSON.stringify(output);
    } catch {
      tool.output = String(output);
    }
  }
  return tool;
}

function normalizeToolCalls(raw: unknown): ToolCall[] | undefined {
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return normalizeToolCalls(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(raw)) return undefined;
  const tools = raw.map(normalizeToolCall).filter((tool): tool is ToolCall => tool !== null);
  return tools.length > 0 ? tools : undefined;
}

function normalizeMessageRole(value: unknown): Message['role'] {
  return value === 'user' || value === 'assistant' || value === 'system' || value === 'tool' ? value : 'assistant';
}

function messageCreatedAt(raw: Record<string, unknown>): number | undefined {
  const value = raw.created_at ?? raw.createdAt ?? raw.timestamp;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed / 1000 : undefined;
  }
  return undefined;
}

// The gateway rewrites `[Image: name]` markers in stored user prompts and
// appends the server-side path as an `@image:/…` line. Strip those lines at
// ingest so history matches the optimistic echo (fingerprint dedupe) and
// bubbles never show internal paths.
const SERVER_INJECTED_IMAGE_REF = /^@image:\S+$/u;

function stripServerInjectedImageRefs(text: string): string {
  if (!text.includes('@image:')) return text;
  return text
    .split('\n')
    .filter((line) => !SERVER_INJECTED_IMAGE_REF.test(line.trim()))
    .join('\n');
}

// Hermes injects delegation fan-out results into the session as user-role
// messages. They are agent plumbing, not user input — never render them.
const DELEGATION_INJECTION_PREFIX = '[ASYNC DELEGATION';

function isDelegationInjection(message: InternalMessage): boolean {
  if (message.role !== 'user') return false;
  // Require the deleg_<id> token so a user hand-typing the phrase is kept.
  const firstLine = message.text.trimStart().split('\n', 1)[0] ?? '';
  return firstLine.startsWith(DELEGATION_INJECTION_PREFIX) && firstLine.includes('deleg_');
}

function toInternalMessage(raw: Record<string, unknown>, index = 0): InternalMessage {
  const role = normalizeMessageRole(raw.role);
  const rawText =
    typeof raw.text === 'string'
      ? raw.text
      : role === 'tool'
        ? toolMessageText(raw)
        : messageContentText(raw.content ?? raw.message ?? raw.rendered);
  const text = role === 'user' ? stripServerInjectedImageRefs(rawText) : rawText;
  const msg: InternalMessage = {
    id: String(raw.id ?? `m-${index}`),
    role,
    text,
    createdAt: messageCreatedAt(raw),
  };
  if (role === 'tool') {
    msg.toolCallId = typeof raw.tool_call_id === 'string' ? raw.tool_call_id : undefined;
    msg.toolName = typeof raw.tool_name === 'string' ? raw.tool_name : typeof raw.name === 'string' ? raw.name : undefined;
  }
  const toolCalls = normalizeToolCalls(raw.tool_calls ?? raw.toolCalls);
  if (toolCalls) msg.toolCalls = toolCalls;
  const thinking = messageContentText(raw.thinking ?? raw.reasoning ?? raw.reasoning_content ?? raw.reasoningContent);
  if (thinking) msg.thinking = thinking;
  return msg;
}

function toPublicMessage(m: InternalMessage): Message {
  const msg: Message = {
    id: m.id,
    role: m.role,
    text: m.text,
    createdAt: m.createdAt,
  };
  if (m.toolCalls) msg.toolCalls = m.toolCalls;
  if (m.thinking) msg.thinking = m.thinking;
  return msg;
}

function mergeToolMessages(messages: InternalMessage[]): InternalMessage[] {
  const out: InternalMessage[] = [];
  for (const m of messages) {
    if (m.role !== 'tool') {
      out.push(m);
      continue;
    }

    const toolCallId = m.toolCallId;
    const toolName = m.toolName;
    let attached = false;

    for (let i = out.length - 1; i >= 0; i -= 1) {
      const candidate = out[i];
      if (!candidate || candidate.role !== 'assistant' || !candidate.toolCalls || candidate.toolCalls.length === 0) {
        continue;
      }

      const matchIndex = candidate.toolCalls.findIndex(
        (t) =>
          (toolCallId && t.id === toolCallId) ||
          (toolName && t.name === toolName && t.output === undefined),
      );

      if (matchIndex >= 0) {
        const matched = candidate.toolCalls[matchIndex];
        if (!matched) continue;
        const nextTools = [...candidate.toolCalls];
        nextTools[matchIndex] = { ...matched, output: m.text };
        out[i] = { ...candidate, toolCalls: nextTools };
        attached = true;
        break;
      }
    }

    if (!attached) {
      for (let i = out.length - 1; i >= 0; i -= 1) {
        const assistant = out[i];
        if (!assistant || assistant.role !== 'assistant') {
          continue;
        }
        const existing = assistant.toolCalls ?? [];
        out[i] = {
          ...assistant,
          toolCalls: [...existing, { id: m.id, name: toolName || 'tool', output: m.text }],
        };
        attached = true;
        break;
      }
    }
  }

  return out;
}

function messagesFromResult(raw: unknown): Message[] {
  let maybeMessages: unknown[] = [];
  if (Array.isArray(raw)) {
    maybeMessages = raw;
  } else if (raw && typeof raw === 'object') {
    const candidate = (raw as Record<string, unknown>).messages;
    if (Array.isArray(candidate)) maybeMessages = candidate;
  }
  const internal = maybeMessages
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map(toInternalMessage)
    .filter((message) => !isDelegationInjection(message));
  return mergeToolMessages(internal).map(toPublicMessage);
}

function liveSessionIdFromResult(raw: unknown): string {
  if (!raw || typeof raw !== 'object') {
    throw new Error('session.create/resume returned an invalid response.');
  }
  const record = raw as Record<string, unknown>;
  const id = record.session_id ?? record.id;
  if (typeof id !== 'string' || !id) {
    throw new Error('session.create/resume returned no session_id.');
  }
  return id;
}

function durableSessionIdFromResult(raw: unknown, fallback: string | undefined): string | undefined {
  if (!raw || typeof raw !== 'object') return fallback;
  const record = raw as Record<string, unknown>;
  const id = record.stored_session_id ?? record.storedSessionId ?? record.session_key ?? record.stored_session_key ?? record.resumed;
  return typeof id === 'string' && id ? id : fallback;
}

function storedSessionIdFromMessagesResult(raw: unknown, fallback: string): string {
  if (!raw || typeof raw !== 'object') return fallback;
  const record = raw as Record<string, unknown>;
  const id = record.session_id ?? record.sessionId;
  return typeof id === 'string' && id ? id : fallback;
}


function isSessionNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as Record<string, unknown>;
  if (record.code === 4001) return true;
  if (typeof record.message === 'string' && /session not found/i.test(record.message)) return true;
  const rpcError = record.rpcError;
  if (rpcError && typeof rpcError === 'object') {
    const rpcRecord = rpcError as Record<string, unknown>;
    if (rpcRecord.code === 4001) return true;
    if (typeof rpcRecord.message === 'string' && /session not found/i.test(rpcRecord.message)) return true;
  }
  if (err instanceof Error) {
    return /4001|session not found/i.test(err.message);
  }
  return false;
}

function normalizeReasoningComparable(text: string): string {
  return text
    .replace(/[`*_>#-]/g, ' ')
    .replace(/[\u2022\u25e6]/g, ' ')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isDuplicateReasoning(reasoning: string | undefined, answer: string | undefined): boolean {
  if (!reasoning || !answer) return false;
  const r = normalizeReasoningComparable(reasoning);
  const a = normalizeReasoningComparable(answer);
  if (!r || !a) return false;
  if (r === a) return true;
  if (a.length >= 40 && r.includes(a)) return true;
  if (r.length < 80 || a.length < 80) return false;
  return r.startsWith(a) || a.startsWith(r);
}

function messageFingerprint(message: Message): string {
  // Intentionally exclude toolCalls from the fingerprint. The same assistant
  // message can have different tool call shapes between the realtime WS stream
  // and the REST session snapshot (different ids, missing output, different
  // ordering). Including them causes the merge to treat the REST version as a
  // different message and drop the local one with its inline approval UI.
  return JSON.stringify([
    message.role,
    message.text,
    message.thinking ?? '',
  ]);
}

function toolCallKey(tool: ToolCall): string {
  return tool.id || `${tool.name}:${JSON.stringify(tool.input ?? {})}`;
}

function mergeToolCallsPreservingLocalPending(historyTools: ToolCall[] | undefined, localTools: ToolCall[] | undefined): ToolCall[] | undefined {
  const pendingLocal = (localTools ?? []).filter((tool) => tool.output === undefined);
  if (pendingLocal.length === 0) return historyTools;
  const merged = [...(historyTools ?? [])];
  const keys = new Set(merged.map(toolCallKey));
  for (const tool of pendingLocal) {
    const key = toolCallKey(tool);
    if (keys.has(key)) continue;
    merged.push(tool);
    keys.add(key);
  }
  return merged;
}

function mergeHistoryMessageWithLocal(historyMessage: Message, localMessage: Message): Message {
  const toolCalls = mergeToolCallsPreservingLocalPending(historyMessage.toolCalls, localMessage.toolCalls);
  const keepLocalThinking = historyMessage.thinking === undefined && localMessage.thinking !== undefined;
  if ((!toolCalls || toolCalls === historyMessage.toolCalls) && !keepLocalThinking) return historyMessage;
  return {
    ...historyMessage,
    ...(toolCalls ? { toolCalls } : {}),
    ...(keepLocalThinking ? { thinking: localMessage.thinking } : {}),
  };
}

function isEmptyAssistantPlaceholder(message: Message): boolean {
  return message.role === 'assistant' && message.text.trim() === '' && (message.thinking ?? '').trim() === '';
}

function hasCompletedHistoryAssistantForLocalTurn(history: Message[], local: Message[], localIndex: number): boolean {
  for (let i = localIndex - 1; i >= 0; i -= 1) {
    const localMessage = local[i];
    if (!localMessage) continue;
    if (localMessage.role !== 'user') continue;
    const userKey = messageFingerprint(localMessage);
    const historyUserIndex = history.findIndex((historyMessage) => messageFingerprint(historyMessage) === userKey);
    if (historyUserIndex < 0) return false;
    for (let j = historyUserIndex + 1; j < history.length; j += 1) {
      const historyMessage = history[j];
      if (!historyMessage) continue;
      if (historyMessage.role === 'user') return false;
      if (historyMessage.role === 'assistant' && historyMessage.text.trim() !== '') return true;
    }
    return false;
  }
  return false;
}

function shouldDropLocalTailMessage(history: Message[], local: Message[], localIndex: number, message: Message): boolean {
  // A backgrounded PWA can keep the realtime tool-call placeholder after REST already has the final answer.
  // Drop only that same-turn placeholder; keep pending approval/tool rows when REST has no completed answer yet.
  return isEmptyAssistantPlaceholder(message) && hasCompletedHistoryAssistantForLocalTurn(history, local, localIndex);
}

function mergeHistoryWithLocal(history: Message[], local: Message[]): { messages: Message[]; preservedLocalTail: Message[] } {
  if (local.length === 0) {
    return { messages: history, preservedLocalTail: [] };
  }

  const consumedLocal = new Set<number>();
  const mergedHistory = history.map((historyMessage) => {
    const key = messageFingerprint(historyMessage);
    let localIndex = local.findIndex((localMessage, index) => !consumedLocal.has(index) && messageFingerprint(localMessage) === key);
    if (localIndex < 0) {
      // The realtime stream can carry fields REST does not persist (thinking,
      // trailing whitespace). Fall back to role+text so the same message is not
      // duplicated as a preserved local tail.
      localIndex = local.findIndex(
        (localMessage, index) =>
          !consumedLocal.has(index) &&
          localMessage.role === historyMessage.role &&
          localMessage.text.trim() === historyMessage.text.trim(),
      );
    }
    if (localIndex < 0) return historyMessage;
    const localMatch = local[localIndex];
    if (!localMatch) return historyMessage;
    consumedLocal.add(localIndex);
    return mergeHistoryMessageWithLocal(historyMessage, localMatch);
  });

  const preservedLocalTail = local.filter((message, index) => {
    if (consumedLocal.has(index)) return false;
    return !shouldDropLocalTailMessage(history, local, index, message);
  });

  return { messages: [...mergedHistory, ...preservedLocalTail], preservedLocalTail };
}

function dropPendingOptimisticTail(messages: Message[]): Message[] {
  const last = messages[messages.length - 1];
  const prev = messages[messages.length - 2];
  if (last?.role === 'assistant' && last.text.trim() === '' && prev?.role === 'user') {
    return messages.slice(0, -2);
  }
  return messages;
}

function userFacingChatError(err: unknown, fallback: string): string {
  if (err instanceof HermesHttpError) {
    console.debug('Hermes chat request failed', err);
    if (err.status === 401 || err.status === 403) return 'Your dashboard session expired. Sign in again.';
    if (err.status === 408 || /timeout|timed out/i.test(err.message)) return 'Hermes took too long to respond. Try again.';
    if (err.status === 429) return 'Hermes is busy or rate-limited. Try again in a moment.';
    if (err.status >= 500) return 'Hermes server returned an error. Check the server logs, then try again.';
    return fallback;
  }

  if (err instanceof JsonRpcError) {
    console.debug('Hermes JSON-RPC chat request failed', err);
    if (isSessionBusyError(err)) return 'Hermes is still working on the current response. Try again in a moment.';
    if (isSessionNotFoundError(err)) return 'The chat session is no longer available. Start a new session or pick another.';
    if (/unauthorized|forbidden|401|403/i.test(err.message)) return 'Your dashboard session expired. Sign in again.';
    if (/timeout|timed out/i.test(err.message)) return 'Hermes took too long to respond. Try again.';
    return fallback;
  }

  const message = err instanceof Error ? err.message : String(err ?? '');
  if (/failed to fetch|network|disconnected|websocket|offline/i.test(message)) {
    return 'Hermes is unreachable. Check the connection and try again.';
  }
  if (/timeout|timed out/i.test(message)) {
    return 'Hermes took too long to respond. Try again.';
  }
  return message.trim() ? message : fallback;
}

function isSessionBusyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as Record<string, unknown>;
  const rpcError = record.rpcError;
  if (rpcError && typeof rpcError === 'object') {
    const rpcRecord = rpcError as Record<string, unknown>;
    if (rpcRecord.code === 4009) return true;
    if (typeof rpcRecord.message === 'string' && /session busy|waiting for model response/i.test(rpcRecord.message)) {
      return true;
    }
  }
  if (err instanceof Error) {
    return /4009|session busy|waiting for model response/i.test(err.message);
  }
  return false;
}

function isSlashCommandInput(text: string): boolean {
  return /^\/\S/u.test(text.trim());
}

function parseSlashCommand(text: string): { name: string; arg: string; command: string } {
  const command = text.trim();
  const match = command.match(/^\/+([^\s]+)(?:\s+([\s\S]*))?$/u);
  if (!match) return { name: '', arg: '', command };
  return {
    name: match[1]?.toLowerCase() ?? '',
    arg: match[2]?.trim() ?? '',
    command,
  };
}

function slashCommandBase(command: string): string {
  const trimmed = command.trim();
  const base = (trimmed.startsWith('/') ? trimmed : `/${trimmed}`).split(/\s+/, 1)[0]?.toLowerCase() ?? '';
  return base;
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, '').trim();
}

function pwaSlashUnavailableMessage(command: string): string | null {
  const base = slashCommandBase(command);
  if (PWA_UNSUPPORTED_SLASH_COMMANDS.has(base)) {
    return `${base} is not available in PWA chat. PWA is already authenticated through the dashboard session.`;
  }
  return null;
}

function isPwaSlashSuggestion(command: string): boolean {
  return !PWA_UNSUPPORTED_SLASH_COMMANDS.has(slashCommandBase(command));
}

function slashStatusText(command: string, output: string | undefined): string {
  const body = stripAnsi(output ?? '') || '(no output)';
  return `**${command}**\n\n${body}`;
}

function renderPwaCommandsCatalog(raw: unknown): string {
  const catalog = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const lines: string[] = ['## Available commands'];
  const seen = new Set<string>();

  const formatPair = (commandValue: unknown, descriptionValue: unknown): string | null => {
    const command = typeof commandValue === 'string' ? commandValue : '';
    const base = slashCommandBase(command);
    if (!command || !isPwaSlashSuggestion(command) || seen.has(base)) return null;
    seen.add(base);
    const description = typeof descriptionValue === 'string' ? stripAnsi(descriptionValue) : '';
    return `- \`${command}\`${description ? ` — ${description}` : ''}`;
  };

  if (Array.isArray(catalog.categories)) {
    for (const category of catalog.categories) {
      if (!category || typeof category !== 'object') continue;
      const record = category as Record<string, unknown>;
      const pairs = Array.isArray(record.pairs) ? record.pairs : [];
      const entries = pairs.flatMap((pair) => {
        if (!Array.isArray(pair)) return [];
        const entry = formatPair(pair[0], pair[1]);
        return entry ? [entry] : [];
      });
      if (entries.length === 0) continue;
      const title = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : 'Commands';
      lines.push('', `### ${title}`, ...entries);
    }
  }

  if (Array.isArray(catalog.pairs)) {
    const entries = catalog.pairs.flatMap((pair) => {
      if (!Array.isArray(pair)) return [];
      const entry = formatPair(pair[0], pair[1]);
      return entry ? [entry] : [];
    });
    if (entries.length > 0) lines.push('', '### Skills & quick commands', ...entries);
  }

  return lines.join('\n').trim();
}

function parseCommandDispatch(raw: unknown): CommandDispatchResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const type = record.type;
  if (type === 'exec') {
    return { type, output: typeof record.output === 'string' ? record.output : undefined };
  }
  if (type === 'plugin') {
    return { type, output: typeof record.output === 'string' ? record.output : undefined };
  }
  if (type === 'alias' && typeof record.target === 'string') {
    return { type, target: record.target };
  }
  if (type === 'skill') {
    return {
      type,
      name: typeof record.name === 'string' ? record.name : 'skill',
      message: typeof record.message === 'string' ? record.message : undefined,
    };
  }
  if (type === 'send' && typeof record.message === 'string') {
    return {
      type,
      message: record.message,
      notice: typeof record.notice === 'string' ? record.notice : undefined,
    };
  }
  return null;
}

type ChatStateAnchor = Pick<ChatStore, 'sessionId' | 'storedSessionId' | 'messages' | 'streaming'>;

function isSameChatState(state: ChatStore, anchor: ChatStateAnchor): boolean {
  return (
    state.sessionId === anchor.sessionId &&
    state.storedSessionId === anchor.storedSessionId &&
    state.messages === anchor.messages &&
    state.streaming === anchor.streaming
  );
}

function emptyActiveSessionCache(profile?: string): ActiveSessionCache {
  return { sessionId: undefined, storedSessionId: undefined, messages: [], streaming: false, profile };
}

function normalizeCacheProfile(profile: string | undefined): string | undefined {
  const trimmed = profile?.trim();
  return trimmed || undefined;
}

function resolveCacheProfile(profile: string | undefined, fallback?: string | undefined): string | undefined {
  return normalizeCacheProfile(profile) ?? normalizeCacheProfile(fallback);
}

function inFlightScopeKey(profile: string | undefined, sessionId: string | undefined, storedSessionId: string | undefined): string {
  return `${normalizeCacheProfile(profile) ?? 'default'}:${sessionId ?? storedSessionId ?? 'new'}`;
}

function activeSessionStorageKey(profile: string): string {
  return `${PROFILED_ACTIVE_SESSION_STORAGE_KEY_PREFIX}:${encodeURIComponent(profile)}`;
}

function parseActiveSessionCache(raw: string, requestedProfile?: string): ActiveSessionCache {
  const parsed = JSON.parse(raw) as Partial<ActiveSessionCache>;
  const parsedProfile = normalizeCacheProfile(parsed.profile);
  const profile = normalizeCacheProfile(requestedProfile) ?? parsedProfile;
  if (requestedProfile && parsedProfile && parsedProfile !== requestedProfile) {
    return emptyActiveSessionCache(requestedProfile);
  }
  return {
    sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
    storedSessionId: typeof parsed.storedSessionId === 'string' ? parsed.storedSessionId : undefined,
    messages: Array.isArray(parsed.messages) ? messagesFromResult(parsed.messages) : [],
    // A page load can never be inside a live turn: there is no in-flight
    // prompt.submit and no event stream yet. Resurrecting a persisted
    // `streaming: true` would leave the store stuck busy forever — the
    // backend turn that clears it (message.complete / session.info) is gone
    // after a dashboard or gateway restart — which locks the Composer into
    // busy/queue mode and silently swallows every message ("dead chat").
    // Streaming is re-asserted by beginAssistant() when live message events
    // resume, so starting from `false` is both safe and self-healing.
    streaming: false,
    profile,
  };
}

function readFirstProfiledActiveSessionCache(): ActiveSessionCache | undefined {
  if (typeof window === 'undefined') return undefined;
  const preferredDefault = window.localStorage.getItem(activeSessionStorageKey('default'));
  if (preferredDefault) {
    const parsed = parseActiveSessionCache(preferredDefault, 'default');
    if (parsed.sessionId || parsed.storedSessionId || parsed.messages.length > 0) return parsed;
  }
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key?.startsWith(`${PROFILED_ACTIVE_SESSION_STORAGE_KEY_PREFIX}:`)) continue;
    const profile = decodeURIComponent(key.slice(`${PROFILED_ACTIVE_SESSION_STORAGE_KEY_PREFIX}:`.length));
    if (profile === 'default') continue;
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    const parsed = parseActiveSessionCache(raw, profile);
    if (parsed.sessionId || parsed.storedSessionId || parsed.messages.length > 0) return parsed;
  }
  return undefined;
}

function readActiveSessionCache(profile?: string): ActiveSessionCache {
  const normalizedProfile = normalizeCacheProfile(profile);
  if (typeof window === 'undefined') {
    return emptyActiveSessionCache(normalizedProfile);
  }
  try {
    for (const key of LEGACY_ACTIVE_SESSION_STORAGE_KEYS) {
      window.localStorage.removeItem(key);
    }
    if (normalizedProfile) {
      window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
      const profiledRaw = window.localStorage.getItem(activeSessionStorageKey(normalizedProfile));
      if (!profiledRaw) return emptyActiveSessionCache(normalizedProfile);
      return parseActiveSessionCache(profiledRaw, normalizedProfile);
    }
    const raw = window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
    if (raw) return parseActiveSessionCache(raw);
    return readFirstProfiledActiveSessionCache() ?? emptyActiveSessionCache();
  } catch {
    return emptyActiveSessionCache(normalizedProfile);
  }
}

function persistActiveSessionNow(state: ActiveSessionPersistState): void {
  if (typeof window === 'undefined') return;
  try {
    for (const key of LEGACY_ACTIVE_SESSION_STORAGE_KEYS) {
      window.localStorage.removeItem(key);
    }
    const profile = normalizeCacheProfile(state.cacheProfile);
    const hasData = Boolean(state.sessionId || state.storedSessionId || state.messages.length > 0);
    if (profile) {
      const key = activeSessionStorageKey(profile);
      window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
      if (!hasData) {
        window.localStorage.removeItem(key);
        return;
      }
      const payload: ActiveSessionCache = {
        sessionId: state.sessionId,
        storedSessionId: state.storedSessionId,
        messages: state.messages,
        streaming: state.streaming,
        profile,
      };
      window.localStorage.setItem(key, JSON.stringify(payload));
      return;
    }
    if (!hasData) {
      window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
      return;
    }
    const payload: ActiveSessionCache = {
      sessionId: state.sessionId,
      storedSessionId: state.storedSessionId,
      messages: state.messages,
      streaming: state.streaming,
      profile: undefined,
    };
    window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Best-effort cache only. Hermes state.db remains the source of truth.
  }
}

function clearPendingActiveSessionPersist(): void {
  pendingActiveSessionPersist = undefined;
  if (activeSessionPersistTimer) {
    clearTimeout(activeSessionPersistTimer);
    activeSessionPersistTimer = undefined;
  }
}

function flushPendingActiveSessionPersist(): void {
  const pending = pendingActiveSessionPersist;
  clearPendingActiveSessionPersist();
  if (pending) persistActiveSessionNow(pending);
}

function ensureVisibilityFlushListener(): void {
  if (visibilityFlushListenerInstalled || typeof document === 'undefined') return;
  visibilityFlushListenerInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingActiveSessionPersist();
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushPendingActiveSessionPersist);
  }
}

function persistActiveSession(state: ActiveSessionPersistState): void {
  clearPendingActiveSessionPersist();
  persistActiveSessionNow(state);
}

function persistActiveSessionThrottled(state: ActiveSessionPersistState): void {
  if (!state.streaming || typeof window === 'undefined') {
    persistActiveSession(state);
    return;
  }
  pendingActiveSessionPersist = state;
  ensureVisibilityFlushListener();
  if (!activeSessionPersistTimer) {
    activeSessionPersistTimer = setTimeout(flushPendingActiveSessionPersist, ACTIVE_SESSION_PERSIST_THROTTLE_MS);
  }
}

async function resumeDurableSession(rpc: RpcClient, durableSessionId: string, profile?: string) {
  const params: Record<string, unknown> = { session_id: durableSessionId };
  if (profile) params.profile = profile;
  const raw = await rpc.request('session.resume', params, { timeoutMs: LONG_RPC_TIMEOUT_MS });
  const sessionId = liveSessionIdFromResult(raw);
  const storedSessionId = durableSessionIdFromResult(raw, durableSessionId);
  const messages = messagesFromResult(raw);
  if (
    typeof rpc.onFrame === 'function' &&
    raw &&
    typeof raw === 'object' &&
    Array.isArray((raw as Record<string, unknown>).open_requests)
  ) {
    for (const entry of (raw as Record<string, unknown>).open_requests as unknown[]) {
      if (entry && typeof entry === 'object') {
        const rec = entry as Record<string, unknown>;
        if (
          (typeof rec.id === 'string' || typeof rec.id === 'number') &&
          (rec.method === 'approval' ||
            rec.method === 'approval.request' ||
            rec.method === 'clarify' ||
            rec.method === 'clarify.request')
        ) {
          const entryParams =
            rec.params && typeof rec.params === 'object' && !Array.isArray(rec.params)
              ? (rec.params as Record<string, unknown>)
              : {};
          rpc.onFrame(
            JSON.stringify({
              jsonrpc: '2.0',
              id: rec.id,
              method: rec.method,
              params: { ...entryParams, session_id: sessionId || storedSessionId },
            }),
          );
        }
      }
    }
  }
  return { sessionId, storedSessionId, messages, streaming: false, error: undefined };
}

async function createLiveSession(rpc: RpcClient, profile?: string, durableFallback?: string) {
  const createParams: Record<string, unknown> = {};
  if (profile) createParams.profile = profile;
  const created = await rpc.request('session.create', createParams);
  // The server defers this session's state.db row to its first turn, so a
  // missing list entry or 404 is not proof it ended — remember we minted it.
  // Only an id from THIS create response counts; the durableFallback may be an
  // old, genuinely ended session. A stale marker is harmless: consumers compare
  // it against the chat's current storedSessionId.
  const createdStoredId = durableSessionIdFromResult(created, undefined);
  if (createdStoredId) {
    useChatStore.setState({ locallyCreatedStoredId: createdStoredId });
  }
  return {
    sessionId: liveSessionIdFromResult(created),
    storedSessionId: durableSessionIdFromResult(created, durableFallback),
  };
}

async function replaceMissingLiveSession(
  rpc: RpcClient,
  durableSessionId: string | undefined,
  profile?: string,
) {
  if (durableSessionId) {
    try {
      const resumed = await resumeDurableSession(rpc, durableSessionId, profile);
      return {
        sessionId: resumed.sessionId,
        storedSessionId: resumed.storedSessionId,
      };
    } catch {
      // Durable row may have been deleted or profile lookup may fail; fall back to a fresh live session.
    }
  }
  return createLiveSession(rpc, profile, durableSessionId);
}

function resolveOpenableStoredSessionId(sessionId: string): string {
  const match = findSessionByAlias(useSessionsStore.getState().sessions, sessionId);
  return match?.id ?? sessionId;
}

function sameKnownLineage(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const sessions = useSessionsStore.getState().sessions;
  const aMatch = findSessionByAlias(sessions, a);
  const bMatch = findSessionByAlias(sessions, b);
  if (!aMatch || !bMatch) return false;
  return sessionLineageKey(aMatch) === sessionLineageKey(bMatch);
}

function preserveLineageTail(opened: Awaited<ReturnType<typeof openDurableSession>>, before: ChatStateAnchor) {
  if (!sameKnownLineage(before.storedSessionId, opened.storedSessionId)) return opened;
  const merged = mergeHistoryWithLocal(opened.messages, before.messages);
  const meaningfulTail = dropPendingOptimisticTail(merged.preservedLocalTail);
  return { ...opened, messages: [...opened.messages, ...meaningfulTail] };
}

async function openDurableSession(rest: RestClient, rpc: RpcClient, durableSessionId: string, profile?: string) {
  const openableSessionId = resolveOpenableStoredSessionId(durableSessionId);
  let snapshotMessages: Message[] | undefined;
  let snapshotError: unknown;
  try {
    snapshotMessages = messagesFromResult(await rest.sessionMessages(openableSessionId, profile));
  } catch (err) {
    snapshotError = err;
  }

  try {
    const resumed = await resumeDurableSession(rpc, openableSessionId, profile);
    return {
      sessionId: resumed.sessionId,
      storedSessionId: resumed.storedSessionId ?? openableSessionId,
      messages: snapshotMessages && snapshotMessages.length > 0 ? snapshotMessages : resumed.messages,
      streaming: false,
      error: undefined,
    };
  } catch (resumeError) {
    if (snapshotMessages) {
      return {
        sessionId: undefined,
        storedSessionId: openableSessionId,
        messages: snapshotMessages,
        streaming: false,
        error: userFacingChatError(resumeError, 'Failed to resume session runtime.'),
      };
    }
    throw snapshotError ?? resumeError;
  }
}

async function refreshDurableHistory(rest: RestClient, durableSessionId: string, localMessages: Message[], profile?: string, mergeLocalsOnAlias = false) {
  const openableSessionId = resolveOpenableStoredSessionId(durableSessionId);
  const raw = await rest.sessionMessages(openableSessionId, profile);
  const storedSessionId = storedSessionIdFromMessagesResult(raw, openableSessionId);
  // A successful fetch proves the server row exists — the locally-created
  // exemption is no longer needed for this id.
  if (useChatStore.getState().locallyCreatedStoredId === openableSessionId) {
    useChatStore.setState({ locallyCreatedStoredId: undefined });
  }
  const history = messagesFromResult(raw);
  // Merge locals when the id resolves to itself, or when the caller passed a
  // runtime-only id (mergeLocalsOnAlias): the alias is then that session's own
  // durable row, so merging is safe and keeps a just-sent echo. With a durable
  // parent id the alias may be a different lineage row (compression child),
  // where appending unmatched locals would duplicate stale messages — keep the
  // server history only.
  const merged = openableSessionId === durableSessionId || mergeLocalsOnAlias
    ? mergeHistoryWithLocal(history, localMessages)
    : { messages: history, preservedLocalTail: [] };
  return { storedSessionId, messages: merged.messages };
}

const initialCache = readActiveSessionCache();

export const useChatStore = create<ChatStore>((set, get) => ({
  sessionId: initialCache.sessionId,
  storedSessionId: initialCache.storedSessionId,
  messages: initialCache.messages,
  streaming: initialCache.streaming,
  error: undefined,
  cacheProfile: initialCache.profile,
  lastSubmittedSessionId: undefined, // transient, never persisted
  locallyCreatedStoredId: undefined, // transient, never persisted

  setSessionId(id, storedSessionId) {
    const next = { sessionId: id, storedSessionId, lastSubmittedSessionId: undefined, messages: [] as Message[], error: undefined };
    set(next);
    persistActiveSession({ ...get(), ...next });
  },

  async loadHistory(rest, sessionId) {
    const before = get();
    set({ streaming: false, lastSubmittedSessionId: undefined, error: undefined });
    const anchor = get();
    try {
      const raw = await rest.sessionMessages(sessionId);
      if (!isSameChatState(get(), anchor)) return;
      const history = messagesFromResult(raw);
      const sameActiveSession = before.sessionId === sessionId || before.storedSessionId === sessionId;
      const merged = sameActiveSession
        ? mergeHistoryWithLocal(history, before.messages)
        : { messages: history, preservedLocalTail: [] };
      const keepStreaming =
        sameActiveSession && before.streaming && merged.preservedLocalTail.some((m) => m.role === 'assistant');
      const next = { messages: merged.messages, streaming: keepStreaming, sessionId };
      // ponytail: keep lastSubmittedSessionId while this same session still streams (mid-turn reload);
      // clear it on foreign-session history loads.
      set({ ...next, lastSubmittedSessionId: sameActiveSession ? before.lastSubmittedSessionId : undefined });
      persistActiveSession({ ...get(), ...next });
    } catch (err) {
      if (isSameChatState(get(), anchor)) {
        set({ streaming: false, error: userFacingChatError(err, 'Failed to load history.') });
      }
      throw err;
    }
  },

  async refreshHistory(rest, profile) {
    const cacheProfile = resolveCacheProfile(profile, get().cacheProfile);
    if (cacheProfile !== get().cacheProfile) set({ cacheProfile });
    const before = get();
    // If the WebSocket died while the app was backgrounded, `streaming` can be
    // stuck true with no live deltas arriving. Don't skip the REST refresh in
    // that case — the backend snapshot is the only way to recover the assistant
    // response. The refresh itself sets streaming: false.
    if (before.streaming && typeof document !== 'undefined' && document.visibilityState === 'visible') {
      // App is visible again; force a refresh to pick up missed responses.
    } else if (before.streaming) {
      return;
    }
    const durableSessionId = before.storedSessionId ?? before.sessionId;
    if (!durableSessionId) return;
    const anchor = get();
    try {
      // !before.storedSessionId means durableSessionId is a runtime-only id, so an
      // alias can only resolve to this session's own durable row — safe to merge.
      const refreshed = await refreshDurableHistory(rest, durableSessionId, before.messages, cacheProfile, !before.storedSessionId);
      if (!isSameChatState(get(), anchor)) return;
      const next = {
        storedSessionId: refreshed.storedSessionId,
        messages: refreshed.messages,
        streaming: false,
        error: undefined,
      };
      set(next);
      persistActiveSession({ ...get(), ...next });
    } catch {
      // Best-effort background reconciliation. The cached transcript remains a
      // valid offline fallback if the REST snapshot is temporarily unavailable.
    }
  },

  async restore(rest, rpc, profile) {
    const cacheProfile = normalizeCacheProfile(profile);
    const cached = readActiveSessionCache(cacheProfile);
    if (cached.messages.length > 0 || cached.sessionId || cached.storedSessionId) {
      set({
        sessionId: cached.sessionId,
        storedSessionId: cached.storedSessionId,
        messages: cached.messages,
        // A cached streaming flag is always stale: no live turn survives a reload,
        // and a dead turn would otherwise stick the composer in interrupt mode.
        // A genuinely running turn re-marks streaming via WS events.
        streaming: false,
        lastSubmittedSessionId: undefined,
        error: undefined,
        cacheProfile: cached.profile ?? cacheProfile,
      });
    } else {
      set({ cacheProfile });
    }

    const state = get();
    if (state.streaming && state.sessionId) {
      // Chat can mount while an in-memory turn is already active (route changes,
      // tests, or app-shell remounts). Do not replace the live transcript with a
      // REST snapshot/rebind while tool approvals or deltas are pending.
      return;
    }
    const liveSessionId = state.sessionId ?? cached.sessionId;
    const durableSessionId = state.storedSessionId ?? cached.storedSessionId;
    const openableDurableSessionId = durableSessionId ? resolveOpenableStoredSessionId(durableSessionId) : undefined;
    const durableAliasChanged = Boolean(durableSessionId && openableDurableSessionId && openableDurableSessionId !== durableSessionId);

    if (
      durableSessionId &&
      liveSessionId &&
      state.messages.length > 0 &&
      !durableAliasChanged
    ) {
      const usageAnchor = get();
      try {
        await rpc.request('session.usage', { session_id: liveSessionId });
        if (!isSameChatState(get(), usageAnchor)) return;
        let refreshed: Awaited<ReturnType<typeof refreshDurableHistory>> | undefined;
        try {
          refreshed = await refreshDurableHistory(rest, durableSessionId, state.messages, cacheProfile);
        } catch {
          // Keep the validated live runtime and cached transcript; restore should
          // not fail just because a passive REST refresh is temporarily stale.
        }
        if (!isSameChatState(get(), usageAnchor)) return;
        const next = {
          streaming: false,
          error: undefined,
          ...(refreshed ? { storedSessionId: refreshed.storedSessionId, messages: refreshed.messages } : {}),
        };
        set(next);
        persistActiveSession({ ...get(), ...next });
        return;
      } catch {
        // Cached runtime id belongs to a dead/restarted gateway. Fall through to
        // a full durable resume to mint a fresh live runtime id.
      }
    }

    if (durableSessionId) {
      const beforeOpen = get();
      set({ streaming: false, error: undefined });
      const openAnchor = get();
      try {
        const opened = await openDurableSession(rest, rpc, durableSessionId, cacheProfile);
        if (!isSameChatState(get(), openAnchor)) return;
        const nextOpened = preserveLineageTail(opened, beforeOpen);
        set(nextOpened);
        persistActiveSession({ ...get(), ...nextOpened });
        return;
      } catch (err) {
        if (isSameChatState(get(), openAnchor)) {
          set({
            sessionId: undefined,
            storedSessionId: durableSessionId,
            streaming: false,
            error: userFacingChatError(err, 'Failed to restore session.'),
            messages: beforeOpen.messages,
          });
          persistActiveSession(get());
        }
        return;
      }
    }

    if (liveSessionId) {
      // Runtime-only IDs are gateway-local. Without a durable storedSessionId we
      // cannot reliably read state.db history or rebind after reload. Preserve
      // the current in-memory/cache view and avoid guessing session.most_recent.
      return;
    }

    // Do not blindly auto-resume session.most_recent here.
    // PWA chat is often opened from a mobile/home surface where the most recent
    // human-facing Hermes session may be an external/coding/debug branch with a
    // huge tool transcript. Silently attaching the composer to that branch makes
    // a normal prompt look like a dead chat: the backend spends minutes in
    // compression/tool work and the UI only shows the thinking dots. Explicit
    // session selection still goes through resumeSessionIntoChat(); an empty
    // chat submit creates a fresh live session.
  },

  async resumeSessionIntoChat(rest, rpc, storedSessionId, profile) {
    const cacheProfile = resolveCacheProfile(profile, get().cacheProfile);
    const beforeOpen = get();
    set({ streaming: false, lastSubmittedSessionId: undefined, error: undefined, cacheProfile });
    const anchor = get();
    try {
      const opened = await openDurableSession(rest, rpc, storedSessionId, cacheProfile);
      if (!isSameChatState(get(), anchor)) return;
      const nextOpened = preserveLineageTail(opened, beforeOpen);
      set({ ...nextOpened, lastSubmittedSessionId: undefined });
      persistActiveSession({ ...get(), ...nextOpened });
    } catch (err) {
      if (isSameChatState(get(), anchor)) {
        set({
          sessionId: undefined,
          storedSessionId,
          streaming: false,
          lastSubmittedSessionId: undefined,
          error: userFacingChatError(err, 'Failed to open session.'),
        });
        persistActiveSession(get());
      }
      throw err;
    }
  },

  startNewSession(profile) {
    get().clear(profile);
  },

  async ensureLiveSession(rpc, profile) {
    const cacheProfile = resolveCacheProfile(profile, get().cacheProfile);
    if (cacheProfile !== get().cacheProfile) set({ cacheProfile });
    let { sessionId, storedSessionId } = get();

    if (sessionId) {
      try {
        await rpc.request('session.usage', { session_id: sessionId });
        return { sessionId, storedSessionId };
      } catch (err) {
        if (!isSessionNotFoundError(err)) throw err;
      }
    }

    const replacement = await replaceMissingLiveSession(rpc, storedSessionId, cacheProfile);
    sessionId = replacement.sessionId;
    storedSessionId = replacement.storedSessionId;
    const nextSession = { sessionId, storedSessionId, error: undefined };
    set(nextSession);
    persistActiveSession({ ...get(), ...nextSession });
    return { sessionId, storedSessionId };
  },

  async executeSlashCommand(rpc, text, profile) {
    const cacheProfile = resolveCacheProfile(profile, get().cacheProfile);
    if (cacheProfile !== get().cacheProfile) set({ cacheProfile });
    const parsed = parseSlashCommand(text);
    if (!parsed.name) {
      const message: Message = {
        id: nextSystemMessageId(),
        role: 'system',
        text: 'Empty slash command.',
        createdAt: undefined,
      };
      const next = { messages: [...get().messages, message], streaming: false, error: undefined };
      set(next);
      persistActiveSession({ ...get(), ...next });
      return 'submitted';
    }

    const renderSlashOutput = (command: string, output: string | undefined) => {
      const message: Message = {
        id: nextSystemMessageId(),
        role: 'system',
        text: slashStatusText(command, output),
        createdAt: undefined,
      };
      const next = { messages: [...get().messages, message], streaming: false, error: undefined };
      set(next);
      persistActiveSession({ ...get(), ...next });
    };

    if (parsed.name === 'new' || parsed.name === 'reset' || parsed.name === 'clear') {
      get().clear(cacheProfile);
      return 'submitted';
    }

    const unavailable = pwaSlashUnavailableMessage(parsed.command);
    if (unavailable) {
      renderSlashOutput(parsed.command, unavailable);
      return 'failed';
    }

    if (parsed.name === 'help' || parsed.name === 'commands') {
      try {
        const catalog = await rpc.request<unknown>('commands.catalog', {});
        renderSlashOutput(parsed.command, renderPwaCommandsCatalog(catalog));
        return 'submitted';
      } catch (err) {
        const detail = userFacingChatError(err, 'Could not load command catalog.');
        renderSlashOutput(parsed.command, `error: ${detail}`);
        return 'failed';
      }
    }

    try {
      let { sessionId, storedSessionId } = get();
      if (!sessionId) {
        const replacement = await replaceMissingLiveSession(rpc, storedSessionId, cacheProfile);
        sessionId = replacement.sessionId;
        storedSessionId = replacement.storedSessionId;
        const nextSession = { sessionId, storedSessionId, streaming: false, error: undefined };
        set(nextSession);
        persistActiveSession({ ...get(), ...nextSession });
      }

      try {
        const result = await rpc.request<SlashExecResponse>(
          'slash.exec',
          {
            session_id: sessionId,
            command: parsed.command.replace(/^\/+/, ''),
          },
          { timeoutMs: LONG_RPC_TIMEOUT_MS },
        );
        const output = result?.warning ? `warning: ${result.warning}\n${result.output ?? ''}` : result?.output;
        renderSlashOutput(parsed.command, output);
        return 'submitted';
      } catch {
        // slash.exec deliberately rejects skill/send/alias and some mutating commands.
        // Fall back to the Desktop-compatible dispatcher for those structured cases.
      }

      const dispatch = parseCommandDispatch(
        await rpc.request<unknown>(
          'command.dispatch',
          { session_id: sessionId, name: parsed.name, arg: parsed.arg },
          { timeoutMs: LONG_RPC_TIMEOUT_MS },
        ),
      );

      if (!dispatch) {
        renderSlashOutput(parsed.command, 'error: invalid response: command.dispatch');
        return 'failed';
      }

      if (dispatch.type === 'exec' || dispatch.type === 'plugin') {
        renderSlashOutput(parsed.command, dispatch.output ?? '(no output)');
        return 'submitted';
      }

      if (dispatch.type === 'alias') {
        const target = dispatch.target.trim();
        if (!target) {
          renderSlashOutput(parsed.command, 'error: alias target is empty');
          return 'failed';
        }
        const sourceBase = slashCommandBase(parsed.command);
        const targetCommand = `${target.startsWith('/') ? target : `/${target}`}${parsed.arg ? ` ${parsed.arg}` : ''}`;
        const targetBase = slashCommandBase(targetCommand);
        if (
          aliasDispatchStack.length >= MAX_ALIAS_DISPATCH_DEPTH ||
          targetBase === sourceBase ||
          aliasDispatchStack.includes(targetBase)
        ) {
          renderSlashOutput(parsed.command, 'error: alias dispatch cycle detected');
          return 'failed';
        }
        aliasDispatchStack.push(sourceBase);
        try {
          return await get().executeSlashCommand(rpc, targetCommand, cacheProfile);
        } finally {
          aliasDispatchStack.pop();
        }
      }

      if (dispatch.type === 'skill') {
        renderSlashOutput(parsed.command, `⚡ loading skill: ${dispatch.name}`);
        const message = dispatch.message?.trim() ?? '';
        if (!message) {
          renderSlashOutput(parsed.command, `/${parsed.name}: skill payload missing message`);
          return 'failed';
        }
        return get().submit(rpc, message, cacheProfile);
      }

      if (dispatch.type === 'send') {
        if (dispatch.notice) {
          renderSlashOutput(parsed.command, dispatch.notice);
        }
        const message = dispatch.message.trim();
        if (!message) {
          renderSlashOutput(parsed.command, `/${parsed.name}: empty message`);
          return 'failed';
        }
        return get().submit(rpc, message, cacheProfile);
      }

      renderSlashOutput(parsed.command, 'error: unsupported command.dispatch response');
      return 'failed';
    } catch (err) {
      const detail = userFacingChatError(err, 'Slash command failed.');
      set({ streaming: false, error: detail });
      persistActiveSession(get());
      renderSlashOutput(parsed.command, `error: ${detail}`);
      return 'failed';
    }
  },

  async submit(rpc, text, profile) {
    const cacheProfile = resolveCacheProfile(profile, get().cacheProfile);
    if (cacheProfile !== get().cacheProfile) set({ cacheProfile });
    if (isSlashCommandInput(text)) {
      return get().executeSlashCommand(rpc, text, cacheProfile);
    }
    const initial = get();
    const submitKey = inFlightScopeKey(cacheProfile, initial.sessionId, initial.storedSessionId);
    if (submitInFlightKeys.has(submitKey)) return 'busy';
    submitInFlightKeys.add(submitKey);
    try {

      const { sessionId, storedSessionId, messages, streaming } = get();
      let id = sessionId;
      let durableId = storedSessionId;

      try {
        if (!id) {
          const replacement = await replaceMissingLiveSession(rpc, durableId, cacheProfile);
          id = replacement.sessionId;
          durableId = replacement.storedSessionId;
        }

        const nextMessages = [
          ...messages,
          { id: nextUserMessageId(), role: 'user' as const, text, createdAt: undefined },
          { id: nextAssistantMessageId(), role: 'assistant' as const, text: '', createdAt: undefined },
        ];

        const optimistic = {
          lastSubmittedSessionId: id,
          sessionId: id,
          storedSessionId: durableId,
          streaming: true,
          error: undefined,
          messages: nextMessages,
        };
        set(optimistic);
        persistActiveSession({ ...get(), ...optimistic });

        try {
          await rpc.request('prompt.submit', { session_id: id, text }, { timeoutMs: PROMPT_SUBMIT_TIMEOUT_MS });
        } catch (submitErr) {
          if (isSessionBusyError(submitErr)) {
            const rollback = {
              sessionId: id,
              storedSessionId: durableId,
              streaming: true,
              error: undefined,
              messages,
            };
            set(rollback);
            persistActiveSession({ ...get(), ...rollback });
            return 'busy';
          }
          if (!isSessionNotFoundError(submitErr)) {
            throw submitErr;
          }
          const replacement = await replaceMissingLiveSession(rpc, durableId, cacheProfile);
          id = replacement.sessionId;
          durableId = replacement.storedSessionId;
          const recovered = {
            lastSubmittedSessionId: id,
            sessionId: id,
            storedSessionId: durableId,
            streaming: true,
            error: undefined,
            messages: nextMessages,
          };
          set(recovered);
          persistActiveSession({ ...get(), ...recovered });
          try {
            await rpc.request('prompt.submit', { session_id: id, text }, { timeoutMs: PROMPT_SUBMIT_TIMEOUT_MS });
          } catch (retryErr) {
            if (isSessionBusyError(retryErr)) {
              const rollback = {
                sessionId: id,
                storedSessionId: durableId,
                streaming: true,
                error: undefined,
                messages,
              };
              set(rollback);
              persistActiveSession({ ...get(), ...rollback });
              return 'busy';
            }
            throw retryErr;
          }
        }
        return 'submitted';
      } catch (err) {
        set({ streaming, error: userFacingChatError(err, 'Submit failed.') });
        persistActiveSession(get());
        return 'failed';
      }
    } finally {
      submitInFlightKeys.delete(submitKey);
    }
  },
  async steer(rpc, text) {
    const { sessionId } = get();
    if (!sessionId) {
      set({ error: 'No active session to steer.' });
      return false;
    }
    try {
      const raw = await rpc.request('session.steer', { session_id: sessionId, text });
      const status = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).status : undefined;
      const accepted = status === undefined || status === 'queued';
      if (accepted) {
        set((state) => {
          // Echo the steered message locally; no WS event carries user messages,
          // so without this the text only appears after a history refresh.
          if (state.sessionId !== sessionId) return { error: undefined }; // session switched mid-RPC; don't echo into the wrong chat
          const echo = { id: nextUserMessageId(), role: 'user' as const, text, createdAt: undefined };
          const messages = [...state.messages];
          const last = messages[messages.length - 1];
          // While streaming, keep the live assistant message last so appendDelta keeps growing it.
          if (state.streaming && last?.role === 'assistant') messages.splice(messages.length - 1, 0, echo);
          else messages.push(echo);
          const next = { error: undefined, messages };
          persistActiveSession({ ...state, ...next });
          return next;
        });
      } else {
        set({ error: 'Steer rejected — message queued for next turn.' });
      }
      return accepted;
    } catch (err) {
      set({ error: userFacingChatError(err, 'Steer failed.') });
      return false;
    }
  },

  async interrupt(rpc, options) {
    const { sessionId, storedSessionId, cacheProfile } = get();
    if (!sessionId) return;
    const interruptKey = inFlightScopeKey(cacheProfile, sessionId, storedSessionId);
    if (interruptInFlightKeys.has(interruptKey)) return;
    interruptInFlightKeys.add(interruptKey);
    try {
      await rpc.request('session.interrupt', { session_id: sessionId });
      set({ streaming: options?.keepStreaming === true, lastSubmittedSessionId: undefined, error: undefined });
      persistActiveSession(get());
    } catch (err) {
      set({ error: userFacingChatError(err, 'Interrupt failed.') });
    } finally {
      interruptInFlightKeys.delete(interruptKey);
    }
  },

  appendDelta(text) {
    set((state) => {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, text: last.text + text };
      }
      const next = { messages: msgs };
      persistActiveSessionThrottled({ ...state, ...next });
      return next;
    });
  },

  finishAssistant(finalText) {
    set((state) => {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        const text = typeof finalText === 'string' && finalText.trim() ? finalText.trim() : last.text;
        const nextLast = { ...last, text };
        if (isDuplicateReasoning(nextLast.thinking, text)) {
          delete nextLast.thinking;
        }
        msgs[msgs.length - 1] = nextLast;
      }
      const next = { streaming: false, lastSubmittedSessionId: undefined, messages: msgs };
      persistActiveSession({ ...state, ...next });
      return next;
    });
  },

  failAssistant(error) {
    set((state) => {
      const message = error || 'Hermes reported an error.';
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant' && !last.text.trim()) {
        msgs[msgs.length - 1] = { ...last, text: `Error: ${message}` };
      }
      const next = { streaming: false, lastSubmittedSessionId: undefined, error: message, messages: msgs };
      persistActiveSession({ ...state, ...next });
      return next;
    });
  },

  markIdle() {
    // ponytail: deliberately does NOT clear lastSubmittedSessionId — a spurious running=false
    // mid-turn (the original empty-response race) must not orphan still-incoming deltas; turn end
    // (finishAssistant/failAssistant) and session switches own the clearing.
    set((state) => {
      const next = { streaming: false };
      persistActiveSession({ ...state, ...next });
      return next;
    });
  },

  appendToolCall(tool) {
    set((state) => {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        const existing = (last.toolCalls ?? []).find((t) => t.id === tool.id);
        if (existing) return { messages: msgs };
        const tools = [...(last.toolCalls ?? []), tool];
        msgs[msgs.length - 1] = { ...last, toolCalls: tools };
      }
      const next = { messages: msgs };
      persistActiveSession({ ...state, ...next });
      return next;
    });
  },

  updateToolCall(id, patch) {
    set((state) => {
      const msgs = state.messages.map((m) => {
        if (m.role !== 'assistant' || !m.toolCalls) return m;
        const tools = m.toolCalls.map((t) => (t.id === id ? { ...t, ...patch } : t));
        return { ...m, toolCalls: tools };
      });
      const next = { messages: msgs };
      persistActiveSession({ ...state, ...next });
      return next;
    });
  },

  appendThinking(text, replace = false) {
    if (!text) return;
    set((state) => {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== 'assistant') return { messages: msgs };
      const nextThinking = replace ? text : (last.thinking ?? '') + text;
      if (isDuplicateReasoning(nextThinking, last.text)) {
        const nextLast = { ...last };
        delete nextLast.thinking;
        msgs[msgs.length - 1] = nextLast;
      } else {
        msgs[msgs.length - 1] = { ...last, thinking: nextThinking };
      }
      const next = { messages: msgs };
      persistActiveSessionThrottled({ ...state, ...next });
      return next;
    });
  },

  beginAssistant() {
    set((state) => {
      const last = state.messages[state.messages.length - 1];
      if (last?.role === 'assistant') {
        const next = { streaming: true, error: undefined };
        persistActiveSession({ ...state, ...next });
        return next;
      }
      const next = {
        streaming: true,
        error: undefined,
        messages: [
          ...state.messages,
          { id: nextAssistantMessageId(), role: 'assistant' as const, text: '', createdAt: undefined },
        ],
      };
      persistActiveSession({ ...state, ...next });
      return next;
    });
  },

  clear(profile) {
    const cacheProfile = resolveCacheProfile(profile, get().cacheProfile);
    const next = {
      sessionId: undefined,
      storedSessionId: undefined,
      messages: [] as Message[],
      streaming: false,
      lastSubmittedSessionId: undefined,
      locallyCreatedStoredId: undefined,
      error: undefined,
      cacheProfile,
    };
    set(next);
    persistActiveSession(next);
  },
}));
