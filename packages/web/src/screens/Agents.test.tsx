import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Agents } from './Agents';
import { useChatStore, useSpawnStore, makeRpcEvents, type SpawnNode } from '@hermes-pwa/core';

const rpcMock = {
  request: vi.fn().mockResolvedValue({}),
  onFrame: vi.fn(),
  events: makeRpcEvents(),
} as unknown as import('@hermes-pwa/core').RpcClient;

function node(partial: Partial<SpawnNode> & Pick<SpawnNode, 'id' | 'goal' | 'status'>): SpawnNode {
  return {
    parentId: null,
    sessionId: 's-1',
    taskIndex: 1,
    taskCount: 1,
    startedAt: Date.now() - 60_000,
    updatedAt: Date.now(),
    filesRead: [],
    filesWritten: [],
    stream: [],
    children: [],
    ...partial,
  };
}

function seed(agents: SpawnNode[]) {
  useChatStore.setState({ sessionId: 's-1' });
  useSpawnStore.setState({ sessionId: 's-1', agents, tree: agents });
}

describe('Agents (M11)', () => {
  beforeEach(() => {
    useChatStore.setState({ sessionId: undefined, storedSessionId: undefined, messages: [], streaming: false, error: undefined });
    useSpawnStore.setState({ sessionId: undefined, agents: [], tree: [] });
    window.location.hash = '';
  });

  it('shows empty state when no agents', () => {
    render(<Agents rpc={rpcMock} />);
    expect(screen.getByText(/No agents yet/i)).toBeInTheDocument();
  });

  it('renders active run card with meta and open-chat link', () => {
    seed([
      node({ id: 'run-7f3', goal: 'Refactor WS reconnect', status: 'running', model: 'GPT-5.5', taskIndex: 4, taskCount: 5 }),
    ]);
    render(<Agents rpc={rpcMock} />);
    expect(screen.getByTestId('agents-active-card')).toHaveTextContent('run-7f3 · Refactor WS reconnect');
    expect(screen.getByTestId('agents-active-card')).toHaveTextContent('GPT-5.5 · running 1m · step 4 of 5');
    expect(screen.getByRole('tab', { name: 'Active · 1' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Open chat/ }));
    expect(window.location.hash).toBe('#/chat?session=s-1');
  });

  it('renders recent rows with ✓/✕ icons, sub-line, and log link', () => {
    seed([
      node({ id: 'run-7e1', goal: 'Soul rewrite', status: 'completed', model: 'career-content', durationSeconds: 480 }),
      node({ id: 'run-7d9', goal: 'Backup to S3', status: 'failed', model: 'ops', stream: [{ kind: 'summary', text: 'missing AWS creds', at: Date.now() }] }),
    ]);
    render(<Agents rpc={rpcMock} />);
    const rows = screen.getAllByTestId('agents-recent-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('✓');
    expect(rows[0]).toHaveTextContent('run-7e1 · Soul rewrite');
    expect(rows[0]).toHaveTextContent('career-content · finished in 8m');
    expect(rows[1]).toHaveTextContent('✕');
    expect(rows[1]).toHaveTextContent('ops · failed · missing AWS creds');
    fireEvent.click(screen.getAllByRole('button', { name: 'log' })[0]!);
    expect(window.location.hash).toBe('#/chat?session=s-1');
  });

  it('Recent tab hides active cards and shows only recent rows', () => {
    seed([
      node({ id: 'run-7f3', goal: 'Refactor WS reconnect', status: 'running' }),
      node({ id: 'run-7e1', goal: 'Soul rewrite', status: 'completed' }),
    ]);
    render(<Agents rpc={rpcMock} />);
    expect(screen.getByTestId('agents-active-card')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Recent · 1' }));
    expect(screen.queryByTestId('agents-active-card')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('agents-recent-row')).toHaveLength(1);
  });
});
