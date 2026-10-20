import { useMemo, useState } from 'react';
import type { RpcClient, ToolCall } from '@hermes-pwa/core';
import { Icon } from './Icon';
import { ApprovalInline } from './ApprovalInline';
import { buildToolView, truncate } from '../lib/toolView';

interface ToolGroupProps {
  tools: ToolCall[];
  rpc: RpcClient;
  streaming?: boolean | undefined;
}

interface ToolRowProps {
  tool: ToolCall;
  rpc: RpcClient;
  streaming?: boolean | undefined;
}

function ToolRow({ tool, rpc, streaming }: ToolRowProps) {
  const [expanded, setExpanded] = useState(false);
  const view = useMemo(() => buildToolView(tool), [tool]);
  const isPendingTool = view.status === 'running';
  const isRunning = isPendingTool && streaming;

  return (
    <div className={`hm-tool-group__row ${isPendingTool ? 'hm-tool-group__row--running' : 'hm-tool-group__row--done'}`}>
      <button
        type="button"
        className="hm-tool-group__row-button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="hm-tool-group__row-icon">
          <Icon name={view.icon as import('./Icon').IconName} size={14} />
        </span>
        <span className="hm-tool-group__row-title">{view.title}</span>
        {view.subtitle && (
          <>
            <span className="hm-tool-group__row-dot">·</span>
            <span className="hm-tool-group__row-target">{truncate(view.subtitle, 90)}</span>
          </>
        )}
        {isRunning && <span className="hm-tool-group__row-running" aria-label="running" />}
        {view.countLabel && <span className="hm-tool-group__row-count">{view.countLabel}</span>}
      </button>

      {expanded && view.detail && (
        <div className="hm-tool-group__row-detail">
          {view.detailLabel && <div className="hm-tool-group__row-detail-label">{view.detailLabel}</div>}
          <pre className="hm-tool-group__row-output">{view.detail}</pre>
        </div>
      )}
      {isPendingTool && <ApprovalInline rpc={rpc} tool={tool} />}
    </div>
  );
}

export function ToolGroup({ tools, rpc, streaming }: ToolGroupProps) {
  const runningCount = tools.filter((t) => t.output === undefined).length;
  const stateLabel = runningCount > 0 ? 'running' : 'done';
  const [open, setOpen] = useState(false);
  // Collapsed by default; only running tools stay visible so live progress and approvals are never hidden.
  const showRows = open || runningCount > 0;
  const visibleTools = open ? tools : tools.filter((t) => t.output === undefined);
  // Mockup-style collapsed summary: "Read 2 files · Bash +2" instead of a generic label.
  const summary = useMemo(() => {
    const titles = tools.slice(0, 2).map((t) => buildToolView(t).title);
    const rest = tools.length - titles.length;
    const text = titles.join(' · ') + (rest > 0 ? ` · +${rest} more` : '');
    return truncate(text || 'Tool actions', 60);
  }, [tools]);
  return (
    <div className="hm-tool-group">
      <button
        type="button"
        className="hm-tool-group__header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={showRows}
      >
        <span className="hm-tool-group__header-icon">
          <Icon name="settings" size={12} />
        </span>
        <span className="hm-tool-group__header-title">{summary}</span>
        <span className="hm-tool-group__header-meta">
          {tools.length} {tools.length === 1 ? 'step' : 'steps'} · {stateLabel}
        </span>
        {runningCount > 0 && <span className="hm-tool-group__header-running" aria-label="running" />}
        <span className="hm-tool-group__chevron" aria-hidden="true">›</span>
      </button>
      {showRows &&
        visibleTools.map((tool) => <ToolRow key={tool.id} tool={tool} rpc={rpc} streaming={streaming} />)}
    </div>
  );
}
