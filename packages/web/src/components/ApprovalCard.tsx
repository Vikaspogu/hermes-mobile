import { useState } from 'react';
import { haptic } from '../pwa/haptics';
import type { Approval } from '@hermes-pwa/core';
import { Icon } from './Icon';

type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';

interface ApprovalCardProps {
  item: Approval;
  onRespond(id: string, choice: ApprovalChoice): Promise<void> | void;
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

  async function respond(choice: ApprovalChoice) {
    if (busy) return;
    haptic('confirm');
    setSubmitting(choice);
    try {
      await onRespond(item.id, choice);
    } catch {
      setSubmitting(null);
    }
  }

  const meta = [item.session, timeAgo(item.createdAt)].filter(Boolean).join(' · ');
  const threadId = item.sourceSessionId;

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
        // M4: high-risk approvals are reviewed in their originating chat,
        // never approved blind from the inbox. A recovered queue-only item
        // can still be rejected without guessing which thread opened it.
        <>
          {threadId ? (
            <a
              className="hm-inbox-card__review"
              href={`#/chat?session=${encodeURIComponent(threadId)}`}
            >
              Open chat to review →
            </a>
          ) : (
            <>
              <span className="hm-inbox-card__review">
                Thread context unavailable
              </span>
              <button
                type="button"
                className="hm-btn hm-btn--danger-outline"
                disabled={busy}
                onClick={() => void respond('deny')}
                aria-label="Reject"
              >
                {submitting === 'deny' ? 'Rejecting…' : 'Reject'}
              </button>
            </>
          )}
        </>
      ) : (
        <div className="hm-inbox-card__row">
          <button
            type="button"
            className="hm-btn hm-btn--danger-outline"
            disabled={busy}
            onClick={() => void respond('deny')}
            aria-label="Reject"
          >
            {submitting === 'deny' ? 'Rejecting…' : 'Reject'}
          </button>
          <button
            type="button"
            className="hm-btn hm-btn--primary"
            disabled={busy}
            onClick={() => void respond('once')}
            aria-label="Approve once"
          >
            {submitting === 'once' ? 'Approving…' : 'Approve once'}
          </button>
        </div>
      )}
    </div>
  );
}
