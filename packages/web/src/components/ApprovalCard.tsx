import { useState } from 'react';
import type { Approval } from '@hermes-pwa/core';
import { Icon } from './Icon';

type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';

interface ApprovalCardProps {
  item: Approval;
  onRespond(id: string, choice: ApprovalChoice): void;
}

export function ApprovalCard({ item, onRespond }: ApprovalCardProps) {
  const [submitting, setSubmitting] = useState<ApprovalChoice | null>(null);
  const isHighImpact = item.highImpact;
  const riskLabel = isHighImpact ? 'HIGH RISK' : 'LOW RISK';
  const riskColor = isHighImpact ? 'var(--hm-color-danger-strong)' : 'var(--hm-color-success-strong)';
  const riskBg = isHighImpact ? 'var(--hm-color-danger-bg)' : 'var(--hm-color-success-bg)';
  const busy = submitting !== null;

  function respond(choice: ApprovalChoice) {
    if (busy) return;
    if (choice === 'always') {
      const ok = window.confirm(
        'Always allow this approval pattern? This is persistent and can affect future Hermes actions.',
      );
      if (!ok) return;
    }
    setSubmitting(choice);
    onRespond(item.id, choice);
  }

  return (
    <div className="hm-approval-card" data-testid="approval-card">
      <div className="hm-approval-card__header">
        <span className="hm-approval-card__shield" aria-hidden="true">
          <Icon name="shield" size={16} />
        </span>
        <span className="hm-approval-card__tool">{item.title}</span>
        <span
          className="hm-approval-card__risk"
          style={{ background: riskBg, color: riskColor }}
        >
          {riskLabel}
        </span>
      </div>

      <div className="hm-approval-card__body">
        {item.session && (
          <div className="hm-approval-card__session">{item.session}</div>
        )}
        {item.summary && (
          <div className="hm-approval-card__cmd">{item.summary}</div>
        )}
        <div className="hm-approval-card__actions">
          <button
            type="button"
            className="hm-approval-card__approve"
            disabled={busy}
            onClick={() => respond('once')}
            aria-label="Approve"
          >
            {submitting === 'once' ? 'Approving…' : 'Approve'}
          </button>
          <button
            type="button"
            className="hm-approval-card__deny"
            disabled={busy}
            onClick={() => respond('deny')}
            aria-label="Deny"
          >
            {submitting === 'deny' ? 'Rejecting…' : 'Deny'}
          </button>
          <button
            type="button"
            className="hm-approval-card__scope"
            disabled={busy}
            onClick={() => respond('session')}
            aria-label="Allow for this session"
          >
            {submitting === 'session' ? 'Allowing…' : 'Session'}
          </button>
          <button
            type="button"
            className="hm-approval-card__scope"
            disabled={busy}
            onClick={() => respond('always')}
            aria-label="Always allow"
          >
            {submitting === 'always' ? 'Allowing…' : 'Always'}
          </button>
        </div>
      </div>
    </div>
  );
}
