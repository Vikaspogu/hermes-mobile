import { useState } from 'react';
import { haptic } from '../pwa/haptics';
import type { Approval, RpcClient } from '@hermes-pwa/core';
import { useActivityStore } from '@hermes-pwa/core';
import { SlideToApprove } from './SlideToApprove';

// M2/M3 mockup: the approval pinned above the composer. Low risk gets
// Reject / Approve once / ⋯ (Session, Always); high risk gets Reject plus
// slide-to-approve — no tap button for destructive actions.
type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';

interface ApprovalDockProps {
  rpc: RpcClient;
  approval: Approval;
  sessionTitle?: string | undefined;
  cwd?: string | undefined;
  fallbackSessionId?: string | undefined;
  onResolved?: (approval: Approval, decision: 'approve' | 'reject') => void;
}

function shortenHome(path: string): string {
  return path.replace(/^\/home\/[^/]+/, '~');
}

export function ApprovalDock({ rpc, approval, sessionTitle, cwd, fallbackSessionId, onResolved }: ApprovalDockProps) {
  const respondApproval = useActivityStore((s) => s.respondApproval);
  const [submitting, setSubmitting] = useState<ApprovalChoice | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const busy = submitting !== null;
  const high = approval.highImpact;
  const meta = [approval.session ?? sessionTitle, cwd ? shortenHome(cwd) : undefined]
    .filter(Boolean)
    .join(' · ');

  async function respond(choice: ApprovalChoice) {
    if (busy) return;
    if (choice === 'always') {
      const ok = window.confirm(
        'Always allow this approval pattern? This is persistent and can affect future Hermes actions.',
      );
      if (!ok) return;
    }
    haptic('confirm');
    setSubmitting(choice);
    setMoreOpen(false);
    try {
      await respondApproval(
        rpc,
        approval.id,
        choice === 'deny' ? 'reject' : 'approve',
        approval.sessionId ?? fallbackSessionId,
        choice,
      );
      onResolved?.(approval, choice === 'deny' ? 'reject' : 'approve');
    } catch {
      setSubmitting(null);
    }
  }

  return (
    <div className={`hm-approval-dock${high ? ' hm-approval-dock--high' : ''}`}>
      <div className="hm-approval-dock__title">
        <span className={high ? 'hm-approval-dock__title-text hm-approval-dock__title-text--high' : 'hm-approval-dock__title-text'}>
          🛡 {approval.title} · waiting for you
        </span>
        <span className={`hm-risk-tag ${high ? 'hm-risk-tag--high' : 'hm-risk-tag--low'}`}>
          {high ? 'HIGH RISK' : 'LOW RISK'}
        </span>
      </div>
      {meta && <div className="hm-approval-dock__meta">{meta}</div>}
      {approval.summary && <div className="hm-approval-dock__cmd">{approval.summary}</div>}
      <div className="hm-approval-dock__row">
        <button
          type="button"
          className="hm-btn hm-btn--danger-outline"
          disabled={busy}
          onClick={() => void respond('deny')}
        >
          Reject
        </button>
        {high ? (
          <SlideToApprove disabled={busy} onConfirm={() => void respond('once')} />
        ) : (
          <>
            <button
              type="button"
              className="hm-btn hm-btn--primary"
              disabled={busy}
              onClick={() => void respond('once')}
            >
              Approve once
            </button>
            <div className="hm-approval-dock__more">
              <button
                type="button"
                className="hm-btn hm-btn--ghost hm-approval-dock__more-btn"
                aria-label="More approval options"
                aria-expanded={moreOpen}
                disabled={busy}
                onClick={() => setMoreOpen((v) => !v)}
              >
                ⋯
              </button>
              {moreOpen && (
                <div className="hm-approval-dock__menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => void respond('session')}>
                    Approve for session
                  </button>
                  <button type="button" role="menuitem" onClick={() => void respond('always')}>
                    Always allow
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
