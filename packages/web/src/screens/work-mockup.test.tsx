import { describe, it, expect, vi } from 'vitest';
import { prioTone, matchesWorkFilter, workFilterCounts, workTaskMeta } from './Projects';
import { to12h, relFuture, jobEmoji } from './Cron';
import type { CronJob, Task } from '@hermes-pwa/core';

const task = (over: Partial<Task>): Task => ({ id: 't1', title: 'T', status: 'todo', ...over }) as Task;

describe('M5 task helpers', () => {
  it('buckets numeric priority onto mockup tones', () => {
    expect(prioTone(10)).toBe('p0');
    expect(prioTone(5)).toBe('p1');
    expect(prioTone(1)).toBe('p2');
    expect(prioTone(0)).toBeNull();
    expect(prioTone(undefined)).toBeNull();
  });

  it('matches work filter chips to statuses', () => {
    expect(matchesWorkFilter(task({ status: 'running' }), 'active')).toBe(true);
    expect(matchesWorkFilter(task({ status: 'in_progress' }), 'active')).toBe(true);
    expect(matchesWorkFilter(task({ status: 'todo' }), 'active')).toBe(false);
    expect(matchesWorkFilter(task({ status: 'blocked' }), 'blocked')).toBe(true);
    expect(matchesWorkFilter(task({ status: 'done' }), 'done')).toBe(true);
    expect(matchesWorkFilter(task({ status: 'blocked' }), 'all')).toBe(true);
  });

  it('counts chips from statuses', () => {
    const counts = workFilterCounts([
      task({ id: 'a', status: 'running' }),
      task({ id: 'b', status: 'in_progress' }),
      task({ id: 'c', status: 'blocked' }),
      task({ id: 'd', status: 'done' }),
      task({ id: 'e', status: 'todo' }),
    ]);
    expect(counts).toEqual({ active: 2, blocked: 1, done: 1 });
  });

  it('builds the meta sub-line per state', () => {
    expect(workTaskMeta(task({ status: 'running', run: 'run-7e1', assignee: 'career-content' }))).toEqual({
      live: true,
      warn: false,
      text: 'run-7e1 live · @career-content',
    });
    expect(workTaskMeta(task({ status: 'blocked', block: 'missing AWS creds' })).warn).toBe(true);
    expect(workTaskMeta(task({ status: 'blocked', block: 'missing AWS creds' })).text).toBe(
      '⚠ blocked · missing AWS creds',
    );
    expect(workTaskMeta(task({ status: 'backlog' })).text).toBe('backlog · @default');
  });
});

describe('M6 schedule helpers', () => {
  it('converts 24h describeSchedule output to 12h', () => {
    expect(to12h('Daily at 03:00')).toBe('Daily at 3:00 AM');
    expect(to12h('Daily at 13:45')).toBe('Daily at 1:45 PM');
    expect(to12h('Daily at 00:30')).toBe('Daily at 12:30 AM');
    expect(to12h('Daily at 12:00')).toBe('Daily at 12:00 PM');
    expect(to12h('Every 2 hours')).toBe('Every 2 hours');
  });

  it('labels relative next-run times', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    expect(relFuture(Date.now() + 30 * 60000)).toBe('in 30m');
    expect(relFuture(Date.now() + 6 * 3600000)).toBe('in 6h');
    expect(relFuture(Date.now() + 4 * 86400000)).toBe('in 4d');
    expect(relFuture(Date.now() - 1000)).toBe('due');
    expect(relFuture(undefined)).toBeNull();
    vi.useRealTimers();
  });

  it('picks mockup emoji by job keywords with a clock fallback', () => {
    const job = (name: string): CronJob => ({ id: 'x', name }) as CronJob;
    expect(jobEmoji(job('Nightly backup'))).toBe('🌙');
    expect(jobEmoji(job('Security audit'))).toBe('🛡');
    expect(jobEmoji(job('Health check'))).toBe('🩺');
    expect(jobEmoji(job('Prune old logs'))).toBe('🧹');
    expect(jobEmoji(job('Weekly report'))).toBe('⏰');
  });
});
