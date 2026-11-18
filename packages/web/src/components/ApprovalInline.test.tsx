import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useActivityStore, useChatStore, type Approval, type RpcClient } from '@hermes-pwa/core';
import { ApprovalInline } from './ApprovalInline';

const rpc = {} as RpcClient;
const approval: Approval = {
  id: 'approval-a',
  kind: 'approval',
  status: 'needs_you',
  title: 'shell.exec',
  summary: 'git push',
  highImpact: false,
  visibility: 'private',
  createdAt: Date.now(),
};

describe('ApprovalInline', () => {
  it('keeps pending state isolated when approvals change and settle', async () => {
    const resolvers = new Map<string, () => void>();
    const respondApproval = vi.fn((_rpc: RpcClient, id: string) => new Promise<void>((resolve) => {
      resolvers.set(id, resolve);
    }));
    useActivityStore.setState({ items: [approval], respondApproval });
    useChatStore.setState({ sessionId: 'session-a', storedSessionId: 'session-a' });
    render(<ApprovalInline rpc={rpc} />);

    fireEvent.click(screen.getByRole('button', { name: /^(Deny|Rejecting…)$/ }));
    await waitFor(() => expect(resolvers.has('approval-a')).toBe(true));
    expect(screen.getByRole('button', { name: /^(Deny|Rejecting…)$/ })).toBeDisabled();

    act(() => useActivityStore.setState({ items: [{ ...approval, id: 'approval-b' }] }));
    fireEvent.click(screen.getByRole('button', { name: /^(Deny|Rejecting…)$/ }));
    await waitFor(() => expect(resolvers.has('approval-b')).toBe(true));

    act(() => useActivityStore.setState({ items: [approval] }));
    expect(screen.getByRole('button', { name: /^(Deny|Rejecting…)$/ })).toBeDisabled();
    act(() => useActivityStore.setState({ items: [{ ...approval, id: 'approval-b' }] }));
    expect(screen.getByRole('button', { name: /^(Deny|Rejecting…)$/ })).toBeDisabled();

    await act(async () => { resolvers.get('approval-a')?.(); });
    expect(screen.getByRole('button', { name: /^(Deny|Rejecting…)$/ })).toBeDisabled();
    await act(async () => { resolvers.get('approval-b')?.(); });
    await waitFor(() => expect(screen.getByRole('button', { name: /^(Deny|Rejecting…)$/ })).toBeEnabled());
  });
});
