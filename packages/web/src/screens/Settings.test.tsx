import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Settings } from './Settings';
import { HERMES_PWA_RELEASE_VERSION } from '../app/version';
import { useProfilesStore, useModelStore } from '@hermes-pwa/core';
import { currentPushSubscriptionId } from '../pwa/push';

vi.mock('../pwa/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pwa/push')>()),
  currentPushSubscriptionId: vi.fn().mockResolvedValue(null),
}));

const makeRest = (overrides = {}) =>
  ({
    systemStats: vi.fn().mockResolvedValue({
      version: 'v0.16.0',
      uptimeSeconds: 123,
      activeSessions: 1,
      cpuPercent: 5,
      memoryUsedMb: 100,
      memoryTotalMb: 1000,
    }),
    modelInfo: vi.fn().mockResolvedValue({ model: 'gpt-5.5', provider: 'openai-codex', capabilities: {} }),
    pushStatus: vi.fn().mockResolvedValue({ available: false, enabled: false, reason: 'missing VAPID', subscriptions: [] }),
    pushSubscribe: vi.fn().mockResolvedValue({ id: 'sha256:sub', enabled: true }),
    pushUnsubscribe: vi.fn().mockResolvedValue({ ok: true }),
    pushTest: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  }) as unknown as import('@hermes-pwa/core').RestClient;

describe('Settings (M14)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 Chrome' });
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Linux x86_64' });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 });
    useProfilesStore.setState({
      profiles: [{ name: 'default', displayName: 'Default', provider: 'openai-codex', model: 'gpt-5.5', isActive: true }],
      activeName: 'default',
      currentName: 'default',
      loading: false,
      error: undefined,
    });
    useModelStore.setState({ options: undefined, info: undefined, auxiliary: undefined, loading: false, setting: false, error: undefined });
  });

  it('renders the M14 groups: Connection, Notifications, Appearance, About', async () => {
    render(<Settings rest={makeRest()} onNavigate={vi.fn()} onLogout={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Connection')).toBeInTheDocument());
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
    expect(screen.getByText('Gateway URL')).toBeInTheDocument();
    expect(screen.getByText('Enable on this device')).toBeInTheDocument();
    expect(screen.getByText('Approval requests')).toBeInTheDocument();
    expect(screen.getByText('Runs completed')).toBeInTheDocument();
    expect(screen.getByText('Theme')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('shows PWA and gateway versions in About', async () => {
    const rest = makeRest();
    render(<Settings rest={rest} onNavigate={vi.fn()} onLogout={vi.fn()} />);
    await waitFor(() => expect(rest.systemStats).toHaveBeenCalled());
    expect(screen.getByText(`Hermes PWA v${HERMES_PWA_RELEASE_VERSION}`)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Gateway v0.16.0 · plugin hermes-pwa')).toBeInTheDocument());
  });

  it('shows the active model as managed in Profiles and deep-links to profiles', async () => {
    const onNavigate = vi.fn();
    render(<Settings rest={makeRest()} onNavigate={onNavigate} onLogout={vi.fn()} />);
    const row = await screen.findByRole('button', { name: /Manage model in Profiles/i });
    expect(screen.getByText('gpt-5.5 · managed in Profiles')).toBeInTheDocument();
    expect(screen.getByText('Profiles ›')).toBeInTheDocument();
    fireEvent.click(row);
    expect(onNavigate).toHaveBeenCalledWith('profiles');
  });

  it('renders the device push toggle on when this browser is subscribed', async () => {
    vi.mocked(currentPushSubscriptionId).mockResolvedValueOnce('sha256:sub');
    const rest = makeRest({
      pushStatus: vi.fn().mockResolvedValue({
        available: true,
        enabled: true,
        vapidPublicKey: 'public-key',
        subscriptions: [{ id: 'sha256:sub', enabled: true, profile: 'default', label: 'iPhone' }],
      }),
    });
    render(<Settings rest={rest} onNavigate={vi.fn()} onLogout={vi.fn()} />);
    await waitFor(() => expect(rest.pushStatus).toHaveBeenCalledWith('default'));
    const toggle = await screen.findByRole('switch', { name: 'Enable notifications on this device' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });

  it('unsubscribes this device when the push toggle is switched off', async () => {
    vi.mocked(currentPushSubscriptionId).mockResolvedValue('sha256:sub');
    const rest = makeRest({
      pushStatus: vi.fn().mockResolvedValue({
        available: true,
        enabled: true,
        vapidPublicKey: 'public-key',
        subscriptions: [{ id: 'sha256:sub', enabled: true, profile: 'default', label: 'iPhone' }],
      }),
    });
    render(<Settings rest={rest} onNavigate={vi.fn()} onLogout={vi.fn()} />);
    const toggle = await screen.findByRole('switch', { name: 'Enable notifications on this device' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(toggle);
    await waitFor(() => expect(rest.pushUnsubscribe).toHaveBeenCalledWith({ id: 'sha256:sub' }, 'default'));
  });

  it('defaults Approval requests on and Runs completed off, and persists changes', async () => {
    render(<Settings rest={makeRest()} onNavigate={vi.fn()} onLogout={vi.fn()} />);
    const approvals = await screen.findByRole('switch', { name: 'Approval request notifications' });
    const runs = screen.getByRole('switch', { name: 'Run completion notifications' });
    expect(approvals).toHaveAttribute('aria-checked', 'true');
    expect(runs).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(approvals);
    expect(approvals).toHaveAttribute('aria-checked', 'false');
    expect(window.localStorage.getItem('hermes-pwa.notifyApprovals.v1')).toBe('0');

    fireEvent.click(runs);
    expect(runs).toHaveAttribute('aria-checked', 'true');
    expect(window.localStorage.getItem('hermes-pwa.notifyRuns.v1')).toBe('1');
  });

  it('opens the theme sheet and applies any option', async () => {
    render(<Settings rest={makeRest()} onNavigate={vi.fn()} onLogout={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Theme: System/i }));
    // sheet lists all six options
    for (const label of ['System', 'Light', 'Dark', 'Dark · Indigo', 'Dark · Mocha', 'Dark · Graphite']) {
      expect(await screen.findByRole('button', { name: `Use ${label} theme` })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Use Light theme' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Theme: Light/i })).toBeInTheDocument());
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('hermes-pwa.theme.v1')).toBe('light');

    fireEvent.click(screen.getByRole('button', { name: /Theme: Light/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use Dark · Mocha theme' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Theme: Dark · Mocha/i })).toBeInTheDocument());
    expect(document.documentElement.dataset.theme).toBe('dark-mocha');

    fireEvent.click(screen.getByRole('button', { name: /Theme: Dark · Mocha/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use Dark · Indigo theme' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Theme: Dark · Indigo/i })).toBeInTheDocument());
    expect(document.documentElement.dataset.theme).toBe('dark-indigo');

    fireEvent.click(screen.getByRole('button', { name: /Theme: Dark · Indigo/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use System theme' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Theme: System/i })).toBeInTheDocument());
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('calls onLogout from the red Log out button', async () => {
    const onLogout = vi.fn();
    render(<Settings rest={makeRest()} onNavigate={vi.fn()} onLogout={onLogout} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(onLogout).toHaveBeenCalled();
  });

  it('shows error when stats fail to load', async () => {
    const rest = makeRest({ systemStats: vi.fn().mockRejectedValue(new Error('stats error')) });
    render(<Settings rest={rest} onNavigate={vi.fn()} onLogout={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('stats error')).toBeInTheDocument());
  });
});
