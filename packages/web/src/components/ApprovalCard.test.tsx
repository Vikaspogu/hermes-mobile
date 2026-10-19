import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApprovalCard } from './ApprovalCard';

describe('ApprovalCard', () => {
  it('renders tool name and command', () => {
    render(
      <ApprovalCard
        item={{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'shell.exec', summary: 'git commit', highImpact: false, visibility: 'private', createdAt: 1 }}
        onRespond={vi.fn()}
      />
    );
    expect(screen.getByText('shell.exec')).toBeInTheDocument();
    expect(screen.getByText('git commit')).toBeInTheDocument();
  });

  it('shows low risk badge by default', () => {
    render(
      <ApprovalCard
        item={{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'shell.exec', summary: 'git commit', highImpact: false, visibility: 'private', createdAt: 1 }}
        onRespond={vi.fn()}
      />
    );
    expect(screen.getByText('LOW RISK')).toBeInTheDocument();
  });

  it('shows high risk badge for high-impact items', () => {
    render(
      <ApprovalCard
        item={{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'fs.write', summary: 'write secrets', highImpact: true, visibility: 'private', createdAt: 1 }}
        onRespond={vi.fn()}
      />
    );
    expect(screen.getByText('HIGH RISK')).toBeInTheDocument();
  });

  it('responds with once on Approve', () => {
    const onRespond = vi.fn();
    render(
      <ApprovalCard
        item={{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'Deploy', highImpact: false, visibility: 'private', createdAt: 1 }}
        onRespond={onRespond}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/i }));
    expect(onRespond).toHaveBeenCalledWith('a-1', 'once');
  });

  it('responds with deny on Deny', () => {
    const onRespond = vi.fn();
    render(
      <ApprovalCard
        item={{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'Deploy', highImpact: false, visibility: 'private', createdAt: 1 }}
        onRespond={onRespond}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^Deny$/i }));
    expect(onRespond).toHaveBeenCalledWith('a-1', 'deny');
  });

  it('responds with session scope without confirming', () => {
    const onRespond = vi.fn();
    render(
      <ApprovalCard
        item={{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'Deploy', highImpact: false, visibility: 'private', createdAt: 1 }}
        onRespond={onRespond}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /session/i }));
    expect(onRespond).toHaveBeenCalledWith('a-1', 'session');
  });

  it('confirms before always scope', () => {
    const onRespond = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <ApprovalCard
        item={{ id: 'a-1', kind: 'approval', status: 'needs_you', title: 'Deploy', highImpact: false, visibility: 'private', createdAt: 1 }}
        onRespond={onRespond}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /always/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onRespond).toHaveBeenCalledWith('a-1', 'always');
    confirmSpy.mockRestore();
  });
});
