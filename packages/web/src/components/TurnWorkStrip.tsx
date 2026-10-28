import { memo, useState } from 'react';
import type { ToolCall } from '@hermes-pwa/core';
import type { MessageBubbleProps } from './MessageBubble.helpers';
import { ThinkingDisclosure } from './ThinkingDisclosure';
import { TodoPanel } from './TodoPanel';
import { ToolGroup, formatWorkDuration } from './ToolGroup';
import { Icon } from './Icon';

export interface TurnWorkStripProps {
  groupThought?: string | undefined;
  groupTodos?: ToolCall | undefined;
  groupTools?: ToolCall[] | undefined;
  durationMs?: number | undefined;
  streaming?: boolean | undefined;
  rpc: MessageBubbleProps['rpc'];
}

function TurnWorkStripView({
  groupThought,
  groupTodos,
  groupTools,
  durationMs,
  streaming,
  rpc,
}: TurnWorkStripProps) {
  // Auto-open while the turn is live or when it still holds an unfinished tool
  // row: the approval dock hides approvals claimed by those rows, so the strip
  // must expose them without a click.
  const [open, setOpen] = useState(
    Boolean(streaming) || (groupTools ?? []).some((tool) => tool.output === undefined),
  );
  const workedLabel = durationMs !== undefined && durationMs >= 1000 ? `Worked for ${formatWorkDuration(durationMs)}` : 'Worked';
  return (
    <div className={`hm-turn-strip${open ? ' hm-turn-strip--open' : ''}`}>
      <button
        type="button"
        className="hm-turn-strip__row"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="hm-turn-strip__icon" aria-hidden="true">
          <Icon name="terminal" size={13} />
        </span>
        <span className="hm-turn-strip__label">
          {workedLabel}
        </span>
        <Icon name={open ? 'chevD' : 'chevR'} size={12} />
      </button>
      {open && (
        <div className="hm-turn-strip__body">
          {groupThought ? <ThinkingDisclosure text={groupThought} streaming={Boolean(streaming)} /> : null}
          {groupTodos ? (
            <div className="hm-message__todos">
              <TodoPanel tool={groupTodos} />
            </div>
          ) : null}
          {groupTools && groupTools.length > 0 ? (
            <ToolGroup tools={groupTools} rpc={rpc} streaming={Boolean(streaming)} />
          ) : null}
        </div>
      )}
    </div>
  );
}

function sameGroup(a: ToolCall[] | undefined, b: ToolCall[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((tool, i) => tool === b[i]);
}

// buildFeedItems re-allocates groupTools per render; identity-compare elements so
// an idle strip doesn't re-render per streaming token. While streaming, always
// re-render: tool output is mutated in place, so element identity can't detect it.
export const TurnWorkStrip = memo(
  TurnWorkStripView,
  (a, b) =>
    !a.streaming &&
    !b.streaming &&
    a.groupThought === b.groupThought &&
    a.groupTodos === b.groupTodos &&
    sameGroup(a.groupTools, b.groupTools) &&
    a.durationMs === b.durationMs &&
    a.rpc === b.rpc,
);
TurnWorkStrip.displayName = 'TurnWorkStrip';
