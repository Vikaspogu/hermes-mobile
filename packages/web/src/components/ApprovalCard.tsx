import { useState } from 'react';
import { haptic } from '../pwa/haptics';
import type { Approval } from '@hermes-pwa/core';
import { Icon } from './Icon';

type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';

interface ApprovalCardProps {
  item: Approval;
  onRespond(id: string, choice: ApprovalChoice): void;
}

/** "2m ago" — matches the M4 inbox meta line. */
function timeAgo(createdAt: number): string {
  const s = Math.max(0, Math.round((Date.now() - createdAt) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ApprovalCard({ item, onRespond }: ApprovalCardProps) {
  const [submitting, setSubmitting] = useState<ApprovalChoice | null>(null);
  const busy = submitting !== null;
  const high = item.highImpact;

  function respond(choice: ApprovalChoice) {
    if (busy) return;
    haptic('confirm');
    setSubmitting(choice);
    onRespond(item.id, choice);
  }

  const meta = [item.session, timeAgo(item.createdAt)].filter(Boolean).join(' · ');

  return (
    <div
      className={high ? 'hm-card hm-inbox-card hm-inbox-card--high' : 'hm-card hm-inbox-card'}
      data-testid="approval-card"
    >
      <div className="hm-inbox-card__title">
        <span className="hm-inbox-card__tool">
          <Icon name="shield" size={14} />
          {item.title}
        </span>
        <span className={high ? 'hm-risk-tag hm-risk-tag--high' : 'hm-risk-tag hm-risk-tag--low'}>
          {high ? 'HIGH RISK' : 'LOW RISK'}
        </span>
      </div>
      <div className="hm-inbox-card__meta">{meta}</div>
      {item.summary && <div className="hm-inbox-card__cmd">{item.summary}</div>}
      {high ? (
        // M4: high-risk approvals are reviewed in chat, never approved blind from the inbox.
        <a
          className="hm-inbox-card__review"
          href={item.sessionId ? `#/chat?session=${encodeURIComponent(item.sessionId)}` : '#/chat'}
        >
          Open chat to review →
        </a>
      ) : (
        <div className="hm-inbox-card__row">
          <button
            type="button"
            className="hm-btn hm-btn--danger-outline"
            disabled={busy}
            onClick={() => respond('deny')}
            aria-label="Reject"
          >
            {submitting === 'deny' ? 'Rejecting…' : 'Reject'}
          </button>
          <button
            type="button"
            className="hm-btn hm-btn--primary"
            disabled={busy}
            onClick={() => respond('once')}
            aria-label="Approve once"
          >
            {submitting === 'once' ? 'Approving…' : 'Approve once'}
          </button>
        </div>
      )}
    </div>
  );
}
