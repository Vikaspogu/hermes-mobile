import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AppShell } from './AppShell';
import { useActivityStore, useConnectionStore, useProfilesStore, useProjectsStore, useChatStore, useSessionsStore, makeRpcEvents } from '@hermes-pwa/core';

const rpcMock = {
  request: vi.fn(),
  onFrame: vi.fn(),
  events: makeRpcEvents(),
} as unknown as import('@hermes-pwa/core').RpcClient;

const restMock = {
  status: vi.fn(),
  providers: vi.fn(),
  passwordLogin: vi.fn(),
  me: vi.fn(),
  wsTicket: vi.fn(),
  logout: vi.fn(),
  kanbanBoards: vi.fn().mockResolvedValue([]),
  kanbanBoard: vi.fn().mockResolvedValue({ slug: '', name: '', columns: [] }),
  kanbanComment: vi.fn(),
  profileSessions: vi.fn().mockResolvedValue([]),
  sessionMessages: vi.fn().mockResolvedValue({ messages: [] }),
  setActiveProfile: vi.fn(),
  profileList: vi.fn().mockResolvedValue([]),
  profileActive: vi.fn().mockRejectedValue(new Error('none')),
  profileActivate: vi.fn(),
  systemStats: vi.fn().mockResolvedValue({}),
  opsRun: vi.fn().mockResolvedValue({ status: 'ok' }),
  gatewayAction: vi.fn().mockResolvedValue({ ok: true, name: 'gateway-restart' }),
  actionStatus: vi.fn().mockResolvedValue({ name: 'doctor', running: false, exitCode: 0, lines: [] }),
  pendingActions: vi.fn().mockResolvedValue([]),
  pushStatus: vi.fn().mockResolvedValue({ available: false, enabled: false, reason: 'test', subscriptions: [] }),
  pushSubscribe: vi.fn().mockResolvedValue({ id: 'sha256:test', enabled: true }),
  pushUnsubscribe: vi.fn().mockResolvedValue({ ok: true }),
  pushTest: vi.fn().mockResolvedValue({ ok: true }),
  updateCheck: vi.fn().mockResolvedValue({
    ok: true,
    current: '0.1.0',
    latest: '0.1.0',
    source: 'npm',
    updateAvailable: false,
    canApply: false,
    manualRequired: false,
    installMethod: 'unknown',
    instructions: [],
  }),
  opsCheckpoints: vi.fn().mockResolvedValue([]),
  opsBackups: vi.fn().mockResolvedValue([]),
  cronJobs: vi.fn().mockResolvedValue([]),
  sessionArtifacts: vi.fn().mockResolvedValue([]),
  envList: vi.fn().mockResolvedValue([]),
  mcpServers: vi.fn().mockResolvedValue([]),
  mcpToggle: vi.fn().mockResolvedValue('submitted'),
  skillsList: vi.fn().mockResolvedValue([]),
} as unknown as import('@hermes-pwa/core').RestClient;

