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
      items: [{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'Deploy', sessionId: 'sess-1', createdAt: 1 }],
    });
    vi.mocked(rpcMock.request).mockResolvedValue({});
    await useActivityStore.getState().respondApproval(rpcMock, 'a-1', 'approve');
    expect(useActivityStore.getState().items).toHaveLength(0);
    expect(rpcMock.request).toHaveBeenCalledWith('approval.respond', {
      choice: 'once',
      session_id: 'sess-1',
    });
  });

  it('respondApproval ignores duplicate in-flight responses for the same approval', async () => {
    useActivityStore.setState({
      items: [{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'Deploy', sessionId: 'sess-1', createdAt: 1 }],
    });
    let resolveRequest: ((value: unknown) => void) | undefined;
    vi.mocked(rpcMock.request).mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }) as never,
    );

    const first = useActivityStore.getState().respondApproval(rpcMock, 'a-1', 'approve');
    const second = useActivityStore.getState().respondApproval(rpcMock, 'a-1', 'approve');
    resolveRequest?.({});
    await Promise.all([first, second]);

    expect(rpcMock.request).toHaveBeenCalledTimes(1);
  });

  it('respondApproval refuses to call backend without session_id', async () => {
    useActivityStore.setState({
      items: [{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'Deploy', createdAt: 1 }],
    });
    vi.mocked(rpcMock.request).mockRejectedValue(new Error('nope'));
    await expect(useActivityStore.getState().respondApproval(rpcMock, 'a-1', 'approve')).rejects.toThrow(
      'Approval response requires session_id.',
    );
    expect(rpcMock.request).not.toHaveBeenCalled();
    expect(useActivityStore.getState().error).toBe('Approval response requires session_id.');
  });

  it('respondApproval keeps backend errors visible', async () => {
    useActivityStore.setState({
      items: [{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'Deploy', sessionId: 'sess-1', createdAt: 1 }],
    });
    vi.mocked(rpcMock.request).mockRejectedValue(new Error('nope'));
    await expect(useActivityStore.getState().respondApproval(rpcMock, 'a-1', 'approve')).rejects.toThrow('nope');
    expect(useActivityStore.getState().error).toBe('nope');
  });

  it('respondApproval removes stale approval when backend says no pending approval', async () => {
    useActivityStore.setState({
      items: [{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'Deploy', sessionId: 'sess-1', createdAt: 1 }],
    });
    vi.mocked(rpcMock.request).mockRejectedValue(new Error('4009 no pending approval for session'));

    await expect(useActivityStore.getState().respondApproval(rpcMock, 'a-1', 'approve')).resolves.toBeUndefined();

    expect(useActivityStore.getState().items).toHaveLength(0);
    expect(useActivityStore.getState().error).toBe('Approval expired or was already handled.');
  });

  it('respondApproval does not hide unrelated 4009 busy errors as stale approvals', async () => {
    useActivityStore.setState({
      items: [{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'Deploy', sessionId: 'sess-1', createdAt: 1 }],
    });
    vi.mocked(rpcMock.request).mockRejectedValue(new Error('4009 session busy'));

    await expect(useActivityStore.getState().respondApproval(rpcMock, 'a-1', 'approve')).rejects.toThrow('4009 session busy');

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
    await expect(useActivityStore.getState().respondClarify(rpcMock, 'c-1', 'yes')).rejects.toThrow('fail');
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
    useActivityStore.getState().addItem({ id: 'a-2', kind: 'approval', status: 'needs_you', title: 'T2', createdAt: 1 });
    expect(useActivityStore.getState().items[0]?.id).toBe('a-2');
  });

  it('dedupes realtime and hydrated approvals that describe the same pending command', async () => {
    const restMock = {
      pendingActions: vi.fn().mockResolvedValue([
        {
          id: 'approval:rest-id',
          kind: 'approval',
          status: 'needs_you',
          title: 'Approval required',
          sessionId: '20260622_120000_backend',
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
      sourceSessionId: '14df21e2',
      summary: 'rm -rf /tmp/example\nDangerous command approval required',
      createdAt: 1,
    });

    await useActivityStore.getState().load(restMock as never, 'default');

    const items = useActivityStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('approval:rest-id');
    expect(items[0]?.sessionId).toBe('20260622_120000_backend');
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

    await useActivityStore.getState().respondApproval(rpcWithRespond, 'ap-42', 'approve', undefined, 'session');

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

  it('respondClarify replies via rpc.respond when rpcRequestId is present', async () => {
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
      ],
    });

    await useActivityStore.getState().respondClarify(rpcWithRespond, 'c-42', 'yes');

    expect(respond).toHaveBeenCalledWith('srv-c-42', { answer: 'yes' });
    expect(rpcMock.request).not.toHaveBeenCalled();
    expect(useActivityStore.getState().items).toHaveLength(0);
  });

  it('preserves rpcRequestId and sessionId when REST load merges with a live server-request approval', async () => {
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
          sessionId: 'stored-sess-1',
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
      sourceSessionId: 'stored-sess-1',
    });
  });
});
