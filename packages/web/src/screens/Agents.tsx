import { useEffect, useState } from 'react';
import { useSpawnStore, useChatStore, type RpcClient, type SpawnNode, type SpawnStatus } from '@hermes-pwa/core';

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

function fmtTokens(n: number | undefined): string {
  if (!n) return '';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k tok` : `${n} tok`;
}

function fmtAge(updatedAt: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - updatedAt) / 1000));
  if (s < 2) return 'now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function StatusDot({ status }: { status: SpawnStatus }) {
  const color =
    status === 'running' || status === 'queued'
      ? 'var(--hm-color-running)'
      : status === 'completed'
        ? 'var(--hm-color-success)'
        : 'var(--hm-color-danger)';
  const isActive = status === 'running' || status === 'queued';
  return (
    <span
      className="hm-spawn-dot"
      style={{
        background: color,
        animation: isActive ? 'hm-pulse 1.6s infinite' : undefined,
      }}
      aria-label={status}
    />
  );
}

function StreamLine({ text, kind, isError }: { text: string; kind: string; isError?: boolean }) {
  const isMono = kind === 'tool';
  return (
    <div className={`hm-spawn-stream-line${isError ? ' hm-spawn-stream-line--error' : ''}`}>
      <span className="hm-spawn-stream-glyph" aria-hidden="true">
        {kind === 'tool' ? '·' : kind === 'summary' ? '✓' : kind === 'thinking' ? '…' : '›'}
      </span>
      <span className={isMono ? 'hm-mono hm-spawn-stream-text' : 'hm-spawn-stream-text'}>{text}</span>
    </div>
  );
}

function SpawnRow({ node, depth = 0, nowMs }: { node: SpawnNode; depth?: number; nowMs: number }) {
  const running = node.status === 'running' || node.status === 'queued';
  const [open, setOpen] = useState(() => running || depth < 2);

  useEffect(() => {
    if (running) setOpen(true);
  }, [running]);

  const tokens = (node.inputTokens ?? 0) + (node.outputTokens ?? 0);
  const meta = [
    node.model,
    fmtDuration(node.durationSeconds),
    fmtTokens(tokens),
    node.costUsd ? `$${node.costUsd.toFixed(2)}` : '',
    fmtAge(node.updatedAt, nowMs),
  ].filter(Boolean);

  const visibleStream = open ? node.stream.slice(-8) : node.stream.slice(-1);

  return (
    <div className={`hm-spawn-row${depth > 0 ? ' hm-spawn-row--child' : ''}`} data-testid="spawn-row">
      <button className="hm-spawn-row__header" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <StatusDot status={node.status} />
        <span className={`hm-spawn-row__goal${running ? ' hm-spawn-row__goal--active' : ''}`}>{node.goal}</span>
        <span className="hm-spawn-row__chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {meta.length > 0 && <p className="hm-spawn-row__meta">{meta.join(' · ')}</p>}

      {open && visibleStream.length > 0 && (
        <div className="hm-spawn-stream">
          {visibleStream.map((entry, i) => (
            <StreamLine key={`${entry.kind}:${entry.at}:${i}`} {...entry} />
          ))}
        </div>
      )}

      {open && (node.filesWritten.length > 0 || node.filesRead.length > 0) && (
        <div className="hm-spawn-files">
          {node.filesWritten.slice(0, 4).map((f) => (
            <span key={f} className="hm-spawn-files__line hm-mono">
              + {f}
            </span>
          ))}
          {node.filesRead.slice(0, 4).map((f) => (
            <span key={f} className="hm-spawn-files__line hm-mono">
              · {f}
            </span>
          ))}
        </div>
      )}

      {node.children.length > 0 && open && (
        <div className="hm-spawn-children">
          {node.children.map((child) => (
            <SpawnRow key={child.id} node={child} depth={depth + 1} nowMs={nowMs} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Agents({ rpc }: AgentsProps) {
  const { tree, agents, handleEvent } = useSpawnStore();
  const sessionId = useChatStore((s) => s.sessionId);
  const [nowMs, setNowMs] = useState(() => Date.now());

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

  const hasActive = agents.some((a) => a.status === 'running' || a.status === 'queued');
  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(id);
  }, [hasActive]);

  const active = agents.filter((a) => a.status === 'running' || a.status === 'queued').length;
  const activeNodes = tree.filter((n) => n.status === 'running' || n.status === 'queued');
  const recentNodes = tree.filter((n) => n.status !== 'running' && n.status !== 'queued');
  const failed = agents.filter((a) => a.status === 'failed' || a.status === 'interrupted').length;
  const totalTokens = agents.reduce((s, a) => s + (a.inputTokens ?? 0) + (a.outputTokens ?? 0), 0);
  const totalCost = agents.reduce((s, a) => s + (a.costUsd ?? 0), 0);
  const summary = [
    agents.length > 0 ? `${agents.length} agent${agents.length !== 1 ? 's' : ''}` : '',
    active > 0 ? `${active} active` : '',
    failed > 0 ? `${failed} failed` : '',
    totalTokens > 0 ? fmtTokens(totalTokens) : '',
    totalCost > 0 ? `$${totalCost.toFixed(2)}` : '',
  ].filter(Boolean);

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
    <div className="hm-spawn-tree">
      {summary.length > 0 && <p className="hm-spawn-tree__summary">{summary.join(' · ')}</p>}
      <div className="hm-spawn-tree__list">
        {activeNodes.length > 0 && <p className="hm-thread-group__label">Active</p>}
        {activeNodes.map((node) => (
          <SpawnRow key={node.id} node={node} depth={0} nowMs={nowMs} />
        ))}
        {recentNodes.length > 0 && <p className="hm-thread-group__label">Recent</p>}
        {recentNodes.map((node) => (
          <SpawnRow key={node.id} node={node} depth={0} nowMs={nowMs} />
        ))}
      </div>
    </div>
  );
}
