import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Activity } from './Activity';
import { useActivityStore, useConnectionStore, usePaperlessStore, makeRpcEvents } from '@hermes-pwa/core';
import type { RestClient } from '@hermes-pwa/core';

const rpcMock = {
  request: vi.fn(),
  onFrame: vi.fn(),
  events: makeRpcEvents(),
} as unknown as import('@hermes-pwa/core').RpcClient;

describe('Activity', () => {
  beforeEach(() => {
    useActivityStore.setState({ items: [], loading: false, error: undefined });
    usePaperlessStore.setState({ pending: null, busy: false, error: undefined, result: undefined });
    useConnectionStore.setState({ state: 'connected', error: undefined } as ReturnType<typeof useConnectionStore.getState>);
    vi.clearAllMocks();
  });

  it('renders empty state when no items', async () => {
    render(<Activity rpc={rpcMock} />);
    await waitFor(() => expect(screen.getByText(/All clear/i)).toBeInTheDocument());
  });

  it('renders pending approval items', () => {
    useActivityStore.setState({
      items: [
        { id: 'a-1', kind: 'approval', status: 'needs_you', title: 'shell.exec', summary: 'git commit', createdAt: 1 },
        { id: 'a-2', kind: 'run', status: 'running', title: 'Running', createdAt: 1 },
      ],
    });
    render(<Activity rpc={rpcMock} />);
    expect(screen.getByText('shell.exec')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
  });


  it('groups approvals under Needs you and run/system items under Notices', () => {
    useActivityStore.setState({
      items: [
        { id: 'a-1', kind: 'approval', status: 'needs_you', title: 'shell.exec', createdAt: 1 },
        { id: 'n-1', kind: 'run', status: 'completed', title: 'Nightly backup', summary: 'Snapshot verified', createdAt: 1 },
      ],
    });
    render(<Activity rpc={rpcMock} />);
    expect(screen.getByText('Needs you · 1')).toBeInTheDocument();
    expect(screen.getByText('Notices')).toBeInTheDocument();
    expect(screen.getByTestId('notice-row')).toHaveTextContent('Nightly backup');
    expect(screen.getByTestId('notice-row')).toHaveTextContent('Snapshot verified');
  });
  it('shows connecting state when init/offline', () => {
    useConnectionStore.setState({ state: 'init', error: undefined } as ReturnType<typeof useConnectionStore.getState>);
    render(<Activity rpc={rpcMock} />);
    expect(screen.getByText(/Connecting to Hermes/i)).toBeInTheDocument();
  });

  it('keeps cached content visible while reconnecting', () => {
    useActivityStore.setState({
      items: [{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'Cached item', createdAt: 1 }],
    });
    useConnectionStore.setState({ state: 'reconnecting', error: undefined } as ReturnType<typeof useConnectionStore.getState>);
    render(<Activity rpc={rpcMock} />);
    expect(screen.getByText('Cached item')).toBeInTheDocument();
  });

  it('does not subscribe to ws events directly; AppShell owns the global activity feed', async () => {
    render(<Activity rpc={rpcMock} />);
    rpcMock.events.dispatchEvent({ type: 'approval.request', payload: { id: 'a-1', title: 'New approval' } });
    await waitFor(() => expect(screen.getByText(/All clear/i)).toBeInTheDocument());
  });

  it('ignores status.update without process text', async () => {
    useActivityStore.setState({ items: [] });
    render(<Activity rpc={rpcMock} />);
    rpcMock.events.dispatchEvent({ type: 'status.update', payload: {} });
    await waitFor(() => expect(screen.getByText(/All clear/i)).toBeInTheDocument());
  });

  it('lists a pending Paperless approval and imports only ready PDFs', async () => {
    const rest = {
      paperlessPending: vi.fn().mockResolvedValue({
        runId: 'run-1',
        expiresAt: '2026-10-18T00:00:00Z',
        candidates: [
          { number: 1, title: 'Invoice', filename: 'a.pdf', status: 'ready' },
          { number: 2, title: 'Statement', filename: 'b.pdf', status: 'needs_retry' },
        ],
      }),
      paperlessDecide: vi.fn().mockResolvedValue({ titles: ['Invoice'] }),
    } as unknown as RestClient;
    render(<Activity rpc={rpcMock} rest={rest} />);
    await waitFor(() => expect(screen.getByTestId('paperless-card')).toBeInTheDocument());
    expect(screen.queryByText(/All clear/i)).not.toBeInTheDocument();
    const [ready, retry] = screen.getAllByRole('checkbox');
    expect(retry).toBeDisabled();
    const importBtn = screen.getByRole('button', { name: 'Import selected' });
    expect(importBtn).toBeDisabled();
    fireEvent.click(ready!);
    fireEvent.click(importBtn);
    await waitFor(() => expect(screen.getByText('Import queued: Invoice')).toBeInTheDocument());
    expect(rest.paperlessDecide).toHaveBeenCalledWith('approve', 'run-1', [1]);
  });

  it('hides the Paperless card when the plugin route is missing', async () => {
    const rest = { paperlessPending: vi.fn().mockRejectedValue(new Error('404')) } as unknown as RestClient;
    render(<Activity rpc={rpcMock} rest={rest} />);
    await waitFor(() => expect(screen.getByText(/All clear/i)).toBeInTheDocument());
    expect(screen.queryByTestId('paperless-card')).not.toBeInTheDocument();
  });
});
