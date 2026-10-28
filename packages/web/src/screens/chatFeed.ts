import type { Message, ToolCall } from '@hermes-pwa/core';

type FeedItem =
  | { kind: 'msg'; message: Message; index: number; suppressActions: boolean }
  | {
      kind: 'strip';
      id: string;
      groupThought: string | undefined;
      groupTodos: ToolCall | undefined;
      groupTools: ToolCall[];
      durationMs: number | undefined;
      streaming: boolean;
    };

// Collapse runs of assistant messages: one "Worked for Xs" strip per turn holds the
// thinking/todo/tool work; intermediate tool-only bubbles disappear, text stays.
export function buildFeedItems(
  messages: Message[],
  streaming: boolean,
  turnDurationById: ReadonlyMap<string, number>,
): FeedItem[] {
  const items: FeedItem[] = [];
  const n = messages.length;
  let i = 0;
  while (i < n) {
    const m = messages[i];
    if (!m || m.role !== 'assistant') {
      if (m) items.push({ kind: 'msg', message: m, index: i, suppressActions: false });
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && messages[j + 1]?.role === 'assistant') j++;
    const head = messages[j];
    if (!head) {
      i = j + 1;
      continue;
    }
    const headActive = streaming && j === n - 1;
    const contributors = headActive ? messages.slice(i, j) : messages.slice(i, j + 1);
    const groupThought = contributors.map((c) => c.thinking?.trim()).filter(Boolean).join('\n\n') || undefined;
    const groupTodos = contributors
      .flatMap((c) => (c.toolCalls ?? []).filter((t) => t.name === 'todo' && typeof t.output === 'string'))
      .at(-1);
    const groupTools = contributors.flatMap((c) => (c.toolCalls ?? []).filter((t) => t.name !== 'todo'));
    const hasStrip = Boolean(groupThought || groupTodos || groupTools.length > 0);
    const firstContributor = contributors[0];
    if (hasStrip && firstContributor) {
      items.push({
        kind: 'strip',
        id: `strip:${firstContributor.id}`,
        groupThought,
        groupTodos,
        groupTools,
        durationMs: headActive ? undefined : turnDurationById.get(head.id),
        streaming: headActive,
      });
    }
    for (let k = i; k <= j; k++) {
      const msg = messages[k];
      if (!msg) continue;
      const isContributor = k < j || !headActive;
      if (!hasStrip || !isContributor) {
        items.push({ kind: 'msg', message: msg, index: k, suppressActions: false });
        continue;
      }
      if (!msg.text?.trim()) continue; // tool-only bubble folded into the strip
      items.push({ kind: 'msg', message: msg, index: k, suppressActions: true });
    }
    i = j + 1;
  }
  return items;
}
