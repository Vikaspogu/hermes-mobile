import { useEffect, useState } from 'react';
import { useSpawnStore, useChatStore, type RpcClient, type SpawnNode } from '@hermes-pwa/core';
// ponytail: prototype.css's trailing @import of screens/*.css is dropped by Vite
import '../styles/screens/agents.css';

interface AgentsProps {
  rpc: RpcClient;
}

const SPAWN_EVENTS = ['subagent.started', 'subagent.update', 'subagent.progress', 'subagent.finished', 'subagent.completed', 'subagent.failed'] as const;

function fmtDuration(s: number | undefined): string {
  if (!s || s <= 0) return '';
  if (s < 60) return `${s.toFixed(0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m${rem > 0 ? ` ${rem}s` : ''}`;
}

function openSessionChat(sessionId: string) {
  // AppShell's hashchange deep-link handler navigates to chat and resumes the session.
  window.location.hash = `#/chat?session=${encodeURIComponent(sessionId)}`;
}

function ActiveCard({ node, nowMs }: { node: SpawnNode; nowMs: number }) {
  const runningFor = fmtDuration((nowMs - node.startedAt) / 1000);
  const meta = [
    node.model,
    node.status === 'queued' ? 'queued' : `running${runningFor ? ` ${runningFor}` : ''}`,
    node.taskCount > 1 ? `step ${node.taskIndex} of ${node.taskCount}` : '',
  ].filter(Boolean);
  return (
    <div className="hm-card hm-agents-card--active" data-testid="agents-active-card">
      <div className="hm-agents-card__title">
        <span>
          <span className="hm-agents-pulse" aria-hidden="true" />
          {node.id} · {node.goal}
        </span>
      </div>
      <div className="hm-agents-card__meta">{meta.join(' · ')}</div>
      <button type="button" className="hm-agents-card__open" onClick={() => openSessionChat(node.sessionId)}>
        Open chat →
      </button>
    </div>
  );
}

function RecentRow({ node }: { node: SpawnNode }) {
  const ok = node.status === 'completed';
  const lastNote = node.stream.at(-1)?.text;
  const meta = [
    node.model,
    ok
      ? `finished${node.durationSeconds ? ` in ${fmtDuration(node.durationSeconds)}` : ''}`
      : node.status === 'interrupted'
        ? 'interrupted'
        : 'failed',
    !ok && lastNote ? lastNote : '',
  ].filter(Boolean);
  return (
    <div className="hm-agents-row" data-testid="agents-recent-row">
      <div className={`hm-agents-row__icon ${ok ? 'hm-agents-row__icon--ok' : 'hm-agents-row__icon--err'}`} aria-label={node.status}>
        {ok ? '✓' : '✕'}
      </div>
      <div className="hm-agents-row__body">
        <div className="hm-agents-row__title">{node.id} · {node.goal}</div>
        <div className="hm-agents-row__sub">{meta.join(' · ')}</div>
      </div>
      <button type="button" className="hm-agents-row__log" onClick={() => openSessionChat(node.sessionId)}>
        log
      </button>
    </div>
  );
}

export function Agents({ rpc }: AgentsProps) {
  const { tree, handleEvent } = useSpawnStore();
  const sessionId = useChatStore((s) => s.sessionId);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [tab, setTab] = useState<'active' | 'recent'>('active');

  useEffect(() => {
    if (sessionId) useSpawnStore.getState().setSession(sessionId);
  }, [sessionId]);

  useEffect(() => {
    const handlers = SPAWN_EVENTS.map((type) => {
      const handler = (e: import('@hermes-pwa/core').RpcEvent) => {
        handleEvent(type, (e.payload ?? {}) as Record<string, unknown>);
      };
      rpc.events.addEventListener(type, handler);
      return { type, handler };
    });
    return () => {
      for (const { type, handler } of handlers) {
        rpc.events.removeEventListener(type, handler);
      }
    };
  }, [rpc, handleEvent]);

  const activeNodes = tree.filter((n) => n.status === 'running' || n.status === 'queued');
  const recentNodes = tree.filter((n) => n.status !== 'running' && n.status !== 'queued');

  useEffect(() => {
    if (activeNodes.length === 0) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [activeNodes.length]);

  if (tree.length === 0) {
    return (
      <div className="hm-empty-state" data-testid="agents-empty">
        <span style={{ fontSize: 36 }} aria-hidden="true">
          ✦
        </span>
        <p className="hm-body-semibold">No agents yet</p>
        <p className="hm-muted">Subagents appear here while a session delegates work.</p>
      </div>
    );
  }

  return (
    <div className="hm-agents hm-scroll">
      <div className="hm-seg" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'active'}
          className={`hm-seg__item${tab === 'active' ? ' hm-seg__item--on' : ''}`}
          onClick={() => setTab('active')}
        >
          Active · {activeNodes.length}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'recent'}
          className={`hm-seg__item${tab === 'recent' ? ' hm-seg__item--on' : ''}`}
          onClick={() => setTab('recent')}
        >
          Recent · {recentNodes.length}
        </button>
      </div>

      {tab === 'active' && activeNodes.map((node) => <ActiveCard key={node.id} node={node} nowMs={nowMs} />)}

      {tab === 'recent' && recentNodes.length > 0 && (
        <>
          <p className="hm-group-label">Recent</p>
          {recentNodes.map((node) => (
            <RecentRow key={node.id} node={node} />
          ))}
        </>
      )}
    </div>
  );
}
