import { describe, expect, it } from 'vitest';
import type { Message, ToolCall } from '@hermes-pwa/core';
import { buildFeedItems } from './chatFeed';

let seq = 0;
function msg(partial: Partial<Message> & { role: Message['role'] }): Message {
  seq += 1;
  return { id: `m${seq}`, createdAt: 1_700_000_000 + seq, ...partial } as Message;
}

function tool(name: string, output?: string): ToolCall {
  return { id: `t:${name}:${Math.random()}`, name, input: {}, output } as ToolCall;
}
type Items = ReturnType<typeof buildFeedItems>;
function stripAt(items: Items, n: number) {
  const item = items[n];
  if (!item || item.kind !== 'strip') throw new Error(`expected strip at ${n}`);
  return item;
}

describe('buildFeedItems', () => {
  it('passes user messages through untouched', () => {
    const items = buildFeedItems([msg({ role: 'user', text: 'hi' })], false, new Map());
    expect(items).toEqual([
      { kind: 'msg', message: expect.objectContaining({ text: 'hi' }), index: 0, suppressActions: false },
    ]);
  });

  it('keeps a plain assistant bubble unchanged when it has no tool work', () => {
    const items = buildFeedItems([msg({ role: 'user', text: 'q' }), msg({ role: 'assistant', text: 'a' })], false, new Map());
    expect(items.map((i) => i.kind)).toEqual(['msg', 'msg']);
    expect(items[1]).toMatchObject({ suppressActions: false });
  });

  it('folds a completed turn into one strip plus its text bubble', () => {
    const items = buildFeedItems(
      [
        msg({ role: 'user', text: 'q' }),
        msg({ role: 'assistant', text: '', toolCalls: [tool('read', 'done')], thinking: 'hmm' }),
        msg({ role: 'assistant', text: 'Here is the answer.' }),
      ],
      false,
      new Map(),
    );
    expect(items.map((i) => i.kind)).toEqual(['msg', 'strip', 'msg']);
    const strip = stripAt(items, 1);
    expect(strip).toMatchObject({ groupThought: 'hmm', streaming: false });
    expect(strip.groupTools).toHaveLength(1);
    expect(items[2]).toMatchObject({ kind: 'msg', suppressActions: true });
  });

  it('keeps the streaming head inline and strips only completed predecessor work', () => {
    const items = buildFeedItems(
      [
        msg({ role: 'assistant', text: '', toolCalls: [tool('exec')] }),
        msg({ role: 'assistant', text: '', toolCalls: [tool('exec2')] }),
      ],
      true,
      new Map(),
    );
    expect(items.map((i) => i.kind)).toEqual(['strip', 'msg']);
    const strip = stripAt(items, 0);
    expect(strip.streaming).toBe(true);
    expect(strip.durationMs).toBeUndefined();
    expect(strip.groupTools.map((t) => t.name)).toEqual(['exec']);
    expect(items[1]).toMatchObject({ kind: 'msg', index: 1, suppressActions: false });
  });

  it('collects todo calls into the strip and folds tool-only bubbles', () => {
    const items = buildFeedItems(
      [
        msg({ role: 'assistant', text: '', toolCalls: [tool('todo', '{"todos":[]}')] }),
        msg({ role: 'assistant', text: '', toolCalls: [tool('read', 'x')] }),
        msg({ role: 'assistant', text: 'final' }),
      ],
      false,
      new Map(),
    );
    expect(items.map((i) => i.kind)).toEqual(['strip', 'msg']);
    const strip = stripAt(items, 0);
    expect(strip.groupTodos?.name).toBe('todo');
    expect(strip.groupTools.map((t) => t.name)).toEqual(['read']);
  });

  it('splits runs at a user boundary into two strips', () => {
    const items = buildFeedItems(
      [
        msg({ role: 'assistant', text: '', toolCalls: [tool('a', 'x')] }),
        msg({ role: 'user', text: 'next' }),
        msg({ role: 'assistant', text: '', toolCalls: [tool('b', 'y')] }),
      ],
      false,
      new Map(),
    );
    expect(items.map((i) => i.kind)).toEqual(['strip', 'msg', 'strip']);
  });

  it('keeps a text-carrying intermediate bubble, suppressing only its actions', () => {
    const items = buildFeedItems(
      [
        msg({ role: 'assistant', text: 'interim note', toolCalls: [tool('read', 'x')] }),
        msg({ role: 'assistant', text: 'final' }),
      ],
      false,
      new Map(),
    );
    expect(items.map((i) => i.kind)).toEqual(['strip', 'msg', 'msg']);
    expect(items[1]).toMatchObject({ suppressActions: true });
    expect(items[2]).toMatchObject({ suppressActions: true });
  });

  it('reads the turn duration from turnDurationById keyed by the run head', () => {
    const tail = msg({ role: 'assistant', text: 'done', toolCalls: [tool('read', 'x')] });
    const items = buildFeedItems([tail], false, new Map([[tail.id, 42_000]]));
    expect(stripAt(items, 0).durationMs).toBe(42_000);
  });
});
