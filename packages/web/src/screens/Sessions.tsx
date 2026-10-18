import { useEffect, useState } from 'react';
import {
  sessionCurrentSourceId,
  sessionHasDifferentCurrentSource,
  sessionSourceId,
  sessionSourceLabel,
  sessionSourceSearchTerms,
  useSessionsStore,
  useCronRunsStore,
  useCronStore,
  useChatStore,
  useProfilesStore,
  type RpcClient,
  type RestClient,
  type Session,
} from '@hermes-pwa/core';
import { Icon } from '../components/Icon';

interface SessionsProps {
  rpc: RpcClient;
  rest: RestClient;
  onSessionOpen: () => void;
}

type Filter = 'all' | 'live' | 'done' | 'archived';
type SourceFilter = 'all' | string;

interface SourceFilterOption {
  key: SourceFilter;
  label: string;
  count: number;
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'done', label: 'Done' },
  { key: 'archived', label: 'Archived' },
];

function fmtAge(updatedAt: number): string {
  const delta = Math.max(0, Date.now() - (updatedAt > 10_000_000_000 ? updatedAt : updatedAt * 1000));
  if (delta < 60_000) return 'now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}

function sessionTitle(s: Session): string {
  return s.title?.trim() || 'Untitled';
}

function sessionSourceKey(session: Pick<Session, 'source' | 'originSource'>): string {
  return sessionSourceId(session) ?? 'unknown';
}

function buildSourceFilterOptions(sessions: Session[]): SourceFilterOption[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const source = sessionSourceKey(session);
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  const sourceOptions = Array.from(counts.entries())
    .map(([key, count]) => ({ key, label: sessionSourceLabel(key) ?? 'Unknown', count }))
    .sort((a, b) => a.label.localeCompare(b.label));
  // Cron runs are frequent; keep them behind their own chip so "All" stays readable.
  const allCount = sessions.filter((s) => sessionSourceKey(s) !== 'cron').length;
  return [{ key: 'all', label: 'All sources', count: allCount }, ...sourceOptions];
}

function sessionSearchText(session: Session): string {
  const source = sessionSourceKey(session);
  const currentSource = sessionCurrentSourceId(session) ?? source;
  return [
    sessionTitle(session),
    session.profile ?? '',
    session.cwd ?? '',
    source,
    currentSource,
    ...sessionSourceSearchTerms(source),
    ...sessionSourceSearchTerms(currentSource),
  ]
    .join(' ')
    .toLowerCase();
}

function StatusDot({ session }: { session: Session }) {
  const isLive = session.isActive || session.active;
  const color = isLive ? 'var(--hm-color-running)' : 'var(--hm-color-text-faint)';
  return (
    <span
      className="hm-session-dot"
      style={{
        background: color,
        animation: isLive ? 'hm-pulse 1.8s infinite' : undefined,
      }}
      aria-hidden="true"
    />
  );
}

function SessionRow({
  session,
  acting,
  onSelect,
  onArchiveToggle,
  onDelete,
}: {
  session: Session;
  acting?: boolean;
  onSelect: (s: Session) => void | Promise<void>;
  onArchiveToggle: (s: Session) => void | Promise<void>;
  onDelete: (s: Session) => void | Promise<void>;
}) {
  const source = sessionSourceKey(session);
  const sourceLabel = sessionSourceLabel(source);
  const currentSource = sessionCurrentSourceId(session);
  const currentSourceLabel = currentSource ? sessionSourceLabel(currentSource) ?? currentSource : null;
  const meta = [
    session.profile,
    session.messageCount != null ? `${session.messageCount} msgs` : undefined,
    fmtAge(session.updatedAt),
  ].filter(Boolean);
  const archiveLabel = session.archived ? 'Restore session' : 'Archive session';

  return (
    <div className="hm-session-row" data-testid="session-row">
      <button className="hm-session-row__open" onClick={() => void onSelect(session)} aria-label={`Open session: ${sessionTitle(session)}`}>
        <StatusDot session={session} />
        <span className="hm-session-row__body">
          <span className="hm-session-row__title">{sessionTitle(session)}</span>
          {meta.length > 0 && (
            <span className="hm-session-row__meta">
              {sourceLabel ? <span className="hm-source-badge">{sourceLabel}</span> : null}
              {sessionHasDifferentCurrentSource(session) && currentSourceLabel ? (
                <span className="hm-source-badge hm-source-badge--secondary">Current: {currentSourceLabel}</span>
              ) : null}
              <span>{meta.join(' · ')}</span>
            </span>
          )}
        </span>
      </button>
      <div className="hm-session-row__actions" aria-label={`Actions for ${sessionTitle(session)}`}>
        <button
          type="button"
          className="hm-row-action"
          onClick={() => void onArchiveToggle(session)}
          disabled={acting}
          aria-label={`${archiveLabel}: ${sessionTitle(session)}`}
          title={archiveLabel}
        >
          <Icon name="archive" size={16} />
        </button>
        <button
          type="button"
          className="hm-row-action hm-row-action--danger"
          onClick={() => void onDelete(session)}
          disabled={acting}
          aria-label={`Delete session: ${sessionTitle(session)}`}
          title="Delete session"
        >
          <Icon name="trash" size={16} />
        </button>
      </div>
    </div>
  );
}

export function Sessions({ rpc, rest, onSessionOpen }: SessionsProps) {
  const { sessions, loading, error, load, archive: archiveSession, delete: deleteSession, showCronInAll } = useSessionsStore();
  const activeName = useProfilesStore((s) => s.activeName);
  const [filter, setFilter] = useState<Filter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [search, setSearch] = useState('');
  const [actingId, setActingId] = useState<string | undefined>();

  const cronRuns = useCronRunsStore();
  const cronJobs = useCronStore((s) => s.jobs);
  const cronMode = sourceFilter === 'cron';

  useEffect(() => {
    void load(rest);
  }, [rest, load]);

  useEffect(() => {
    if (!cronMode) return;
    void useCronRunsStore.getState().load(rest);
    if (useCronStore.getState().jobs.length === 0) void useCronStore.getState().loadJobs(rest);
  }, [cronMode, rest]);

  async function handleSelect(session: Session) {
    await useChatStore.getState().resumeSessionIntoChat(rest, rpc, session.id, session.profile ?? activeName);
    onSessionOpen();
  }

  async function handleArchiveToggle(session: Session) {
    const nextArchived = !session.archived;
    if (nextArchived) {
      const confirmed = window.confirm(`Archive session "${sessionTitle(session)}"? It will move to the Archived filter.`);
      if (!confirmed) return;
    }
    setActingId(session.id);
    try {
      await archiveSession(rest, session, nextArchived);
    } finally {
      setActingId(undefined);
    }
  }

  async function handleDelete(session: Session) {
    const confirmed = window.confirm(`Delete session "${sessionTitle(session)}"? This removes it from the session database.`);
    if (!confirmed) return;
    setActingId(session.id);
    try {
      await deleteSession(rest, session);
    } finally {
      setActingId(undefined);
    }
  }

  const sourceOptions = buildSourceFilterOptions(sessions);

  const baseList = cronMode ? cronRuns.runs : sessions;
  const filtered = baseList
    .filter((s) => {
      if (filter === 'live') return s.isActive || s.active;
      if (filter === 'done') return !s.isActive && !s.active && !s.archived;
      if (filter === 'archived') return s.archived;
      return true;
    })
    .filter((s) => (cronMode ? true : sourceFilter === 'all' ? showCronInAll || sessionSourceKey(s) !== 'cron' : sessionSourceKey(s) === sourceFilter));

  const searched = search.trim()
    ? filtered.filter((s) => sessionSearchText(s).includes(search.toLowerCase()))
    : filtered;

  // Stats
  const live = sessions.filter((s) => s.isActive || s.active).length;
  const total = sessions.length;
  const totalMsgs = sessions.reduce((n, s) => n + (s.messageCount ?? 0), 0);
  const statsLine = [
    `${total} session${total !== 1 ? 's' : ''}`,
    live > 0 ? `${live} live` : '',
    totalMsgs > 0 ? `${totalMsgs} msgs` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="hm-sessions">
      <div className="hm-sessions__search-row">
        <input
          className="hm-input hm-sessions__search"
          placeholder="Search sessions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search sessions"
        />
      </div>

      <div className="hm-sessions__filters" role="tablist" aria-label="Session filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`hm-filter-chip${filter === f.key ? ' hm-filter-chip--active' : ''}`}
            onClick={() => setFilter(f.key)}
            role="tab"
            aria-selected={filter === f.key}
          >
            {f.label}
          </button>
        ))}
      </div>

      {sourceOptions.length > 1 && (
        <div className="hm-sessions__filters hm-sessions__source-filters" role="tablist" aria-label="Session source filters">
          {sourceOptions.map((option) => (
            <button
              key={option.key}
              className={`hm-filter-chip${sourceFilter === option.key ? ' hm-filter-chip--active' : ''}`}
              onClick={() => setSourceFilter(option.key)}
              role="tab"
              aria-selected={sourceFilter === option.key}
            >
              {option.label}
              <span className="hm-filter-chip__count">{option.count}</span>
            </button>
          ))}
        </div>
      )}

      {cronMode && (
        <div className="hm-sessions__cron-controls">
          <select
            className="hm-input hm-sessions__cron-job"
            aria-label="Filter cron runs by job"
            value={cronRuns.jobId ?? ''}
            onChange={(e) => void cronRuns.load(rest, { jobId: e.target.value || undefined })}
          >
            <option value="">All jobs</option>
            {cronJobs.map((j) => (
              <option key={j.id} value={j.id}>{j.name || j.id}</option>
            ))}
          </select>
          <label className="hm-sessions__cron-silent">
            <input
              type="checkbox"
              checked={cronRuns.includeSilent}
              onChange={(e) => void cronRuns.load(rest, { includeSilent: e.target.checked })}
            />
            Show silent
          </label>
        </div>
      )}

      {total > 0 && (
        <p className="hm-sessions__stats">{statsLine}</p>
      )}

      {(cronMode ? cronRuns.error : error) && (
        <div className="hm-warning-banner hm-warning-banner--error">{cronMode ? cronRuns.error : error}</div>
      )}
      {(cronMode ? cronRuns.loading && cronRuns.runs.length === 0 : loading && sessions.length === 0) && (
        <p className="hm-muted hm-loading">Loading…</p>
      )}

      {searched.length === 0 && !(cronMode ? cronRuns.loading : loading) ? (
        <div className="hm-empty-state">
          <p>{search ? 'No matching sessions' : 'No sessions yet'}</p>
          <p className="hm-muted">Start a chat to create your first session.</p>
        </div>
      ) : (
        <div className="hm-sessions__list">
          {searched.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              acting={actingId === s.id}
              onSelect={handleSelect}
              onArchiveToggle={handleArchiveToggle}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {cronMode && cronRuns.nextCursor != null && (
        <button
          className="hm-filter-chip hm-sessions__load-more"
          disabled={cronRuns.loading}
          onClick={() => void cronRuns.loadMore(rest)}
        >
          {cronRuns.loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
