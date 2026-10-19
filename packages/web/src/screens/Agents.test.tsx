import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Agents } from './Agents';
import { useChatStore, useSpawnStore, makeRpcEvents } from '@hermes-pwa/core';

const rpcMock = {
  request: vi.fn().mockResolvedValue({}),
  onFrame: vi.fn(),
  events: makeRpcEvents(),
} as unknown as import('@hermes-pwa/core').RpcClient;

describe('Agents (spawn tree)', () => {
  beforeEach(() => {
    useChatStore.setState({ sessionId: undefined, storedSessionId: undefined, messages: [], streaming: false, error: undefined });
    useSpawnStore.setState({ sessionId: undefined, agents: [], tree: [] });
  });

  it('shows empty state when no agents', () => {
    render(<Agents rpc={rpcMock} />);
    expect(screen.getByText(/No agents yet/i)).toBeInTheDocument();
  });

  it('renders spawn tree for current session', () => {
    useChatStore.setState({ sessionId: 's-1' });
    useSpawnStore.setState({
      sessionId: 's-1',
      agents: [
        {
          id: 'a-1',
          parentId: null,
          sessionId: 's-1',
          goal: 'Research topic',
          status: 'running',
          taskIndex: 0,
          taskCount: 1,
          startedAt: Date.now(),
          updatedAt: Date.now(),
          filesRead: [],
          filesWritten: [],
          stream: [],
        },
      ],
      tree: [
        {
          id: 'a-1',
          parentId: null,
          sessionId: 's-1',
          goal: 'Research topic',
          status: 'running',
          taskIndex: 0,
          taskCount: 1,
          startedAt: Date.now(),
          updatedAt: Date.now(),
          filesRead: [],
          filesWritten: [],
          stream: [],
          children: [],
        },
      ],
    });
    render(<Agents rpc={rpcMock} />);
    expect(screen.getByText('Research topic')).toBeInTheDocument();
    expect(screen.getAllByTestId('spawn-row')).toHaveLength(1);
  });
});
