import { beforeEach, describe, expect, it } from 'vitest';
import { getInitialScreen, persistScreen, screenFromLocationHash, sessionFromLocationHash } from './screenStorage';

describe('screenStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('opens Home on the first launch when no screen was persisted', () => {
    expect(getInitialScreen()).toBe('home');
  });

  it('restores Chat when no screen was persisted but active cache exists', () => {
    localStorage.setItem('hermes-pwa.activeSession.v4:default', JSON.stringify({ storedSessionId: 'stored-1', messages: [] }));
    expect(getInitialScreen()).toBe('chat');
  });

  it('restores the last non-chat screen', () => {
    localStorage.setItem('hermes-mobile-screen', 'kanban');
    expect(getInitialScreen()).toBe('kanban');
  });

  it('parses notification hash routes', () => {
    expect(screenFromLocationHash('#/approvals')).toBe('approvals');
    expect(screenFromLocationHash('#approvals')).toBe('approvals');
    expect(screenFromLocationHash('./index.html#/approvals')).toBe('approvals');
    expect(screenFromLocationHash('#/unknown')).toBeUndefined();
  });

  it('parses the session deep link from notification hash routes', () => {
    expect(sessionFromLocationHash('./index.html#/chat?session=cron_f130ab853536_20261017_124156')).toBe('cron_f130ab853536_20261017_124156');
    expect(sessionFromLocationHash('#/chat?session=a%2Fb')).toBe('a/b');
    expect(sessionFromLocationHash('#/chat')).toBeUndefined();
    expect(sessionFromLocationHash('#/chat?session=')).toBeUndefined();
  });

  it('falls back to Home when the last screen was Chat but no active session cache exists', () => {
    localStorage.setItem('hermes-mobile-screen', 'chat');
    expect(getInitialScreen()).toBe('home');
  });

  it('restores Chat when the last screen was Chat and legacy active cache has a durable session', () => {
    localStorage.setItem('hermes-mobile-screen', 'chat');
    localStorage.setItem('hermes-pwa.activeSession.v3', JSON.stringify({ storedSessionId: 'stored-1', messages: [] }));
    expect(getInitialScreen()).toBe('chat');
  });

  it('falls back to Home when Chat cache has only an ephemeral live runtime id', () => {
    localStorage.setItem('hermes-mobile-screen', 'chat');
    localStorage.setItem('hermes-pwa.activeSession.v3', JSON.stringify({ sessionId: 'dead-live-runtime', messages: [] }));
    expect(getInitialScreen()).toBe('home');
  });

  it('restores Chat when the last screen was Chat and profiled active cache has messages', () => {
    localStorage.setItem('hermes-mobile-screen', 'chat');
    localStorage.setItem(
      'hermes-pwa.activeSession.v4:default',
      JSON.stringify({ profile: 'default', messages: [{ id: 'm-1', role: 'user', text: 'hello' }] }),
    );
    expect(getInitialScreen()).toBe('chat');
  });

  it('ignores invalid active cache JSON and falls back to Home for Chat', () => {
    localStorage.setItem('hermes-mobile-screen', 'chat');
    localStorage.setItem('hermes-pwa.activeSession.v3', '{bad json');
    expect(getInitialScreen()).toBe('home');
  });

  it('persists the provided screen', () => {
    persistScreen('agents');
    expect(localStorage.getItem('hermes-mobile-screen')).toBe('agents');
  });
});
