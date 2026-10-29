import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Session } from '@hermes-pwa/core';
import { groupThreads } from './Chats';

function session(id: string, updatedAtSec: number): Session {
  return { id, title: id, updatedAt: updatedAtSec } as Session;
}

const DAY = 86_400;

// Pin the clock: offsets like "1 hour ago" cross day boundaries when the
// suite runs between 00:00 and 01:00 local time.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('groupThreads', () => {
  it('buckets into Today / Yesterday / Earlier and sorts newest first', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const groups = groupThreads([
      session('earlier', nowSec - 3 * DAY),
      session('today-old', nowSec - 3600),
      session('yesterday', nowSec - DAY - 3600),
      session('today-new', nowSec - 60),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Earlier']);
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.items.map((s) => s.id)]));
    expect(byKey['today']).toEqual(['today-new', 'today-old']);
    expect(byKey['yesterday']).toEqual(['yesterday']);
    expect(byKey['earlier']).toEqual(['earlier']);
  });

  it('drops empty groups', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const groups = groupThreads([session('earlier', nowSec - 5 * DAY)]);
    expect(groups.map((g) => g.key)).toEqual(['earlier']);
  });
});
