import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useActivityStore } from './activity';
import type { RpcClient } from '../transport/jsonrpc';

describe('useActivityStore', () => {
  let rpcMock: RpcClient;

  beforeEach(() => {
    useActivityStore.setState({ items: [], loading: false, error: undefined });
    rpcMock = {
      request: vi.fn(),
      onFrame: vi.fn(),
      events: new EventTarget(),
    } as unknown as RpcClient;
  });

  it('respondApproval removes item', async () => {
    useActivityStore.setState({
      items: [
        {
          id: 'a-1',
          kind: 'approval',
          status: 'needs_you',
          title: 'Deploy',
          sessionId: 'sess-1',
          createdAt: 1,
        },
      ],
    });
    vi.mocked(rpcMock.request).mockResolvedValue({});
    await useActivityStore.getState().respondApproval(rpcMock, 'a-1', 'approve');
    expect(useActivityStore.getState().items).toHaveLength(0);
    expect(rpcMock.request).toHaveBeenCalledWith('approval.respond', {
      choice: 'once',
      session_id: 'sess-1',
    });
  });

  it('respondApproval rejects duplicate in-flight responses so controls can recover', async () => {
    useActivityStore.setState({
      items: [
        {
          id: 'a-1',
          kind: 'approval',
          status: 'needs_you',
          title: 'Deploy',
          sessionId: 'sess-1',
          createdAt: 1,
        },
      ],
    });
    let resolveRequest: ((value: unknown) => void) | undefined;
    vi.mocked(rpcMock.request).mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }) as never,
    );

    const first = useActivityStore.getState().respondApproval(rpcMock, 'a-1', 'approve');
    const second = useActivityStore.getState().respondApproval(rpcMock, 'a-1', 'approve');
    await expect(second).rejects.toThrow('Approval response already in progress.');
    resolveRequest?.({});
    await first;

    expect(rpcMock.request).toHaveBeenCalledTimes(1);
  });

  it('respondApproval refuses to call backend without session_id', async () => {
    useActivityStore.setState({
      items: [{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'Deploy', createdAt: 1 }],
    });
    vi.mocked(rpcMock.request).mockRejectedValue(new Error('nope'));
    await expect(
      useActivityStore.getState().respondApproval(rpcMock, 'a-1', 'approve'),
    ).rejects.toThrow('Approval response requires session_id.');
    expect(rpcMock.request).not.toHaveBeenCalled();
    expect(useActivityStore.getState().error).toBe('Approval response requires session_id.');
  });

  it('respondApproval keeps backend errors visible', async () => {
    useActivityStore.setState({
      items: [
        {
          id: 'a-1',
          kind: 'approval',
          status: 'needs_you',
          title: 'Deploy',
          sessionId: 'sess-1',
          createdAt: 1,
        },
      ],
    });
    vi.mocked(rpcMock.request).mockRejectedValue(new Error('nope'));
    await expect(
      useActivityStore.getState().respondApproval(rpcMock, 'a-1', 'approve'),
    ).rejects.toThrow('nope');
    expect(useActivityStore.getState().error).toBe('nope');
  });

  it('respondApproval removes stale approval when backend says no pending approval', async () => {
    useActivityStore.setState({
      items: [
        {
          id: 'a-1',
          kind: 'approval',
          status: 'needs_you',
          title: 'Deploy',
          sessionId: 'sess-1',
          createdAt: 1,
        },
      ],
    });
    vi.mocked(rpcMock.request).mockRejectedValue(new Error('4009 no pending approval for session'));

    await expect(
      useActivityStore.getState().respondApproval(rpcMock, 'a-1', 'approve'),
    ).resolves.toBeUndefined();

    expect(useActivityStore.getState().items).toHaveLength(0);
    expect(useActivityStore.getState().error).toBe('Approval expired or was already handled.');
  });

  it('respondApproval does not hide unrelated 4009 busy errors as stale approvals', async () => {
    useActivityStore.setState({
      items: [
        {
          id: 'a-1',
          kind: 'approval',
          status: 'needs_you',
          title: 'Deploy',
          sessionId: 'sess-1',
          createdAt: 1,
        },
      ],
    });
    vi.mocked(rpcMock.request).mockRejectedValue(new Error('4009 session busy'));

    await expect(
      useActivityStore.getState().respondApproval(rpcMock, 'a-1', 'approve'),
    ).rejects.toThrow('4009 session busy');

    expect(useActivityStore.getState().items).toHaveLength(1);
    expect(useActivityStore.getState().error).toBe('4009 session busy');
  });

  it('respondClarify removes item', async () => {
    useActivityStore.setState({
      items: [{ id: 'c-1', kind: 'clarify', status: 'needs_you', title: 'Clarify', createdAt: 1 }],
    });
    vi.mocked(rpcMock.request).mockResolvedValue({});
    await useActivityStore.getState().respondClarify(rpcMock, 'c-1', 'yes');
    expect(useActivityStore.getState().items).toHaveLength(0);
    expect(rpcMock.request).toHaveBeenCalledWith('clarify.respond', { id: 'c-1', answer: 'yes' });
  });

  it('respondClarify handles error', async () => {
    useActivityStore.setState({
      items: [{ id: 'c-1', kind: 'clarify', status: 'needs_you', title: 'Clarify', createdAt: 1 }],
    });
    vi.mocked(rpcMock.request).mockRejectedValue(new Error('fail'));
    await expect(useActivityStore.getState().respondClarify(rpcMock, 'c-1', 'yes')).rejects.toThrow(
      'fail',
    );
    expect(useActivityStore.getState().error).toBe('fail');
  });

  it('dismiss removes item', () => {
    useActivityStore.setState({
      items: [
        { id: 'a-1', kind: 'approval', status: 'needs_you', title: 'T1', createdAt: 1 },
        { id: 'a-2', kind: 'approval', status: 'needs_you', title: 'T2', createdAt: 1 },
      ],
    });
    useActivityStore.getState().dismiss('a-1');
    expect(useActivityStore.getState().items).toHaveLength(1);
    expect(useActivityStore.getState().items[0]?.id).toBe('a-2');
  });

  it('addItem prepends', () => {
    useActivityStore.setState({
      items: [{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'T1', createdAt: 1 }],
    });
    useActivityStore
      .getState()
      .addItem({ id: 'a-2', kind: 'approval', status: 'needs_you', title: 'T2', createdAt: 1 });
    expect(useActivityStore.getState().items[0]?.id).toBe('a-2');
  });

  it('dedupes realtime and hydrated approvals with matching session identity', async () => {
    const restMock = {
      pendingActions: vi.fn().mockResolvedValue([
        {
          id: 'approval:rest-id',
          kind: 'approval',
          status: 'needs_you',
          title: 'Approval required',
          sessionId: '14df21e2',
          summary: 'rm -rf /tmp/example\nDangerous command approval required',
          createdAt: 2,
        },
      ]),
    };

    useActivityStore.getState().addItem({
      id: 'approval:realtime-id',
      kind: 'approval',
      status: 'needs_you',
      title: 'Approval required',
      sessionId: '14df21e2',
      rpcRequestId: 'srv-realtime',
      sourceSessionId: '14df21e2',
      summary: 'rm -rf /tmp/example\nDangerous command approval required',
      createdAt: 1,
    });

    await useActivityStore.getState().load(restMock as never, 'default');

    const items = useActivityStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('approval:realtime-id');
    expect(items[0]?.sessionId).toBe('14df21e2');
    expect(items[0]?.sourceSessionId).toBe('14df21e2');
  });

  it('removes local stale approvals when pending refresh says none remain', async () => {
    const restMock = {
      pendingActions: vi.fn().mockResolvedValue([]),
    };

    useActivityStore.setState({
      items: [
        {
          id: 'approval:stale',
          kind: 'approval',
          status: 'needs_you',
          title: 'Approval required',
          sessionId: 'sess-1',
          summary: 'rm -rf /tmp/example\nDangerous command approval required',
          createdAt: 1,
        },
        {
          id: 'status-1',
          kind: 'run',
          status: 'running',
          title: 'Background task',
          createdAt: 1,
        },
      ],
    });

    await useActivityStore.getState().load(restMock as never, 'default');

    const items = useActivityStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('status-1');
  });

  it('addItem replaces equivalent approval even when ids differ', () => {
    useActivityStore.setState({
      items: [
        {
          id: 'approval:old',
          kind: 'approval',
          status: 'needs_you',
          title: 'Approval required',
          sessionId: 'telegram:5326786243',
          summary: 'rm -rf /tmp/example\nDangerous command approval required',
          createdAt: 1,
        },
      ],
    });

    useActivityStore.getState().addItem({
      id: 'approval:new',
      kind: 'approval',
      status: 'needs_you',
      title: 'Approval required',
      sessionId: 'telegram:5326786243',
      summary: 'rm -rf /tmp/example\nDangerous command approval required',
      createdAt: 2,
    });

    const items = useActivityStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('approval:new');
  });

  it('updateItem patches fields', () => {
    useActivityStore.setState({
      items: [{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'T1', createdAt: 1 }],
    });
    useActivityStore.getState().updateItem('a-1', { status: 'completed' });
    expect(useActivityStore.getState().items[0]?.status).toBe('completed');
  });

  it('clear resets', () => {
    useActivityStore.setState({
      items: [{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'T1', createdAt: 1 }],
      error: 'oops',
    });
    useActivityStore.getState().clear();
    expect(useActivityStore.getState().items).toEqual([]);
    expect(useActivityStore.getState().error).toBeUndefined();
  });

  it('respondApproval replies via rpc.respond when rpcRequestId is present', async () => {
    const respond = vi.fn();
    const rpcWithRespond = { ...rpcMock, respond } as unknown as RpcClient;
    useActivityStore.setState({
      items: [
        {
          id: 'ap-42',
          kind: 'approval',
          status: 'needs_you',
          title: 'Approval required',
          sessionId: 'live-1',
          rpcRequestId: 'srv-42',
          createdAt: 1,
        },
      ],
    });

    await useActivityStore
      .getState()
      .respondApproval(rpcWithRespond, 'ap-42', 'approve', undefined, 'session');

    expect(respond).toHaveBeenCalledWith('srv-42', { choice: 'session' });
    expect(rpcMock.request).not.toHaveBeenCalled();
    expect(useActivityStore.getState().items).toHaveLength(0);
  });

  it('cancelRpcRequest and clearRpcRequests remove server-initiated requests', () => {
    useActivityStore.setState({
      items: [
        {
          id: 'ap-42',
          kind: 'approval',
          status: 'needs_you',
          title: 'Approval required',
          sessionId: 'live-1',
          rpcRequestId: 'srv-42',
          createdAt: 1,
        },
        {
          id: 'ap-rest',
          kind: 'approval',
          status: 'needs_you',
          title: 'Approval required',
          sessionId: 'live-1',
          createdAt: 1,
        },
      ],
    });

    useActivityStore.getState().cancelRpcRequest('srv-42');
    expect(useActivityStore.getState().items.map((i) => i.id)).toEqual(['ap-rest']);

    useActivityStore.getState().addItem({
      id: 'ap-43',
      kind: 'approval',
      status: 'needs_you',
      title: 'Approval required',
      sessionId: 'live-1',
      rpcRequestId: 'srv-43',
      createdAt: 2,
    });
    useActivityStore.getState().clearRpcRequests();
    expect(useActivityStore.getState().items.map((i) => i.id)).toEqual(['ap-rest']);
  });

  it('respondClarify replies via rpc.respond with v8 answers map (including multi-question batches) and legacy answer otherwise', async () => {
    const respond = vi.fn();
    const rpcWithRespond = { ...rpcMock, respond } as unknown as RpcClient;
    useActivityStore.setState({
      items: [
        {
          id: 'c-42',
          kind: 'clarify',
          status: 'needs_you',
          title: 'Clarification needed',
          summary: 'Proceed?',
          sessionId: 'live-1',
          rpcRequestId: 'srv-c-42',
          createdAt: 1,
        },
        {
          id: 'c-v8:q1',
          kind: 'clarify',
          status: 'needs_you',
          title: 'Clarification needed',
          summary: 'Which branch?',
          sessionId: 'live-1',
          rpcRequestId: 'srq-v8',
          qid: 'q1',
          createdAt: 2,
        },
        {
          id: 'c-v8:q2',
          kind: 'clarify',
          status: 'needs_you',
          title: 'Clarification needed',
          summary: 'Merge strategy?',
          sessionId: 'live-1',
          rpcRequestId: 'srq-v8',
          qid: 'q2',
          createdAt: 3,
        },
      ],
    });

    await useActivityStore.getState().respondClarify(rpcWithRespond, 'c-42', 'yes');
    expect(respond).toHaveBeenCalledWith('srv-c-42', { answer: 'yes' });

    await useActivityStore.getState().respondClarify(rpcWithRespond, 'c-v8:q2', 'squash');
    expect(respond).toHaveBeenCalledTimes(1);

    await useActivityStore.getState().respondClarify(rpcWithRespond, 'c-v8:q1', 'main');
    expect(respond).toHaveBeenCalledWith('srq-v8', { answers: { q2: 'squash', q1: 'main' } });
    expect(rpcMock.request).not.toHaveBeenCalled();
    expect(useActivityStore.getState().items).toHaveLength(0);
  });

  it('preserves source attribution when REST matches a legacy realtime approval', async () => {
    useActivityStore.setState({
      items: [
        {
          id: 'ap-legacy-live',
          kind: 'approval',
          status: 'needs_you',
          title: 'Approval required',
          summary: 'git push',
          sessionId: 'queue-key',
          sourceSessionId: 'source-chat',
          createdAt: Date.now(),
        },
      ],
    });
    const rest = {
      pendingActions: vi.fn().mockResolvedValue([
        {
          id: 'ap-legacy-rest',
          kind: 'approval',
          status: 'needs_you',
          title: 'Approval required',
          summary: 'git push',
          sessionId: 'queue-key',
          createdAt: Date.now(),
          highImpact: true,
        },
      ]),
    } as unknown as import('../transport/rest').RestClient;

    await useActivityStore.getState().load(rest, 'default');

    expect(useActivityStore.getState().items).toHaveLength(1);
    expect(useActivityStore.getState().items[0]).toMatchObject({
      id: 'ap-legacy-rest',
      sessionId: 'queue-key',
      sourceSessionId: 'source-chat',
    });
  });

  it('does not merge fuzzy legacy approvals from different sessions', async () => {
    useActivityStore.setState({
      items: [
        {
          id: 'ap-other-live',
          kind: 'approval',
          status: 'needs_you',
          title: 'Approval required',
          summary: 'git push',
          sessionId: 'other-chat',
          sourceSessionId: 'other-chat',
          createdAt: Date.now(),
        },
      ],
    });
    const rest = {
      pendingActions: vi.fn().mockResolvedValue([
        {
          id: 'ap-rest',
          kind: 'approval',
          status: 'needs_you',
          title: 'Approval required',
          summary: 'git push',
          sessionId: 'queue-key',
          createdAt: Date.now(),
          highImpact: true,
        },
      ]),
    } as unknown as import('../transport/rest').RestClient;

    await useActivityStore.getState().load(rest, 'default');

    expect(useActivityStore.getState().items).toHaveLength(2);
    expect(useActivityStore.getState().items[0]).toMatchObject({
      id: 'ap-rest',
      sessionId: 'queue-key',
    });
    expect(useActivityStore.getState().items[0]?.sourceSessionId).toBeUndefined();
  });
  it('preserves rpc identity without inferring a thread from the recovered queue key', async () => {
    useActivityStore.setState({
      items: [
        {
          id: 'ap-live',
          kind: 'approval',
          status: 'needs_you',
          title: 'Approval required',
          summary: 'gh pr list\nInspect open PRs',
          sessionId: 'live-sess-1',
          rpcRequestId: 'srv-99',
          createdAt: 1,
        },
      ],
    });

    const rest = {
      pendingActions: vi.fn().mockResolvedValue([
        {
          id: 'ap-rest-row',
          kind: 'approval',
          status: 'needs_you',
          title: 'Approval required',
          summary: 'gh pr list\nInspect open PRs',
          sessionId: 'live-sess-1',
          createdAt: 2,
          highImpact: true,
        },
      ]),
    } as unknown as import('../transport/rest').RestClient;

    await useActivityStore.getState().load(rest, 'default');
    const items = useActivityStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'ap-live',
      rpcRequestId: 'srv-99',
      sessionId: 'live-sess-1',
    });
    expect(items[0]?.sourceSessionId).toBeUndefined();
  });
  it('does not merge fuzzy RPC approvals from different sessions', async () => {
    useActivityStore.setState({
      items: [
        {
          id: 'ap-live',
          kind: 'approval',
          status: 'needs_you',
          title: 'Approval required',
          summary: 'git push',
          sessionId: 'other-chat',
          sourceSessionId: 'other-chat',
          rpcRequestId: 'srv-other',
          createdAt: Date.now(),
        },
      ],
    });
    const rest = {
      pendingActions: vi.fn().mockResolvedValue([
        {
          id: 'ap-rest',
          kind: 'approval',
          status: 'needs_you',
          title: 'Approval required',
          summary: 'git push',
          sessionId: 'queue-key',
          createdAt: Date.now(),
          highImpact: true,
        },
      ]),
    } as unknown as import('../transport/rest').RestClient;

    await useActivityStore.getState().load(rest, 'default');

    expect(useActivityStore.getState().items).toHaveLength(2);
    expect(useActivityStore.getState().items.find((item) => item.id === 'ap-rest')).toMatchObject({
      sessionId: 'queue-key',
    });
    expect(
      useActivityStore.getState().items.find((item) => item.id === 'ap-rest')?.rpcRequestId,
    ).toBeUndefined();
    expect(
      useActivityStore.getState().items.find((item) => item.id === 'ap-rest')?.sourceSessionId,
    ).toBeUndefined();
  });
});
