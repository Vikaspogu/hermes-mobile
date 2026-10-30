/**
 * JSON-RPC 2.0 over WebSocket — newline-delimited.
 * Request/response correlation by id + event frame dispatch.
 * No DOM APIs (EventTarget/CustomEvent) — works in any JS runtime.
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string;
  result?: unknown;
  error?: unknown;
}

function formatRpcError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const code = record.code !== undefined ? `${String(record.code)} ` : '';
    const message = typeof record.message === 'string' ? record.message : JSON.stringify(record);
    return `${code}${message}`.trim();
  }
  return 'JSON-RPC request failed';
}

export class JsonRpcError extends Error {
  readonly rpcError: unknown;

  constructor(error: unknown) {
    super(formatRpcError(error));
    this.name = 'JsonRpcError';
    this.rpcError = error;
  }
}

export interface JsonRpcEvent {
  jsonrpc: '2.0';
  method: 'event';
  params: {
    type: string;
    session_id?: string;
    payload?: unknown;
  };
}

export type RpcSend = (message: string) => void;

export interface RpcEvent {
  type: string;
  sessionId?: string;
  payload?: unknown;
  rpcRequestId?: string | number;
}

export type RpcEventHandler = (event: RpcEvent) => void;

const KNOWN_GATEWAY_EVENT_TYPES = new Set([
  'gateway.ready',
  'session.info',
  'message.start',
  'message.delta',
  'message.complete',
  'tool.start',
  'tool.complete',
  'tool.generating',
  'tool.progress',
  'thinking.delta',
  'reasoning.delta',
  'reasoning.available',
  'approval.request',
  'approval.cancelled',
  'request.cancel',
  'clarify.request',
  'status.update',
  'notice',
  'notice.clear',
  'error',
  'skin.changed',
]);

function isKnownGatewayEventType(type: string): boolean {
  return KNOWN_GATEWAY_EVENT_TYPES.has(type);
}

export interface RpcEvents {
  addEventListener(type: string, handler: RpcEventHandler): void;
  removeEventListener(type: string, handler: RpcEventHandler): void;
  dispatchEvent(event: RpcEvent): void;
}

export interface RpcRequestOptions {
  /** Override the client's default response timeout for one long/short request. */
  timeoutMs?: number;
}

export interface RpcClient {
  request<T>(method: string, params?: unknown, options?: RpcRequestOptions): Promise<T>;
  respond?(id: string | number, result: unknown): void;
  onFrame(line: string): void;
  events: RpcEvents;
  disconnect(): void;
}

const SESSION_CAPABILITY_METHODS = new Set(['session.create', 'session.resume', 'session.activate']);
const SUPPORTED_SERVER_REQUEST_METHODS: ReadonlySet<string> = new Set<import('./jsonrpc-contract').ServerRequestMethod>([
  'approval.request',
  'clarify.request',
]);