describe('AppShell', () => {
  beforeEach(() => {
    localStorage.clear();
    useConnectionStore.setState({ state: 'connected', error: undefined } as ReturnType<typeof useConnectionStore.getState>);
    useProfilesStore.setState({ profiles: [], activeName: undefined, currentName: undefined, loading: false, error: undefined });
    useProjectsStore.setState({ boards: [], activeBoardSlug: undefined, tasks: [], workers: [], loading: false, error: undefined });
    useChatStore.setState({ sessionId: undefined, storedSessionId: undefined, messages: [], streaming: false, error: undefined });
    useSessionsStore.setState({ sessions: [], loading: false, error: undefined, pinnedIds: [] });
    useActivityStore.setState({ items: [], loading: false, error: undefined });
    vi.clearAllMocks();
    vi.mocked(restMock.profileSessions).mockResolvedValue([]);
    vi.mocked(restMock.sessionMessages).mockResolvedValue({ messages: [] });
    vi.mocked(restMock.profileList).mockResolvedValue([]);
    vi.mocked(restMock.profileActive).mockRejectedValue(new Error('none'));
    vi.mocked(restMock.systemStats).mockResolvedValue({});
    vi.mocked(restMock.pendingActions).mockResolvedValue([]);
    vi.mocked(restMock.pushStatus).mockResolvedValue({ available: false, enabled: false, reason: 'test', subscriptions: [] });
    vi.mocked(restMock.pushSubscribe).mockResolvedValue({ id: 'sha256:test', enabled: true });
    vi.mocked(restMock.updateCheck).mockResolvedValue({
      ok: true,
      current: '0.1.0',
      latest: '0.1.0',
      source: 'npm',
      updateAvailable: false,
      canApply: false,
      manualRequired: false,
      installMethod: 'unknown',
      instructions: [],
    });
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });

  it('renders the chats screen by default', () => {
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    expect(screen.getByRole('heading', { name: 'Chats' })).toBeInTheDocument();
  });

  it('restarts forward and back transitions without remounting the tab bar', async () => {
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    const initialMain = screen.getByRole('main');
    const tabs = screen.getByRole('navigation', { name: 'Primary' });
    expect(initialMain).not.toHaveClass('hm-screen-enter-forward');

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('main')).toBe(initialMain);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'More' })).getByRole('button', { name: /Settings/ }));
    const forwardMain = screen.getByRole('main');
    expect(forwardMain).toHaveClass('hm-screen-enter-forward');
    expect(forwardMain).not.toBe(initialMain);
    await screen.findByRole('heading', { name: 'Settings' });

    fireEvent.click(screen.getByRole('button', { name: 'Back to Chats' }));
    await waitFor(() => expect(screen.getByRole('main')).toHaveClass('hm-screen-enter-back'));
    const backMain = screen.getByRole('main');
    expect(backMain).not.toBe(forwardMain);
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBe(tabs);

    fireEvent.click(screen.getByRole('button', { name: 'Inbox' }));
    expect(screen.getByRole('main')).toHaveClass('hm-screen-enter-forward');
    expect(screen.getByRole('main')).not.toBe(backMain);
  });

  it('keeps the current screen mounted when a back press dismisses the More sheet', async () => {
    window.localStorage.setItem('hermes-mobile-screen', 'settings');
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    await screen.findByRole('heading', { name: 'Settings' });
    const main = screen.getByRole('main');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.popState(window);
    await waitFor(() => expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'false'));
    expect(screen.getByRole('main')).toBe(main);
    expect(main).not.toHaveClass('hm-screen-enter-back');
  });

  it('header back button works after a cold-start restore into a thread', async () => {
    // Cold start straight into a restored chat: the fresh document has one
    // history entry, so without the mount-time history rebuild the back
    // button (window.history.back()) is a silent no-op.
    window.localStorage.setItem('hermes-mobile-screen', 'chat');
    window.localStorage.setItem('hermes-pwa.activeSession.v3', JSON.stringify({ storedSessionId: 'sess-1' }));
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    const back = await screen.findByRole('button', { name: /back to chats/i });
    const header = screen.getByTestId('app-header');
    expect(header).toHaveClass('hm-header--sub');
    fireEvent.click(back);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Chats' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /back to/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('app-header')).not.toHaveClass('hm-header--sub');
  });

  it('shows update notification when backend reports a newer version', async () => {
    vi.mocked(restMock.updateCheck).mockResolvedValue({
      ok: true,
      current: '0.1.0',
      latest: '0.1.1',
      source: 'npm',
      updateAvailable: true,
      canApply: false,
      manualRequired: true,
      installMethod: 'unknown',
      instructions: [
        {
          id: 'web-ui-force-reinstall',
          label: 'Hermes Web UI / Git URL',
          steps: ['Open Hermes Web UI → Plugins', 'Enable Force reinstall'],
        },
        {
          id: 'npx-force-reinstall',
          label: 'npm / npx',
          command: 'npx -y hermes-pwa@latest install --force',
          steps: ['Run the command on the Hermes host'],
        },
      ],
    });

    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);

    await waitFor(() => expect(screen.getByTestId('update-notification')).toBeInTheDocument());
    expect(screen.getByText('Hermes PWA 0.1.0 → 0.1.1')).toBeInTheDocument();
    expect(screen.getAllByText('npx -y hermes-pwa@latest install --force')[0]).toBeInTheDocument();
  });

  it('does not show update notification when backend reports current version', async () => {
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);

    await waitFor(() => expect(restMock.updateCheck).toHaveBeenCalled());
    expect(screen.queryByTestId('update-notification')).not.toBeInTheDocument();
  });

  it('dismisses update notification for the reported latest version', async () => {
    vi.mocked(restMock.updateCheck).mockResolvedValue({
      ok: true,
      current: '0.1.0',
      latest: '0.1.1',
      source: 'npm',
      updateAvailable: true,
      canApply: false,
      manualRequired: true,
      installMethod: 'unknown',
      instructions: [],
    });

    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);

    await waitFor(() => expect(screen.getByTestId('update-notification')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this version' }));

    await waitFor(() => expect(screen.queryByTestId('update-notification')).not.toBeInTheDocument());
    expect(localStorage.getItem('hermes-pwa:update-dismissed-version')).toBe('0.1.1');
  });

  it('does not crash when update check fails', async () => {
    vi.mocked(restMock.updateCheck).mockRejectedValue(new Error('registry down'));

    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);

    await waitFor(() => expect(restMock.updateCheck).toHaveBeenCalled());
    expect(screen.queryByTestId('update-notification')).not.toBeInTheDocument();
  });

  it('does not show unstable gateway/model status chips on Home', () => {
    useProfilesStore.setState({
      profiles: [{ name: 'default', displayName: 'Default', model: 'GPT-5.5', isActive: true }],
      activeName: 'default',
      currentName: 'default',
      loading: false,
      error: undefined,
    });

    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);

    expect(screen.getByRole('heading', { name: 'Chats' })).toBeInTheDocument();
    expect(screen.queryByText('Gateway ready')).not.toBeInTheDocument();
    expect(screen.queryByText('GPT-5.5')).not.toBeInTheDocument();
    expect(document.querySelector('.hm-home__chips')).not.toBeInTheDocument();
  });

  it('keeps Home recent preview free of status dot and chevron clutter', () => {
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);

    act(() => {
      useSessionsStore.setState({
        sessions: [
          {
            id: 'recent-1',
            title: 'Recent work',
            profile: 'default',
            messageCount: 3,
            updatedAt: Date.now(),
            active: false,
            isActive: false,
          },
        ],
        loading: false,
        error: undefined,
        pinnedIds: [],
      });
    });

    const row = screen.getByText('Recent work').closest('[data-testid="thread-row"]')!;
    expect(row).toHaveTextContent('Recent work');
    expect(row).toHaveTextContent('3 msgs');
  });

  it('starts a new chat from the home FAB', async () => {
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    expect(screen.getByRole('heading', { name: 'Chats' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('chats-new-chat'));

    await waitFor(() => expect(screen.getByLabelText('Message input')).toBeInTheDocument());
  });

  it('shows the tab bar with Chats active', () => {
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    expect(screen.getByRole('heading', { name: 'Chats' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('button', { name: 'Chats' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'Inbox' })).toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: 'Work' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('opens and closes the More sheet', async () => {
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const sheet = screen.getByRole('dialog', { name: 'More' });
    expect(within(sheet).getByRole('button', { name: /Profiles/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /Agents/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /Settings/ })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument(),
    );
  });

  it('hides undecided administrative surfaces from the More sheet', () => {
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const sheet = screen.getByRole('dialog', { name: 'More' });
    expect(within(sheet).queryByRole('button', { name: 'Skills & Tools' })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Messaging' })).not.toBeInTheDocument();
    expect(within(sheet).queryByText('Telegram')).not.toBeInTheDocument();
  });

  it('does not restore hidden administrative screens from localStorage', () => {
    localStorage.setItem('hermes-mobile-screen', 'skills');
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    expect(screen.getByRole('heading', { name: 'Chats' })).toBeInTheDocument();
    expect(restMock.skillsList).not.toHaveBeenCalled();

    localStorage.clear();
    vi.clearAllMocks();
    localStorage.setItem('hermes-mobile-screen', 'messaging');
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    expect(screen.getAllByRole('heading', { name: 'Chats' })).toHaveLength(2);
  });

  it('shows Profiles first in the More sheet and opens it', async () => {
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const sheet = screen.getByRole('dialog', { name: 'More' });
    const firstRow = sheet.querySelector('.hm-more-row');
    expect(firstRow).toHaveTextContent('Profiles');

    fireEvent.click(within(sheet).getByRole('button', { name: /Profiles/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Profiles' })).toBeInTheDocument());
  });

  it('filters chats by search', async () => {
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    act(() => {
      useSessionsStore.setState({
        sessions: [
          { id: 'cli-1', title: 'CLI case', messageCount: 3, updatedAt: Date.now(), profile: 'default' },
          { id: 'tui-1', title: 'TUI case', messageCount: 2, updatedAt: Date.now(), profile: 'default' },
        ],
        loading: false,
        error: undefined,
        pinnedIds: [],
      });
    });

    expect(screen.getByText('CLI case')).toBeInTheDocument();
    expect(screen.getByText('TUI case')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('chats-search'), { target: { value: 'tui' } });
    expect(screen.getByText('TUI case')).toBeInTheDocument();
    expect(screen.queryByText('CLI case')).not.toBeInTheDocument();
  });

  it('filters chats with the Threads / Cron / All chips', () => {
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    act(() => {
      useSessionsStore.setState({
        sessions: [
          { id: 'cli-1', title: 'CLI case', messageCount: 3, updatedAt: Date.now(), profile: 'default' },
          {
            id: 'cron_abc_20261021_060000',
            title: 'daily-lessons · 6:00 AM',
            source: 'cron',
            messageCount: 2,
            updatedAt: Date.now(),
            profile: 'default',
          },
        ],
        loading: false,
        error: undefined,
        pinnedIds: [],
      });
    });

    // Default chip is Threads: cron runs stay hidden.
    expect(screen.getByText('CLI case')).toBeInTheDocument();
    expect(screen.queryByText('daily-lessons · 6:00 AM')).not.toBeInTheDocument();

    // Cron chip shows only cron runs, with a Cron tag on the row.
    fireEvent.click(screen.getByTestId('chats-filter-cron'));
    expect(screen.queryByText('CLI case')).not.toBeInTheDocument();
    const cronRow = screen.getByText('daily-lessons · 6:00 AM').closest('[data-testid="thread-row"]')!;
    expect(cronRow).toHaveTextContent('Cron');

    // All shows both kinds.
    fireEvent.click(screen.getByTestId('chats-filter-all'));
    expect(screen.getByText('CLI case')).toBeInTheDocument();
    expect(screen.getByText('daily-lessons · 6:00 AM')).toBeInTheDocument();
  });

  it('navigates via the tab bar and updates title', async () => {
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inbox' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument(),
    );
  });

  it('navigates to settings screen via the More sheet', async () => {
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument(),
    );
  });

  it('shows the active model on the Profiles row and opens Profiles', async () => {
    vi.mocked(restMock.profileList).mockResolvedValue([
      { name: 'default', displayName: 'default', provider: 'openai-codex', model: 'gpt-5.5', isActive: true },
    ] as unknown as import('@hermes-pwa/core').Profile[]);
    vi.mocked(restMock.profileActive).mockResolvedValue({ active: 'default', current: 'default' });

    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const sheet = await screen.findByRole('dialog', { name: 'More' });

    await waitFor(() => expect(within(sheet).getByText(/gpt-5.5/)).toBeInTheDocument());

    fireEvent.click(within(sheet).getByRole('button', { name: /Profiles/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Profiles' })).toBeInTheDocument());
  });

  it('opens system status from the More sheet', async () => {
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const sheet = await screen.findByRole('dialog', { name: 'More' });
    await waitFor(() => expect(within(sheet).getByText(/Gateway ready/i)).toBeInTheDocument());

    fireEvent.click(within(sheet).getByRole('button', { name: /System/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'System' })).toBeInTheDocument());
  });

  it('shows the gateway health summary in the More sheet', async () => {
    vi.mocked(restMock.systemStats).mockResolvedValue({
      uptimeSeconds: 22320,
      cpuPercent: 18,
      memoryUsedMb: 2150,
      memoryTotalMb: 8192,
      diskUsedMb: 59392,
      diskTotalMb: 102400,
    } as unknown as import('@hermes-pwa/core').SystemStats);
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const sheet = await screen.findByRole('dialog', { name: 'More' });
    await waitFor(() => expect(within(sheet).getByTestId('more-health')).toBeInTheDocument());
    expect(within(sheet).getByText(/Gateway running · up 6h 12m/)).toBeInTheDocument();
    expect(within(sheet).getByText(/CPU 18\.0% · RAM 2\.1 GB \/ 8\.0 GB/)).toBeInTheDocument();
  });

  it('hides the status chip when connected and the gateway is healthy', async () => {
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    await waitFor(() => expect(screen.queryByTestId('status-chip')).not.toBeInTheDocument());
  });

  it('restores the last screen from localStorage', () => {
    localStorage.setItem('hermes-mobile-screen', 'settings');
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('restores Kanban from localStorage instead of falling back to Home/New chat', async () => {
    localStorage.setItem('hermes-mobile-screen', 'kanban');
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    expect(screen.getByRole('heading', { name: 'Work' })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('hermes-mobile-screen')).toBe('kanban'));
  });

  it('keeps the current screen persisted when the PWA is backgrounded or closed', async () => {
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inbox' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument());
    localStorage.removeItem('hermes-mobile-screen');
    window.dispatchEvent(new Event('pagehide'));
    expect(localStorage.getItem('hermes-mobile-screen')).toBe('approvals');
  });

  it('persists screen to localStorage when navigating', async () => {
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: /Agents/ }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Agents' })).toBeInTheDocument(),
    );
    expect(localStorage.getItem('hermes-mobile-screen')).toBe('agents');
  });

  it('opens a chat thread with the selected session profile', async () => {
    useProfilesStore.setState({
      profiles: [{ name: 'default', displayName: 'default', isActive: true }],
      activeName: 'default',
      currentName: 'default',
      loading: false,
      error: undefined,
    });
    vi.mocked(restMock.profileSessions).mockResolvedValue([
      { id: 'sess-2', title: 'Other profile session', profile: 'research', messageCount: 2, updatedAt: Date.now() },
    ] as unknown as import('@hermes-pwa/core').Session[]);
    const resume = vi.spyOn(useChatStore.getState(), 'resumeSessionIntoChat').mockResolvedValue(undefined);

    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);
    await waitFor(() => expect(screen.getByText(/Other profile session/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Other profile session/));

    await waitFor(() =>
      expect(resume).toHaveBeenCalledWith(restMock, rpcMock, 'sess-2', 'research'),
    );
  });

  it('captures approval events globally while chat is open and responds with backend session choice', async () => {
    localStorage.setItem('hermes-mobile-screen', 'chat');
    localStorage.setItem(
      'hermes-pwa.activeSession.v4:default',
      JSON.stringify({
        profile: 'default',
        sessionId: 'sess-approval-1',
        storedSessionId: 'stored-approval-1',
        messages: [{ id: 'a-1', role: 'assistant', text: '', toolCalls: [{ id: 'tool-approval-1', name: 'terminal' }] }],
      }),
    );
    useChatStore.setState({
      sessionId: 'sess-approval-1',
      storedSessionId: 'stored-approval-1',
      streaming: true,
      messages: [
        {
          id: 'a-1',
          role: 'assistant',
          text: '',
          createdAt: undefined,
          toolCalls: [{ id: 'tool-approval-1', name: 'terminal' }],
        },
      ],
      error: undefined,
    });
    vi.mocked(rpcMock.request).mockResolvedValue({ resolved: 1 });
    vi.mocked(restMock.sessionMessages).mockResolvedValue({
      messages: [
        {
          id: 'a-1',
          role: 'assistant',
          text: '',
          tool_calls: [{ id: 'tool-approval-1', name: 'terminal' }],
        },
      ],
    });
    useConnectionStore.setState({ state: 'reconnecting', error: undefined } as ReturnType<typeof useConnectionStore.getState>);
    render(<AppShell connectionState="reconnecting" rpc={rpcMock} rest={restMock} />);
    await waitFor(() => expect(screen.getAllByText(/Running command|Ran command/).length).toBeGreaterThanOrEqual(1));

    rpcMock.events.dispatchEvent({
      type: 'approval.request',
      sessionId: 'sess-approval-1',
      payload: {
        id: 'approval-1',
        command: 'systemctl --user restart hermes-dashboard',
        description: 'Dangerous command approval required',
        pattern_key: 'systemctl-restart',
      },
    });

    await waitFor(() => expect(screen.getByText(/systemctl --user restart hermes-dashboard/)).toBeInTheDocument());

    // Redesign: the pending tool row claims the approval inline; the sticky
    // dock stays hidden to avoid a duplicate surface.
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() =>
      expect(rpcMock.request).toHaveBeenCalledWith('approval.respond', {
        choice: 'once',
        session_id: 'sess-approval-1',
      }),
    );
  });

  it('keeps approval events visible on the approvals screen even if they arrive elsewhere', async () => {
    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);

    rpcMock.events.dispatchEvent({
      type: 'approval.request',
      sessionId: 'sess-approval-2',
      payload: {
        id: 'approval-2',
        command: 'rm -rf /tmp/test',
        description: 'Dangerous command approval required',
        pattern_key: 'rm-rf',
      },
    });

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await waitFor(() => expect(within(nav).getByText('1')).toBeInTheDocument());
    fireEvent.click(within(nav).getByRole('button', { name: /Inbox/ }));

    await waitFor(() => expect(screen.getByText(/rm -rf \/tmp\/test/)).toBeInTheDocument());
  });

  it('hydrates pending approvals when a push opens the approvals screen cold', async () => {
    window.location.hash = '#/approvals';
    vi.mocked(restMock.pendingActions).mockResolvedValue([
      {
        id: 'approval:push-open',
        kind: 'approval',
        status: 'needs_you',
        title: 'Approval required',
        highImpact: true,
        sessionId: 'gateway-session-key',
        summary: 'rm -rf /tmp/from-push\nDangerous command approval required',
        createdAt: Date.now(),
      },
    ] as import('@hermes-pwa/core').Approval[]);

    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);

    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    await waitFor(() => expect(restMock.pendingActions).toHaveBeenCalledWith('default'));
    expect(await screen.findByText(/rm -rf \/tmp\/from-push/)).toBeInTheDocument();
  });

  it('recovers the cached active chat history even when push opens approvals instead of mounting Chat', async () => {
    window.location.hash = '#/approvals';
    useChatStore.setState({
      sessionId: 'live-from-cache',
      storedSessionId: 'stored-from-cache',
      streaming: true,
      messages: [
        { id: 'u-1', role: 'user', text: 'trigger approval', createdAt: 1 },
        {
          id: 'a-local',
          role: 'assistant',
          text: '',
          createdAt: 2,
          toolCalls: [{ id: 'tool-local', name: 'terminal', input: { command: 'rm -rf /tmp/from-push' } }],
        },
      ],
      error: undefined,
      cacheProfile: 'default',
    });
    vi.mocked(restMock.sessionMessages).mockResolvedValue({
      session_id: 'stored-from-cache',
      messages: [
        { id: 'u-1', role: 'user', text: 'trigger approval', created_at: 1 },
        { id: 'a-rest', role: 'assistant', text: 'waiting for approval', created_at: 2 },
      ],
    });

    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);

    await waitFor(() => expect(restMock.sessionMessages).toHaveBeenCalledWith('stored-from-cache', 'default'));
    await waitFor(() => expect(useChatStore.getState().messages.some((message) => message.text === 'waiting for approval')).toBe(true));
    expect(useChatStore.getState().streaming).toBe(false);
  });

  it('syncs an existing browser push subscription after connected startup using the active profile', async () => {
    useProfilesStore.setState({
      profiles: [{ name: 'dev', displayName: 'Dev', isActive: true }],
      activeName: 'dev',
      currentName: 'dev',
      loading: false,
      error: undefined,
    });
    vi.mocked(restMock.pushStatus).mockResolvedValue({
      available: true,
      enabled: true,
      vapidPublicKey: 'test-public-key',
      subscriptions: [],
    });
    const subscription = {
      endpoint: 'https://push.example/new-endpoint',
      toJSON: () => ({ endpoint: 'https://push.example/new-endpoint', keys: { p256dh: 'p', auth: 'a' } }),
    };
    vi.stubGlobal('Notification', { permission: 'granted' });
    vi.stubGlobal('PushManager', function PushManager() {});
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(subscription),
          },
        }),
      },
    });

    render(<AppShell connectionState="connected" rpc={rpcMock} rest={restMock} />);

    await waitFor(() => expect(restMock.pushSubscribe).toHaveBeenCalledWith(
      { subscription: subscription.toJSON(), label: 'Hermes Mobile' },
      'dev',
    ));
  });

  it('shows status chip for reconnecting state and renders a single header retry pill after grace period', () => {
    vi.useFakeTimers();
    try {
      const onRetry = vi.fn();
      window.location.hash = '';
      useConnectionStore.setState({ state: 'reconnecting', error: 'Live updates disconnected.' });
      render(<AppShell connectionState="reconnecting" rpc={rpcMock} rest={restMock} onRetry={onRetry} />);
      const chip = screen.getByTestId('status-chip');
      expect(within(chip).getByText(/reconnecting/i)).toBeInTheDocument();
      expect(screen.queryByTestId('connection-banner')).toBeNull();

      act(() => {
        vi.advanceTimersByTime(1500);
      });
      const homeBanners = screen.getAllByTestId('connection-banner');
      expect(homeBanners).toHaveLength(1);
      expect(homeBanners[0]?.closest('.hm-home__header')).not.toBeNull();
      fireEvent.click(within(homeBanners[0]!).getByRole('button', { name: /Retry now/i }));
      expect(onRetry).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId('chats-new-chat'));
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      const chatBanners = screen.getAllByTestId('connection-banner');
      expect(chatBanners).toHaveLength(1);
      expect(chatBanners[0]?.closest('.hm-chat-header')).not.toBeNull();
      fireEvent.click(within(chatBanners[0]!).getByRole('button', { name: /Retry now/i }));
      expect(onRetry).toHaveBeenCalledTimes(2);

      fireEvent.click(screen.getByRole('button', { name: 'Inbox' }));
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      const inboxBanners = screen.getAllByTestId('connection-banner');
      expect(inboxBanners).toHaveLength(1);
      expect(inboxBanners[0]?.closest('.hm-header__right')).not.toBeNull();
      fireEvent.click(within(inboxBanners[0]!).getByRole('button', { name: /Retry now/i }));
      expect(onRetry).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
