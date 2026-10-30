import { afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRpcClient } from './jsonrpc';

interface RecordedGatewayFixture {
  source: string;
  frames: unknown[];
}

function loadRecordedGatewayFixture(name: string): RecordedGatewayFixture {
  const path = join(process.cwd(), 'packages/core/src/transport/fixtures', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as RecordedGatewayFixture;
}

describe('makeRpcClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends JSON-RPC request with newline terminator', () => {
    const send = vi.fn();
    const rpc = makeRpcClient(send);
    void rpc.request('session.create', { profile: 'default' });
    expect(send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(send.mock.calls[0][0].trim());
    expect(sent.jsonrpc).toBe('2.0');
    expect(sent.method).toBe('session.create');
    expect(sent.params).toEqual({ profile: 'default' });
    expect(sent.id).toBe('1');
  });

  it('correlates response by id', async () => {
    const send = vi.fn();
    const rpc = makeRpcClient(send);
    const promise = rpc.request<string>('session.list', {});
    rpc.onFrame(JSON.stringify({ jsonrpc: '2.0', id: '1', result: 'ok' }));
    const result = await promise;
    expect(result).toBe('ok');
  });

  it('ignores responses with unknown ids', () => {
    const send = vi.fn();
    const rpc = makeRpcClient(send);
    rpc.onFrame(JSON.stringify({ jsonrpc: '2.0', id: '99', result: 'ok' }));
    // Should not throw
  });

  it('dispatches event frames via RpcEvents', async () => {
    const send = vi.fn();
    const rpc = makeRpcClient(send);
    const handler = vi.fn();
    rpc.events.addEventListener('message.delta', handler);
    rpc.onFrame(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'message.delta', session_id: 'abc123', payload: { text: 'hello' } } }));
    expect(handler).toHaveBeenCalled();
    const event = handler.mock.calls[0][0] as import('./jsonrpc').RpcEvent;
    expect(event.sessionId).toBe('abc123');
    expect(event.payload).toEqual({ text: 'hello' });
  });

  it('maps representative gateway event frames onto the mobile JSON-RPC contract', () => {
    const send = vi.fn();
    const rpc = makeRpcClient(send);
    const handlers = new Map<string, ReturnType<typeof vi.fn>>();
    const fixtures = [
      { type: 'gateway.ready', payload: { skin: 'dark' } },
      { type: 'message.delta', session_id: 'live-1', payload: { text: 'Hel' } },
      { type: 'message.complete', session_id: 'live-1', payload: { text: 'Hello' } },
      { type: 'tool.progress', session_id: 'live-1', payload: { message: 'working' } },
      { type: 'reasoning.delta', session_id: 'live-1', payload: { text: 'thinking' } },
      { type: 'approval.request', session_id: 'live-1', payload: { id: 'ap-1', summary: 'Approve?' } },
      { type: 'clarify.request', session_id: 'live-1', payload: { id: 'cl-1', question: 'Which one?' } },
    ];

    for (const fixture of fixtures) {
      const handler = vi.fn();
      handlers.set(fixture.type, handler);
      rpc.events.addEventListener(fixture.type, handler);
    }

    for (const fixture of fixtures) {
      rpc.onFrame(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: fixture }));
    }

    for (const fixture of fixtures) {
      const handler = handlers.get(fixture.type);
      if (!handler) throw new Error(`missing handler for ${fixture.type}`);
      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0]?.[0] as import('./jsonrpc').RpcEvent | undefined;
      expect(event).toMatchObject({
        type: fixture.type,
        payload: fixture.payload,
      });
    }
    const readyEvent = handlers.get('gateway.ready')?.mock.calls[0]?.[0] as import('./jsonrpc').RpcEvent | undefined;
    const deltaEvent = handlers.get('message.delta')?.mock.calls[0]?.[0] as import('./jsonrpc').RpcEvent | undefined;
    expect(readyEvent?.sessionId).toBeUndefined();
    expect(deltaEvent?.sessionId).toBe('live-1');
  });

  it('maps recorded live gateway fixture frames onto the mobile JSON-RPC contract', async () => {
    const send = vi.fn();
    const rpc = makeRpcClient(send);
    const fixture = loadRecordedGatewayFixture('gateway-session-create');
    const readyHandler = vi.fn();
    rpc.events.addEventListener('gateway.ready', readyHandler);

    const sessionCreate = rpc.request<Record<string, unknown>>('session.create', { profile: 'default' });
    for (const frame of fixture.frames) {
      rpc.onFrame(JSON.stringify(frame));
    }

    const result = await sessionCreate;
    expect(fixture.source).toContain('recorded from live Hermes');
    expect(readyHandler).toHaveBeenCalledTimes(1);
    expect(readyHandler.mock.calls[0]?.[0]).toMatchObject({
      type: 'gateway.ready',
      payload: { skin: { name: 'default' } },
    });
    expect(result).toMatchObject({
      session_id: 'live-session-id',
      stored_session_id: 'stored-session-id',
      message_count: 0,
      messages: [],
      info: {
        desktop_contract: 2,
        profile_name: 'default',
      },
    });
  });

  it('omits sessionId when event frame has no session_id', async () => {
    const send = vi.fn();
    const rpc = makeRpcClient(send);
    const handler = vi.fn();
    rpc.events.addEventListener('gateway.ready', handler);
    rpc.onFrame(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: { skin: 'dark' } } }));
    const event = handler.mock.calls[0][0] as import('./jsonrpc').RpcEvent;
    expect(event.sessionId).toBeUndefined();
    expect(event.payload).toEqual({ skin: 'dark' });
  });

  it('handles multiple sequential requests with unique ids', () => {
    const send = vi.fn();
    const rpc = makeRpcClient(send);
    void rpc.request('a', {});
    void rpc.request('b', {});
    const first = JSON.parse(send.mock.calls[0][0].trim());
    const second = JSON.parse(send.mock.calls[1][0].trim());
    expect(first.id).toBe('1');
    expect(second.id).toBe('2');
  });

  it('ignores empty lines', () => {
    const send = vi.fn();
    const rpc = makeRpcClient(send);
    // Should not throw
    rpc.onFrame('  ');
    rpc.onFrame('');
  });

  it('rejects with JsonRpcError when response contains error', async () => {
    const send = vi.fn();
    const rpc = makeRpcClient(send);
    const promise = rpc.request('bad', {});
    rpc.onFrame(JSON.stringify({ jsonrpc: '2.0', id: '1', error: { code: 4001, message: 'session not found' } }));
    await expect(promise).rejects.toThrow('4001 session not found');
  });

  it('rejects all pending requests on disconnect', async () => {
    const send = vi.fn();
    const rpc = makeRpcClient(send);
    const first = rpc.request('session.usage', { session_id: 's1' });
    const second = rpc.request('prompt.submit', { session_id: 's1', prompt: 'hello' });

    rpc.disconnect();

    await expect(first).rejects.toThrow('Disconnected');
    await expect(second).rejects.toThrow('Disconnected');
  });

  it('rejects and removes a pending request when the response timeout elapses', async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const rpc = makeRpcClient(send, { timeoutMs: 25 });

    const first = rpc.request('slow', {});
    const rejection = expect(first).rejects.toThrow('JSON-RPC request timed out');
    await vi.advanceTimersByTimeAsync(25);
    await rejection;

    rpc.onFrame(JSON.stringify({ jsonrpc: '2.0', id: '1', result: 'late' }));
    const second = rpc.request<string>('next', {});
    rpc.onFrame(JSON.stringify({ jsonrpc: '2.0', id: '2', result: 'ok' }));
    await expect(second).resolves.toBe('ok');
  });

  it('ignores malformed frames without blocking later valid frames', () => {
    const send = vi.fn();
    const rpc = makeRpcClient(send);
    const handler = vi.fn();
    rpc.events.addEventListener('message.delta', handler);

    expect(() => rpc.onFrame('{bad json')).not.toThrow();
    rpc.onFrame(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'message.delta', payload: { text: 'ok' } } }));

    expect(handler).toHaveBeenCalledWith({ type: 'message.delta', payload: { text: 'ok' } });
  });

  it('accepts hot-path known gateway events without noisy warnings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const send = vi.fn();
    const rpc = makeRpcClient(send);
    const toolProgressHandler = vi.fn();
    const reasoningDeltaHandler = vi.fn();
    rpc.events.addEventListener('tool.progress', toolProgressHandler);
    rpc.events.addEventListener('reasoning.delta', reasoningDeltaHandler);

    rpc.onFrame(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'tool.progress', payload: { message: 'working' } } }));
    rpc.onFrame(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'reasoning.delta', payload: { text: 'thinking' } } }));

    expect(warn).not.toHaveBeenCalled();
    expect(toolProgressHandler).toHaveBeenCalledWith({ type: 'tool.progress', payload: { message: 'working' } });
    expect(reasoningDeltaHandler).toHaveBeenCalledWith({ type: 'reasoning.delta', payload: { text: 'thinking' } });
  });

  it('warns when the gateway sends an unknown event type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const send = vi.fn();
    const rpc = makeRpcClient(send);
    const handler = vi.fn();
    rpc.events.addEventListener('future.event', handler);

    rpc.onFrame(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'future.event', payload: { ok: true } } }));

    expect(warn).toHaveBeenCalledWith('[Hermes PWA] Unknown gateway event type: future.event');
    expect(handler).toHaveBeenCalledWith({ type: 'future.event', payload: { ok: true } });
  });

  it('dispatches server-initiated approval.request with rpcRequestId and responds by id', () => {
    const send = vi.fn();
    const rpc = makeRpcClient(send);
    const handler = vi.fn();
    rpc.events.addEventListener('approval.request', handler);

    rpc.onFrame(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'srv-42',
        method: 'approval.request',
        params: {
          session_id: 'live-1',
          approval_id: 'ap-42',
          command: 'gh pr list',
          description: 'Inspect open PRs',
        },
      }),
    );

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]?.[0] as import('./jsonrpc').RpcEvent;
    expect(event).toEqual({
      type: 'approval.request',
      sessionId: 'live-1',
      rpcRequestId: 'srv-42',
      payload: {
        session_id: 'live-1',
        approval_id: 'ap-42',
        command: 'gh pr list',
        description: 'Inspect open PRs',
      },
    });

    rpc.respond?.('srv-42', { choice: 'once' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][0].trim())).toEqual({
      jsonrpc: '2.0',
      id: 'srv-42',
      result: { choice: 'once' },
    });
  });

  it('returns -32601 error for unsupported server-initiated requests', () => {
    const send = vi.fn();
    const rpc = makeRpcClient(send);

    rpc.onFrame(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'srv-99',
        method: 'secret.request',
        params: {},
      }),
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][0].trim())).toEqual({
      jsonrpc: '2.0',
      id: 'srv-99',
      error: { code: -32601, message: 'Unsupported server request: secret.request' },
    });
  });

  it('dispatches request.cancel in both event-envelope and notification forms', () => {
    const send = vi.fn();
    const rpc = makeRpcClient(send);
    const handler = vi.fn();
    rpc.events.addEventListener('request.cancel', handler);

    rpc.onFrame(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'event',
        params: {
          type: 'request.cancel',
          session_id: 'live-1',
          payload: { request_id: 'srv-1', reason: 'timeout' },
        },
      }),
    );
    rpc.onFrame(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'request.cancel',
        params: {
          session_id: 'live-1',
          request_id: 'srv-2',
          reason: 'cancelled',
        },
      }),
    );

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0]?.[0]).toEqual({
      type: 'request.cancel',
      sessionId: 'live-1',
      payload: { request_id: 'srv-1', reason: 'timeout' },
    });
    expect(handler.mock.calls[1]?.[0]).toEqual({
      type: 'request.cancel',
      sessionId: 'live-1',
      payload: { session_id: 'live-1', request_id: 'srv-2', reason: 'cancelled' },
    });
  });

  it('does not inject extra fields into strict session methods, maps v8 approval/clarify server requests, and does not settle client pending requests on colliding server request id', async () => {
    const send = vi.fn();
    const rpc = makeRpcClient(send);
    const approvalHandler = vi.fn();
    const clarifyHandler = vi.fn();
    rpc.events.addEventListener('approval.request', approvalHandler);
    rpc.events.addEventListener('clarify.request', clarifyHandler);

    const resumePromise = rpc.request('session.resume', { session_id: 's-1' });
    void rpc.request('session.activate', { session_id: 's-1' });
    void rpc.request('session.create', { profile: 'default' });

    expect(JSON.parse(send.mock.calls[0][0].trim())).toEqual({
      jsonrpc: '2.0',
      id: '1',
      method: 'session.resume',
      params: { session_id: 's-1' },
    });
    expect(JSON.parse(send.mock.calls[1][0].trim())).toEqual({
      jsonrpc: '2.0',
      id: '2',
      method: 'session.activate',
      params: { session_id: 's-1' },
    });
    expect(JSON.parse(send.mock.calls[2][0].trim())).toEqual({
      jsonrpc: '2.0',
      id: '3',
      method: 'session.create',
      params: { profile: 'default' },
    });

    // Server sends v8 "approval" request whose id collides with client request id '1'
    rpc.onFrame(
      JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'approval',
        params: { session_id: 's-1', request_id: 'ap-collide', command: 'ls' },
      }),
    );
    expect(approvalHandler).toHaveBeenCalledTimes(1);
    expect(approvalHandler.mock.calls[0]?.[0]).toMatchObject({
      type: 'approval.request',
      sessionId: 's-1',
      rpcRequestId: '1',
    });

    // Server sends legacy "approval.request" and v8 "clarify" requests
    rpc.onFrame(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'srq-legacy',
        method: 'approval.request',
        params: { session_id: 's-1', approval_id: 'ap-leg', command: 'pwd' },
      }),
    );
    expect(approvalHandler).toHaveBeenCalledTimes(2);

    rpc.onFrame(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'srq-2',
        method: 'clarify',
        params: { session_id: 's-1', questions: [{ qid: 'q1', question: 'Which branch?' }] },
      }),
    );
    expect(clarifyHandler).toHaveBeenCalledTimes(1);
    expect(clarifyHandler.mock.calls[0]?.[0]).toMatchObject({
      type: 'clarify.request',
      sessionId: 's-1',
      rpcRequestId: 'srq-2',
    });
    // Client request '1' must still resolve from the actual response frame
    rpc.onFrame(JSON.stringify({ jsonrpc: '2.0', id: '1', result: { session_id: 's-1' } }));
    await expect(resumePromise).resolves.toEqual({ session_id: 's-1' });
  });
});