export function makeRpcEvents(): RpcEvents {
  const listeners = new Map<string, Set<RpcEventHandler>>();

  return {
    addEventListener(type, handler) {
      const set = listeners.get(type) ?? new Set();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatchEvent(event) {
      listeners.get(event.type)?.forEach((h) => h(event));
    },
  };
}

export interface RpcClientOptions {
  timeoutMs?: number;
}

export function makeRpcClient(send: RpcSend, options: RpcClientOptions = {}): RpcClient {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pending = new Map<string, { resolve: (result: unknown) => void; reject: (err: Error) => void; timeoutId?: ReturnType<typeof setTimeout> }>();
  const events = makeRpcEvents();
  let counter = 0;

  function settle(id: string, action: (entry: { resolve: (result: unknown) => void; reject: (err: Error) => void }) => void): void {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    action(entry);
  }

  function request<T>(method: string, params?: unknown, requestOptions: RpcRequestOptions = {}): Promise<T> {
    const id = String(++counter);
    return new Promise<T>((resolve, reject) => {
      const requestTimeoutMs = requestOptions.timeoutMs ?? timeoutMs;
      const timeoutId =
        requestTimeoutMs > 0
          ? setTimeout(() => {
              settle(id, ({ reject: rejectPending }) => rejectPending(new Error('JSON-RPC request timed out')));
            }, requestTimeoutMs)
          : undefined;
      const pendingEntry: { resolve: (result: unknown) => void; reject: (err: Error) => void; timeoutId?: ReturnType<typeof setTimeout> } = {
        resolve: resolve as (result: unknown) => void,
        reject,
      };
      if (timeoutId) {
        pendingEntry.timeoutId = timeoutId;
      }
      pending.set(id, pendingEntry);
      const paramRecord =
        params && typeof params === 'object' && !Array.isArray(params)
          ? (params as Record<string, unknown>)
          : undefined;
      const existingCaps =
        paramRecord?.client_capabilities &&
        typeof paramRecord.client_capabilities === 'object' &&
        !Array.isArray(paramRecord.client_capabilities)
          ? (paramRecord.client_capabilities as Record<string, unknown>)
          : undefined;
      const wireParams = SESSION_CAPABILITY_METHODS.has(method)
        ? {
            ...(paramRecord ?? {}),
            client_capabilities: {
              server_requests: true,
              ...(existingCaps ?? {}),
            },
          }
        : params;
      const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params: wireParams };
      try {
        send(JSON.stringify(req) + '\n');
      } catch (error) {
        settle(id, ({ reject: rejectPending }) => rejectPending(error instanceof Error ? error : new Error(String(error))));
      }
    });
  }

  function respond(id: string | number, result: unknown): void {
    send(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  }

  function onFrame(line: string): void {
    if (!line.trim()) return;
    let frame: JsonRpcResponse | JsonRpcEvent;
    try {
      frame = JSON.parse(line) as JsonRpcResponse | JsonRpcEvent;
    } catch {
      return;
    }

    if (!('method' in frame) && 'id' in frame && frame.id !== undefined && pending.has(frame.id)) {
      settle(frame.id, ({ resolve, reject }) => {
        if ('error' in frame && frame.error !== undefined) {
          reject(new JsonRpcError(frame.error));
        } else {
          resolve(frame.result);
        }
      });
      return;
    }

    if ('method' in frame && frame.method === 'event' && 'params' in frame) {
      const evt = frame as JsonRpcEvent;
      const params = evt.params;
      if (!isKnownGatewayEventType(params.type)) {
        console.warn(`[Hermes PWA] Unknown gateway event type: ${params.type}`);
      }
      const event: RpcEvent = { type: params.type, payload: params.payload };
      if (typeof params.session_id === 'string') {
        event.sessionId = params.session_id;
      }
      events.dispatchEvent(event);
      return;
    }

    const rawFrame = frame as unknown as Record<string, unknown>;
    if (typeof rawFrame.method === 'string') {
      const rawParams =
        rawFrame.params && typeof rawFrame.params === 'object' && !Array.isArray(rawFrame.params)
          ? (rawFrame.params as Record<string, unknown>)
          : {};
      const hasRequestId =
        (typeof rawFrame.id === 'string' && rawFrame.id.length > 0) || typeof rawFrame.id === 'number';
      if (hasRequestId) {
        const requestId = rawFrame.id as string | number;
        if (!SUPPORTED_SERVER_REQUEST_METHODS.has(rawFrame.method)) {
          try {
            send(
              JSON.stringify({
                jsonrpc: '2.0',
                id: requestId,
                error: { code: -32601, message: `Unsupported server request: ${rawFrame.method}` },
              }) + '\n',
            );
          } catch {
            // Ignore send failures when socket is already closing
          }
          return;
        }
        const event: RpcEvent = {
          type: rawFrame.method,
          payload: rawParams,
          rpcRequestId: requestId,
        };
        if (typeof rawParams.session_id === 'string') {
          event.sessionId = rawParams.session_id;
        }
        events.dispatchEvent(event);
        return;
      }
      if (rawFrame.id === undefined && isKnownGatewayEventType(rawFrame.method)) {
        const payload =
          rawParams.payload && typeof rawParams.payload === 'object' && !Array.isArray(rawParams.payload)
            ? (rawParams.payload as Record<string, unknown>)
            : rawParams;
        const event: RpcEvent = {
          type: rawFrame.method,
          payload,
        };
        if (typeof rawParams.session_id === 'string') {
          event.sessionId = rawParams.session_id;
        }
        events.dispatchEvent(event);
      }
    }
  }

  function disconnect(): void {
    for (const [id] of pending) {
      settle(id, ({ reject }) => reject(new Error('Disconnected')));
    }
  }

  return { request, respond, onFrame, events, disconnect };
}
