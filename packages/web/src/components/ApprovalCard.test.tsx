import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApprovalCard } from './ApprovalCard';

const baseItem = {
  id: 'a-1',
  kind: 'approval' as const,
  status: 'needs_you' as const,
  title: 'shell.exec',
  summary: 'git commit',
  session: 'Refactor WS gateway reconnect',
  highImpact: false,
  visibility: 'private' as const,
  createdAt: Date.now() - 2 * 60_000,
};

describe('ApprovalCard', () => {
  it('renders tool name, session meta, and command chip', () => {
    render(<ApprovalCard item={baseItem} onRespond={vi.fn()} />);
    expect(screen.getByText('shell.exec')).toBeInTheDocument();
    expect(screen.getByText(/Refactor WS gateway reconnect · 2m ago/)).toBeInTheDocument();
    expect(screen.getByText('git commit')).toBeInTheDocument();
  });

  it('shows low risk badge by default', () => {
    render(<ApprovalCard item={baseItem} onRespond={vi.fn()} />);
    expect(screen.getByText('LOW RISK')).toBeInTheDocument();
  });

  it('shows high risk badge for high-impact items', () => {
    render(<ApprovalCard item={{ ...baseItem, highImpact: true }} onRespond={vi.fn()} />);
    expect(screen.getByText('HIGH RISK')).toBeInTheDocument();
  });

  it('low risk: Reject responds with deny', () => {
    const onRespond = vi.fn();
    render(<ApprovalCard item={baseItem} onRespond={onRespond} />);
    fireEvent.click(screen.getByRole('button', { name: /^Reject$/i }));
    expect(onRespond).toHaveBeenCalledWith('a-1', 'deny');
  });

  it('low risk: Approve once responds with once', () => {
    const onRespond = vi.fn();
    render(<ApprovalCard item={baseItem} onRespond={onRespond} />);
    fireEvent.click(screen.getByRole('button', { name: /^Approve once$/i }));
    expect(onRespond).toHaveBeenCalledWith('a-1', 'once');
  });

  it('high risk: never treats the approval queue ID as a chat thread', () => {
    const onRespond = vi.fn();
    render(
      <ApprovalCard item={{ ...baseItem, highImpact: true, sessionId: 'queue-key' }} onRespond={onRespond} />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onRespond).toHaveBeenCalledWith('a-1', 'deny');
  });
  it('high risk: prefers the durable source thread over the approval queue ID', () => {
    render(
      <ApprovalCard
        item={{ ...baseItem, highImpact: true, sessionId: 'queue-key', sourceSessionId: 'thread-1' }}
        onRespond={vi.fn()}
      />,
    );

    expect(screen.getByRole('link', { name: /Open chat to review/i })).toHaveAttribute(
      'href',
      '#/chat?session=thread-1',
    );
  });
  it('high risk: explains when the originating thread is unavailable', () => {
    render(<ApprovalCard item={{ ...baseItem, highImpact: true }} onRespond={vi.fn()} />);
    expect(screen.getByText('Thread context unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });
});
