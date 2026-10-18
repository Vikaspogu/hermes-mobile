import { useEffect, useState } from 'react';
import { useActivityStore, useConnectionStore, usePaperlessStore } from '@hermes-pwa/core';
import type { ActionItem, Approval, Clarify, RestClient, RpcClient } from '@hermes-pwa/core';
import { ApprovalCard } from '../components/ApprovalCard';
import { ClarifyCard } from '../components/ClarifyCard';

interface ActivityProps {
  rpc: RpcClient;
  rest?: RestClient;
}

const PAPERLESS_STATUS: Record<string, string> = {
  ready: 'Ready to import',
  needs_retry: 'Download failed',
  needs_review: 'Needs manual review',
};

/** Paperless PDF triage approval posted by the email-pdf-triage cron. */
function PaperlessCard({ rest }: { rest: RestClient }) {
  const { pending, busy, error, result, load, decide } = usePaperlessStore();
  const [picked, setPicked] = useState<number[]>([]);

  useEffect(() => {
    void load(rest);
  }, [rest, load]);

  if (!pending) return result ? <p className="hm-muted">{result}</p> : null;
  const toggle = (n: number) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));

  return (
    <div className="hm-approval-card" data-testid="paperless-card">
      <div className="hm-approval-card__header">
        <span className="hm-approval-card__tool">Paperless import</span>
      </div>
      <div className="hm-approval-card__body">
        <ul className="hm-paperless__list">
          {pending.candidates.map((c) => (
            <li key={c.number}>
              <label className="hm-paperless__row">
                <input
                  type="checkbox"
                  disabled={c.status !== 'ready' || busy}
                  checked={picked.includes(c.number)}
                  onChange={() => toggle(c.number)}
                />
                <span>
                  {c.title}
                  <span className="hm-muted"> · {PAPERLESS_STATUS[c.status] ?? c.status}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {error && <div className="hm-warning-banner hm-warning-banner--error">{error}</div>}
        <div className="hm-approval-card__actions">
          <button
            type="button"
            className="hm-approval-card__approve"
            disabled={busy || picked.length === 0}
            onClick={() => void decide(rest, 'approve', picked)}
          >
            Import selected
          </button>
          <button
            type="button"
            className="hm-approval-card__deny"
            disabled={busy}
            onClick={() => void decide(rest, 'discard')}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}

function isApproval(item: ActionItem): item is Approval {
  return item.kind === 'approval';
}

function isClarify(item: ActionItem): item is Clarify {
  return item.kind === 'clarify';
}

export function Activity({ rpc, rest }: ActivityProps) {
  const { items, loading, error, respondApproval, respondClarify } = useActivityStore();
  const paperlessPending = usePaperlessStore((s) => s.pending);
  const connection = useConnectionStore();

  if (connection.state === 'init' || connection.state === 'login' || connection.state === 'offline') {
    return (
      <div className="hm-empty-state">
        <p>Connecting to Hermes…</p>
        <p className="hm-muted">{connection.error ?? 'Please wait.'}</p>
      </div>
    );
  }

  return (
    <div className="hm-activity">
      <p className="hm-activity__lead">
        Actions the agent paused on. Respond here or from the live chat —{' '}
        <span className="hm-activity__code">approval.respond</span> over WS.
      </p>

      {error && <div className="hm-warning-banner hm-warning-banner--error">{error}</div>}

      {loading && items.length === 0 && <p className="hm-muted hm-loading">Loading…</p>}

      {rest && <PaperlessCard rest={rest} />}

      {items.length === 0 && !loading && !paperlessPending ? (
        <div className="hm-empty-state">
          <div className="hm-empty-state__icon">
            <span>✓</span>
          </div>
          <p>All clear</p>
          <p className="hm-muted">No actions waiting on you.</p>
        </div>
      ) : (
        <div className="hm-activity__list">
          {items.map((item) => (
            <div key={item.id} className="hm-activity__item">
              {isApproval(item) && (
                <ApprovalCard
                  item={item}
                  onApprove={(id) => void respondApproval(rpc, id, 'approve', item.sessionId)}
                  onReject={(id) => void respondApproval(rpc, id, 'reject', item.sessionId)}
                />
              )}
              {isClarify(item) && (
                <ClarifyCard
                  item={item}
                  onRespond={(id, answer) => void respondClarify(rpc, id, answer)}
                />
              )}
              {!isApproval(item) && !isClarify(item) && (
                <div className="hm-card">
                  <h3 className="hm-card__title">{item.title}</h3>
                  {item.summary && <p className="hm-muted">{item.summary}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
