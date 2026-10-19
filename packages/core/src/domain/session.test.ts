import { describe, expect, it } from 'vitest';
import {
  mergeSessionsByLineage,
  sessionCurrentSourceId,
  sessionHasDifferentCurrentSource,
  sessionSourceId,
  toSession,
} from './session';

describe('session domain source helpers', () => {
  it('maps backend rows with a local source', () => {
    const session = toSession({ id: 's-1', title: 'CLI work', source: 'cli' });

    expect(session.source).toBe('cli');
    expect(sessionSourceId(session)).toBe('cli');
  });

  it('preserves lineage metadata while keeping the fresher openable local row', () => {
    const [merged] = mergeSessionsByLineage([], [
      toSession({
        id: 'old-branch',
        title: 'Local branch 18',
        source: 'cli',
        _lineage_root_id: 'root-chat',
        last_active: 100,
        message_count: 80,
      }),
      toSession({
        id: 'current-head',
        title: 'Local branch 22',
        source: 'tui',
        _lineage_root_id: 'root-chat',
        last_active: 300,
        message_count: 336,
      }),
    ]);

    expect(merged?.id).toBe('current-head');
    expect(merged?.lineageRootId).toBe('root-chat');
    expect(sessionSourceId(merged!)).toBe('tui');
  });

  it('uses origin source for primary identity and current source separately', () => {
    const session = toSession({ id: 'head', source: 'cli', origin_source: 'cli', current_source: 'tui' });

    expect(session.source).toBe('cli');
    expect(session.originSource).toBe('cli');
    expect(session.currentSource).toBe('tui');
    expect(sessionSourceId(session)).toBe('cli');
    expect(sessionCurrentSourceId(session)).toBe('tui');
    expect(sessionHasDifferentCurrentSource(session)).toBe(true);
  });

  it('keeps cli origin while opening the fresher tui head', () => {
    const [merged] = mergeSessionsByLineage([], [
      toSession({
        id: 'old-cli',
        title: 'CLI branch',
        source: 'cli',
        origin_source: 'cli',
        current_source: 'cli',
        _lineage_root_id: 'root-chat',
        last_active: 100,
        message_count: 80,
      }),
      toSession({
        id: 'head-tui',
        title: 'TUI head',
        source: 'tui',
        origin_source: 'cli',
        current_source: 'tui',
        _lineage_root_id: 'root-chat',
        last_active: 300,
        message_count: 336,
      }),
    ]);

    expect(merged?.id).toBe('head-tui');
    expect(merged?.lineageRootId).toBe('root-chat');
    expect(merged?.originSource).toBe('cli');
    expect(merged?.currentSource).toBe('tui');
    expect(sessionSourceId(merged!)).toBe('cli');
    expect(sessionCurrentSourceId(merged!)).toBe('tui');
  });
});

describe('toSession preview mapping', () => {
  it("maps the dashboard's `preview` field to previewText", () => {
    expect(toSession({ id: 's-1', preview: '/ivan' }).previewText).toBe('/ivan');
  });
});
