import { useEffect, useMemo, useState } from 'react';
import {
  useActivityStore,
  useSessionsStore,
  useProfilesStore,
  useChatStore,
  sessionSourceId,
  sessionSourceLabel,
  type Session,
  type RpcClient,
  type RestClient,
} from '@hermes-pwa/core';
import { Icon } from '../components/Icon';

interface ChatsProps {
  rpc: RpcClient;
  rest: RestClient;
  onNavigate: (screen: string) => void;
  /** Desktop split sidebar: hides composer + approval banner, slim thread list. */
  sidebar?: boolean;
}

function fmtAge(updatedAt: number): string {
  // updated_at arrives as Unix seconds; accept ms too.
  const delta = Math.max(0, Date.now() - (updatedAt > 10_000_000_000 ? updatedAt : updatedAt * 1000));
  if (delta < 60_000) return 'now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}

function isToday(updatedAt: number): boolean {
  const ms = updatedAt > 10_000_000_000 ? updatedAt : updatedAt * 1000;
  const d = new Date(ms);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isLive(s: Session): boolean {
  return Boolean(s.isActive || s.active);
}

function freshness(s: Session): number {
  return Math.max(s.lastActive ?? 0, s.updatedAt ?? 0, s.startedAt ?? 0);
}

interface ThreadGroup {
  key: 'live' | 'today' | 'earlier';
  label: string;
  items: Session[];
}

export function groupThreads(sessions: Session[]): ThreadGroup[] {
  const live = sessions.filter(isLive).sort((a, b) => freshness(b) - freshness(a));
  const rest = sessions.filter((s) => !isLive(s)).sort((a, b) => freshness(b) - freshness(a));
  const today = rest.filter((s) => isToday(freshness(s)));
  const earlier = rest.filter((s) => !isToday(freshness(s)));
  const groups: ThreadGroup[] = [
    { key: 'live', label: 'Live', items: live },
    { key: 'today', label: 'Today', items: today },
    { key: 'earlier', label: 'Earlier', items: earlier },
  ];
  return groups.filter((g) => g.items.length > 0);
}

export function Chats({ rpc, rest, onNavigate, sidebar }: ChatsProps) {
  const { sessions, load } = useSessionsStore();
  const activeName = useProfilesStore((s) => s.activeName);
  const { startNewSession, resumeSessionIntoChat, submit } = useChatStore();
  const pendingApprovals = useActivityStore(
    (s) => s.items.filter((i) => i.kind === 'approval' && i.status === 'needs_you').length,
  );
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    void load(rest);
  }, [load, rest]);

  const threads = useMemo(() => {
    const visible = sessions.filter(
      (s) => !s.archived && sessionSourceId(s) !== 'cron',
    );
    const q = query.trim().toLowerCase();
    const filtered = q ? visible.filter((s) => (s.title ?? '').toLowerCase().includes(q)) : visible;
    return groupThreads(filtered);
  }, [sessions, query]);

  async function openThread(session: Session) {
    await resumeSessionIntoChat(rest, rpc, session.id, session.profile ?? activeName);
    onNavigate('chat');
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    startNewSession(activeName);
    onNavigate('chat');
    void submit(rpc, text, activeName ?? undefined);
    setDraft('');
  }

  return (
    <div className="hm-chats">
      {!sidebar && pendingApprovals > 0 && (
        <button
          className="hm-home__approval-banner"
          onClick={() => onNavigate('approvals')}
          data-testid="approval-banner"
        >
          <span className="hm-home__approval-icon">
            <Icon name="alert" size={18} />
          </span>
          <span className="hm-home__approval-body">
            <span className="hm-home__approval-title">
              {pendingApprovals} approval{pendingApprovals !== 1 ? 's' : ''} waiting
            </span>
            <span className="hm-home__approval-sub">Agent is paused waiting on you</span>
          </span>
          <span className="hm-home__approval-chevron" aria-hidden="true">
            <Icon name="chevR" size={15} />
          </span>
        </button>
      )}

      {!sidebar && (
      <form className="hm-chats__composer" onSubmit={handleSend}>
        <Icon name="plus" size={18} />
        <input
          className="hm-chats__composer-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message Hermes…"
          aria-label="New chat message"
          data-testid="chats-composer"
        />
        {draft.trim() && (
          <button type="submit" className="hm-chats__composer-send" aria-label="Start chat">
            <Icon name="arrowUp" size={16} />
          </button>
        )}
      </form>
      )}

      {sessions.length > 0 && (
        <div className="hm-chats__search">
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

      <div className="hm-chats__list">
        {threads.length === 0 && (
          <p className="hm-muted" style={{ padding: '24px 4px' }}>
            {query ? 'No chats match your search.' : 'No conversations yet. Start one above.'}
          </p>
        )}
        {threads.map((group) => (
          <section key={group.key} className="hm-thread-group">
            <div className="hm-thread-group__label">{group.label}</div>
            {group.items.map((s) => (
              <button
                key={s.id}
                className="hm-thread-row"
                onClick={() => void openThread(s)}
                data-testid="thread-row"
              >
                <span className="hm-thread-row__body">
                  <span className="hm-thread-row__title">
                    {isLive(s) && <span className="hm-live-dot" aria-label="live" />}
                    {s.title?.trim() || 'Untitled'}
                  </span>
                  <span className="hm-thread-row__preview">
                    {/* ponytail: no last-message text in the sessions API yet; metadata stands in.
                        Swap for s.lastMessage when the gateway exposes it. */}
                    {[
                      sessionSourceLabel(sessionSourceId(s) ?? '') ?? undefined,
                      s.messageCount ? `${s.messageCount} msgs` : undefined,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Session'}
                  </span>
                </span>
                <span className="hm-thread-row__meta">{fmtAge(freshness(s))}</span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
