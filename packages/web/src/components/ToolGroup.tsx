import { useMemo, useState } from 'react';
import type { RpcClient, ToolCall } from '@hermes-pwa/core';
import { Icon } from './Icon';
import { ApprovalInline } from './ApprovalInline';
import { buildToolView, toolStatus, truncate } from '../lib/toolView';

interface ToolGroupProps {
  tools: ToolCall[];
  rpc: RpcClient;
  streaming?: boolean | undefined;
  durationMs?: number | undefined;
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
    <div className={`hm-tool-group__row hm-tool-group__row--${view.status === 'success' ? 'done' : view.status}`}>
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

export function formatWorkDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return sec === 0 ? `${min}m` : `${min}m ${sec}s`;
}

export function ToolGroup({ tools, rpc, streaming, durationMs }: ToolGroupProps) {
  const runningCount = tools.filter((t) => t.output === undefined).length;
  const hasError = tools.some((tool) => toolStatus(tool) === 'error');
  const stateLabel = runningCount > 0 ? 'running' : hasError ? 'failed' : 'done';
  const [open, setOpen] = useState(false);
  // Collapsed by default; running tools stay visible so live progress and approvals are never hidden.
  const showRows = open || runningCount > 0;

  return (
    <div className={`hm-tool-group hm-tool-group--${stateLabel}${showRows ? ' hm-tool-group--open' : ''}`}>
      <button
        type="button"
        className="hm-tool-group__header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={showRows}
      >
        <span className="hm-tool-group__header-icon">
          <Icon name={runningCount > 0 ? 'settings' : hasError ? 'alert' : 'check'} size={12} />
        </span>
        <span className="hm-tool-group__header-text">
          <span className="hm-tool-group__header-meta">
            {runningCount > 0
              ? `${tools.length} ${tools.length === 1 ? 'step' : 'steps'} · ${stateLabel}`
              : !hasError && durationMs !== undefined && durationMs >= 1000
                ? `Worked for ${formatWorkDuration(durationMs)}`
                : `${tools.length} ${tools.length === 1 ? 'step' : 'steps'} · ${stateLabel}`}
          </span>
          <span className="hm-tool-group__header-title">Tool actions</span>
        </span>
        {runningCount > 0 && <span className="hm-tool-group__header-running" aria-label="running" />}
        <span className="hm-tool-group__chevron" aria-hidden="true">›</span>
      </button>
      {showRows &&
        tools.map((tool) => <ToolRow key={tool.id} tool={tool} rpc={rpc} streaming={streaming} />)}
    </div>
  );
}
