import { useEffect, useState } from 'react';
import { useActivityStore, useConnectionStore, usePaperlessStore } from '@hermes-pwa/core';
import type { ActionItem, Approval, Clarify, RestClient, RpcClient } from '@hermes-pwa/core';
import { ApprovalCard } from '../components/ApprovalCard';
import { ClarifyCard } from '../components/ClarifyCard';
// ponytail: prototype.css's trailing @import of screens/*.css is dropped by Vite
import '../styles/screens/inbox.css';
import '../styles/approval-loading.css';

interface ApprovalsScreenProps {
  rpc: RpcClient;
  rest?: RestClient;
}

const PAPERLESS_STATUS: Record<string, string> = {
  ready: 'Ready to import',
  needs_retry: 'Download failed',
  needs_review: 'Needs manual review',
};

function hasActionablePaperless(
  pending: ReturnType<typeof usePaperlessStore.getState>['pending'],
): pending is NonNullable<typeof pending> {
  return Boolean(pending && pending.candidates.length > 0);
}
/** Paperless PDF triage approval posted by the email-pdf-triage cron. */
function PaperlessCard({ rest, visible }: { rest: RestClient; visible: boolean }) {
  const { pending, busy, error, result, load, decide } = usePaperlessStore();
  const [picked, setPicked] = useState<number[]>([]);

  useEffect(() => {
    void load(rest);
  }, [rest, load]);

  if (!visible) return null;
  // an empty candidate list is not actionable — hide the card entirely
  if (!hasActionablePaperless(pending)) return result ? <p className="hm-muted">{result}</p> : null;
  const toggle = (n: number) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));

  return (
    <div className="hm-card hm-inbox-card" data-testid="paperless-card">
      <div className="hm-inbox-card__title">
        <span className="hm-inbox-card__tool">Paperless import</span>
      </div>
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
      <div className="hm-inbox-card__row">
        <button
          type="button"
          className="hm-btn hm-btn--primary"
          disabled={busy || picked.length === 0}
          onClick={() => void decide(rest, 'approve', picked)}
        >
          Import selected
        </button>
        <button
          type="button"
          className="hm-btn hm-btn--danger-outline"
          disabled={busy}
          onClick={() => void decide(rest, 'discard')}
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function isHighRisk(item: ActionItem): boolean {
  return isApproval(item) && item.highImpact;
}

function isApproval(item: ActionItem): item is Approval {
  return item.kind === 'approval';
}

function isClarify(item: ActionItem): item is Clarify {
  return item.kind === 'clarify';
}

/** Compact "1h" — matches the M4 notice right column. */
function fmtAgeShort(createdAt: number): string {
  const s = Math.max(0, Math.round((Date.now() - createdAt) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** M4 notice row — run/system activity items (✓ done, ✕ needs attention). */
function NoticeRow({ item }: { item: ActionItem }) {
  const tone = item.status === 'completed' ? 'success' : item.status === 'needs_you' ? 'danger' : undefined;
  const glyph = tone === 'success' ? '✓' : tone === 'danger' ? '✕' : '●';
  return (
    <div className="hm-notice" data-testid="notice-row">
      <div
        className={tone ? `hm-notice__icon hm-notice__icon--${tone}` : 'hm-notice__icon'}
        aria-hidden="true"
      >
        {glyph}
      </div>
      <div className="hm-notice__body">
        <div className="hm-notice__title">{item.title}</div>
        {item.summary && <div className="hm-notice__sub">{item.summary}</div>}
      </div>
      <span className="hm-notice__time">{fmtAgeShort(item.createdAt)}</span>
    </div>
  );
}

export function ApprovalsScreen({ rpc, rest }: ApprovalsScreenProps) {
  const { items, loading, error, respondApproval, respondClarify } = useActivityStore();
  const paperlessPending = usePaperlessStore((s) => s.pending);
  const connection = useConnectionStore();
  const [filter, setFilter] = useState<'all' | 'high' | 'low' | 'notices'>('all');

  if (connection.state === 'init' || connection.state === 'login' || connection.state === 'offline') {
    return (
      <div className="hm-empty-state">
        <h1 className="hm-sr-only">Inbox</h1>
        <p>Connecting to Hermes…</p>
        <p className="hm-muted">{connection.error ?? 'Please wait.'}</p>
      </div>
    );
  }

  const needsYou = items.filter((i) => (isApproval(i) || isClarify(i)) && i.status === 'needs_you');
  const notices = items.filter((i) => !isApproval(i) && !isClarify(i));
  const hasPaperless = Boolean(rest && hasActionablePaperless(paperlessPending));
  const isEmpty = needsYou.length === 0 && notices.length === 0 && !hasPaperless;
  const visibleNeedsYou = filter === 'notices' ? [] : needsYou.filter((item) => filter === 'all' || (filter === 'high' ? isHighRisk(item) : !isHighRisk(item)));
  const visibleNotices = filter === 'all' || filter === 'notices' ? notices : [];
  const paperlessVisible = filter === 'all' || filter === 'low';
  const showPaperless = hasPaperless && paperlessVisible;

  return (
    <div className="hm-inbox hm-scroll">
      {error && <div className="hm-warning-banner hm-warning-banner--error">{error}</div>}

      <div className="hm-o2-pagehead">
        <div>
          <h1>Inbox</h1>
          <p>Deliberate confirmation for high-impact tools</p>
        </div>
        {needsYou.length > 0 && <span className="hm-badge hm-badge--warn">{needsYou.length} needs you</span>}
      </div>
      <div className="hm-chips" role="group" aria-label="Filter inbox">
        {([
          ['all', `All ${needsYou.length + notices.length + Number(hasPaperless)}`],
          ['high', `High risk ${needsYou.filter((item) => isHighRisk(item)).length}`],
          ['low', `Low risk ${needsYou.filter((item) => !isHighRisk(item)).length + Number(hasPaperless)}`],
          ['notices', `Notices ${notices.length}`],
        ] as const).map(([value, label]) => (
          <button key={value} type="button" className={`hm-chip${filter === value ? ' active' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>


      {loading && isEmpty && (
        <div className="hm-inbox__loading" role="status" aria-label="Loading approvals">
          <span className="hm-inbox__skeleton" aria-hidden="true" />
          <span className="hm-inbox__skeleton" aria-hidden="true" />
          <span className="hm-inbox__skeleton" aria-hidden="true" />
        </div>
      )}

      {rest && <PaperlessCard rest={rest} visible={paperlessVisible} />}

      {visibleNeedsYou.length > 0 && (
        <section className="hm-inbox-group" aria-label="Needs you">
          <div className="hm-group-label">Needs you · {visibleNeedsYou.length}</div>
          {visibleNeedsYou.map((item) =>
            isClarify(item) ? (
              <ClarifyCard key={item.id} item={item} onRespond={(id, answer) => void respondClarify(rpc, id, answer)} />
            ) : isApproval(item) ? (
              <ApprovalCard
                key={item.id}
                item={item}
                onRespond={(id, choice) =>
                  respondApproval(rpc, id, choice === 'deny' ? 'reject' : 'approve', item.sessionId, choice)
                }
              />
            ) : null,
          )}
        </section>
      )}

      {visibleNotices.length > 0 && (
        <section className="hm-inbox-group" aria-label="Notices">
          <div className="hm-group-label hm-qp-sec__head">
            <span className="hm-qp-sec__kicker">Notices</span>
            <span className="hm-qp-sec__meta">{visibleNotices.length}</span>
          </div>
          {visibleNotices.map((item) => (
            <NoticeRow key={item.id} item={item} />
          ))}
        </section>
      )}

      {!loading && !isEmpty && visibleNeedsYou.length === 0 && visibleNotices.length === 0 && !showPaperless && (
        <div className="hm-empty-state"><p>No items match this filter.</p></div>
      )}
      {!loading && isEmpty && (
        <div className="hm-empty-state">
          <div className="hm-empty-state__icon">
            <span>✓</span>
          </div>
          <p>There&apos;s nothing in the inbox</p>
          <p className="hm-muted">No actions waiting on you.</p>
        </div>
      )}
    </div>
  );
}
