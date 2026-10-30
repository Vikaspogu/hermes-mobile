import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  useActivityStore,
  useConnectionStore,
  useSessionsStore,
  useProfilesStore,
  useChatStore,
  sessionSourceId,
  sessionSourceLabel,
  type Approval,
  type Session,
  type RpcClient,
  type RestClient,
} from '@hermes-pwa/core';
import { Icon } from '../components/Icon';
import { BrandMark } from '../components/BrandMark';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { usePullToRefresh } from '../components/usePullToRefresh';
// ponytail: prototype.css's trailing @import of screens/*.css is dropped by Vite
// (spec: @import must lead the file), so the screen pulls its own styles.
import '../styles/screens/home.css';

interface ChatsProps {
  rpc: RpcClient;
  rest: RestClient;
  onNavigate: (screen: string) => void;
  /** Desktop split sidebar: hides composer + approval banner, slim thread list. */
  sidebar?: boolean;
  /** Opens the voice overlay from the composer mic (main pane only). */
  onOpenVoice?: () => void;
  onRetry?: (() => void) | undefined;
}

/** updated_at arrives as Unix seconds; accept ms too. */
function toMs(updatedAt: number): number {
  return updatedAt > 10_000_000_000 ? updatedAt : updatedAt * 1000;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isToday(ms: number): boolean {
  return sameDay(new Date(ms), new Date());
}

function isYesterday(ms: number): boolean {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return sameDay(new Date(ms), yesterday);
}

/** M1 meta: clock time for today's threads, "Nd" for older ones. */
function fmtAge(updatedAt: number): string {
  const ms = toMs(updatedAt);
  if (isToday(ms)) {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${Math.max(1, Math.floor((Date.now() - ms) / 86_400_000))}d`;
}

function isLive(s: Session): boolean {
  return Boolean(s.isActive || s.active);
}

function freshness(s: Session): number {
  return Math.max(s.lastActive ?? 0, s.updatedAt ?? 0, s.startedAt ?? 0);
}

interface ThreadGroup {
  key: 'today' | 'yesterday' | 'earlier';
  label: string;
  items: Session[];
}

export function groupThreads(sessions: Session[]): ThreadGroup[] {
  const sorted = [...sessions].sort((a, b) => freshness(b) - freshness(a));
  const today = sorted.filter((s) => isToday(toMs(freshness(s))));
  const yesterday = sorted.filter(
    (s) => !isToday(toMs(freshness(s))) && isYesterday(toMs(freshness(s))),
  );
  const earlier = sorted.filter(
    (s) => !isToday(toMs(freshness(s))) && !isYesterday(toMs(freshness(s))),
  );
  const groups: ThreadGroup[] = [
    { key: 'today', label: 'Today', items: today },
    { key: 'yesterday', label: 'Yesterday', items: yesterday },
    { key: 'earlier', label: 'Earlier', items: earlier },
  ];
  return groups.filter((g) => g.items.length > 0);
}

export function Chats({ rpc, rest, onNavigate, sidebar, onRetry }: ChatsProps) {
  const { sessions, load } = useSessionsStore();
  const activeName = useProfilesStore((s) => s.activeName);
  const { startNewSession, resumeSessionIntoChat } = useChatStore();
  const pendingApprovals = useActivityStore(
    (s) => s.items.filter((i) => i.kind === 'approval' && i.status === 'needs_you').length,
  );
  const firstPendingSession = useActivityStore(
    (s) =>
      s.items.find((i): i is Approval => i.kind === 'approval' && i.status === 'needs_you')
        ?.session,
  );
  const [query, setQuery] = useState('');

  useEffect(() => {
    void load(rest);
  }, [load, rest]);

  const [filter, setFilter] = useState<'threads' | 'cron' | 'all'>('threads');

  const threads = useMemo(() => {
    const visible = sessions.filter((s) => {
      if (s.archived) return false;
      const isCron = sessionSourceId(s) === 'cron';
      if (filter === 'threads') return !isCron;
      if (filter === 'cron') return isCron;
      return true;
    });
    const q = query.trim().toLowerCase();
    const filtered = q ? visible.filter((s) => (s.title ?? '').toLowerCase().includes(q)) : visible;
    return groupThreads(filtered);
  }, [sessions, query, filter]);

  async function openThread(session: Session) {
    await resumeSessionIntoChat(rest, rpc, session.id, session.profile ?? activeName);
    onNavigate('chat');
  }



  const connectionState = useConnectionStore((s) => s.state);
  const connectionError = useConnectionStore((s) => s.error);
  const connected = connectionState === 'connected';
  const ptr = usePullToRefresh(() => window.location.reload());

  return (
    <div className="hm-home">
      {!sidebar && (
        <header className="hm-app-header hm-home__header" data-testid="home-header">
          <BrandMark />
          <span
            className={`hm-dot${connected ? '' : ' hm-dot--faint'} hm-home__header-dot`}
            aria-label={connected ? 'Connected' : 'Not connected'}
            role="status"
          />
          <span className="hm-app-header__sub">{activeName ?? 'default'}</span>
          {connectionState !== 'offline' && (
            <ConnectionBanner state={connectionState} error={connectionError} onRetry={onRetry} />
          )}
          <button
            type="button"
            className="hm-iconbtn"
            aria-label="Open settings"
            onClick={() => onNavigate('settings')}
          >
            <Icon name="settings" size={20} />
          </button>
        </header>
      )}
      <div
        className="hm-chats"
        onTouchStart={ptr.onTouchStart}
        onTouchMove={ptr.onTouchMove}
        onTouchEnd={ptr.onTouchEnd}
      >
        {(ptr.pull > 8 || ptr.refreshing) && (
          <div
            className={`hm-ptr${ptr.refreshing ? ' hm-ptr--refreshing' : ''}`}
            style={{ transform: `translateX(-50%) translateY(${Math.min(ptr.pull, 64)}px)`, opacity: ptr.refreshing ? 1 : Math.min(ptr.pull / 40, 1) }}
            aria-hidden="true"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <polyline points="21 3 21 9 15 9" />
            </svg>
          </div>
        )}
        {!sidebar && pendingApprovals > 0 && (
          <button
            className="hm-banner hm-home__approval-banner"
            onClick={() => onNavigate('approvals')}
            data-testid="approval-banner"
          >
            <span className="hm-home__approval-icon" aria-hidden="true">
              <Icon name="alert" size={16} />
            </span>
            <span className="hm-home__approval-body">
              <span className="hm-banner__title">
                {pendingApprovals} approval{pendingApprovals !== 1 ? 's' : ''} waiting
              </span>
              <span className="hm-banner__sub">
                {firstPendingSession ?? 'Agent is paused waiting on you'}
              </span>
            </span>
            <span className="hm-home__approval-chevron" aria-hidden="true">
              ›
            </span>
          </button>
        )}

        {!sidebar && (
          <button
            type="button"
            className="hm-fab"
            aria-label="New chat"
            data-testid="chats-new-chat"
            onClick={() => {
              startNewSession(activeName);
              onNavigate('chat');
            }}
          >
            <Icon name="plus" size={24} />
          </button>
        )}

        {sessions.length > 0 && (
          <div className="hm-home-search">
            <Icon name="search" size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              data-testid="chats-search"
            />
          </div>
        )}

        {sessions.length > 0 && (
          <div className="hm-chats__filters" role="group" aria-label="Filter conversations">
            {(['threads', 'cron', 'all'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`hm-pill${filter === f ? ' hm-pill--on' : ''}`}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                data-testid={`chats-filter-${f}`}
              >
                {f === 'threads' ? 'Threads' : f === 'cron' ? 'Cron' : 'All'}
              </button>
            ))}
          </div>
        )}

        <div className="hm-chats__list">
          {threads.length === 0 && (
            <p className="hm-muted hm-home-empty">
              {query
                ? 'No chats match your search.'
                : filter === 'cron'
                  ? 'No cron runs yet.'
                  : 'No conversations yet. Tap + to start one.'}
            </p>
          )}
          {threads.map((group) => (
            <Fragment key={group.key}>
              <div className="hm-group-label">{group.label}</div>
              {group.items.map((s) => (
                <button
                  key={s.id}
                  className="hm-thread-row"
                  onClick={() => void openThread(s)}
                  data-testid="thread-row"
                >
                  {sessionSourceId(s) === 'cron' ? (
                    <span className="hm-thread-row__cronicon" aria-hidden="true">
                      <Icon name="cron" size={16} />
                    </span>
                  ) : (
                    <span
                      className={`hm-thread-row__dot ${isLive(s) ? 'hm-thread-row__dot--live' : 'hm-thread-row__dot--idle'}`}
                      aria-hidden="true"
                    />
                  )}
                  <span className="hm-thread-row__body">
                    <span className="hm-thread-row__title">{s.title?.trim() || 'Untitled'}</span>
                    <span className="hm-thread-row__preview">
                      {s.previewText ??
                        ([
                          sessionSourceLabel(sessionSourceId(s) ?? '') ?? undefined,
                          s.messageCount ? `${s.messageCount} msgs` : undefined,
                        ]
                          .filter(Boolean)
                          .join(' · ') ||
                          'Session')}
                    </span>
                    {sessionSourceId(s) === 'cron' && (
                      <span className="hm-chip hm-thread-row__crontag">Cron</span>
                    )}
                  </span>
                  <span className="hm-thread-row__meta">
                    {fmtAge(freshness(s))}
                    {isLive(s) && <span className="hm-thread-row__live">● live</span>}
                  </span>
                </button>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
