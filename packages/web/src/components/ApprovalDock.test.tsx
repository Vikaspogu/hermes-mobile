import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useActivityStore, type Approval, type RpcClient } from '@hermes-pwa/core';
import { ApprovalDock } from './ApprovalDock';

const rpc = {} as RpcClient;
const approval: Approval = {
  id: 'approval-a',
  kind: 'approval',
  status: 'needs_you',
  title: 'shell.exec',
  summary: 'git push',
  highImpact: true,
  visibility: 'private',
  createdAt: Date.now(),
};

describe('ApprovalDock', () => {
  it('resets slide progress when the pending approval changes', () => {
    useActivityStore.setState({ respondApproval: vi.fn() });
    const { rerender } = render(<ApprovalDock rpc={rpc} approval={approval} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Slide to approve' }), { key: 'End' });
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '90');

    rerender(<ApprovalDock rpc={rpc} approval={{ ...approval, id: 'approval-b' }} />);

    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '0');
  });
  it('enables the next approval after the previous approval succeeds', async () => {
    const respondApproval = vi.fn().mockResolvedValue(undefined);
    useActivityStore.setState({ respondApproval });
    const { rerender } = render(<ApprovalDock rpc={rpc} approval={approval} />);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    await waitFor(() => expect(respondApproval).toHaveBeenCalled());

    rerender(<ApprovalDock rpc={rpc} approval={{ ...approval, id: 'approval-b' }} />);

    expect(screen.getByRole('slider')).not.toHaveAttribute('aria-disabled');
  });

  it('re-enables Reject after a failed response', async () => {
    useActivityStore.setState({ respondApproval: vi.fn().mockRejectedValue(new Error('offline')) });
    render(<ApprovalDock rpc={rpc} approval={approval} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled());
  });
});
