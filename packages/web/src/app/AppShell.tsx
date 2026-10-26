import { startTransition, Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { Approval, Clarify, ConnectionState, RpcClient, RestClient, RpcEvent, SystemStats, UpdateCheck } from '@hermes-pwa/core';
import { connectionStateLabel, useActivityStore, useProfilesStore, useSessionsStore, useChatStore, useConnectionStore, useProjectsStore } from '@hermes-pwa/core';
import { Chats } from '../screens/Chats';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { Icon, type IconName } from '../components/Icon';
import { BrandMark } from '../components/BrandMark';
import { UpdateNotification } from '../components/UpdateNotification';
import { LazyScreenErrorBoundary } from './LazyScreenErrorBoundary';
import { usePresence } from '../hooks/usePresence';
import { getInitialScreen, persistScreen, screenFromLocationHash, sessionFromLocationHash } from '../lib/screenStorage';
import { dismissTopBackLayer, registerBackLayer } from '../lib/backLayers';
import { fmtGb, fmtPercent, fmtUptime } from '../lib/formatStats';
import { HERMES_PWA_VERSION_LABEL } from './version';
import { syncPushSubscription } from '../pwa/push';
import '../styles/screens/more.css';
import '../styles/screens/offline.css';
import '../styles/screen-transitions.css';

export type Screen =
  | 'home'
  | 'chat'
  | 'sessions'
  | 'approvals'
  | 'kanban'
  | 'agents'
  | 'profiles'
  | 'cron'
  | 'artifacts'
  | 'skills'
  | 'command'
  | 'settings'
  | 'voice';

interface AppShellProps {
  connectionState: ConnectionState;
  rpc: RpcClient;
  rest: RestClient;
  onRetry?: () => void;
  connectionError?: string | undefined;
}

const UPDATE_DISMISSED_STORAGE_KEY = 'hermes-pwa:update-dismissed-version';

const Chat = lazy(() => import('../screens/Chat').then((module) => ({ default: module.Chat })));
const Activity = lazy(() => import('../screens/Activity').then((module) => ({ default: module.Activity })));
const Projects = lazy(() => import('../screens/Projects').then((module) => ({ default: module.Projects })));
const Agents = lazy(() => import('../screens/Agents').then((module) => ({ default: module.Agents })));
const Profiles = lazy(() => import('../screens/Profiles').then((module) => ({ default: module.Profiles })));
const Sessions = lazy(() => import('../screens/Sessions').then((module) => ({ default: module.Sessions })));
const CommandCenter = lazy(() => import('../screens/CommandCenter').then((module) => ({ default: module.CommandCenter })));
const Cron = lazy(() => import('../screens/Cron').then((module) => ({ default: module.Cron })));
const Artifacts = lazy(() => import('../screens/Artifacts').then((module) => ({ default: module.Artifacts })));
const Settings = lazy(() => import('../screens/Settings').then((module) => ({ default: module.Settings })));
const Voice = lazy(() => import('../screens/Voice').then((module) => ({ default: module.Voice })));

function eventPayload(event: RpcEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === 'object'
    ? (event.payload as Record<string, unknown>)
    : {};
}

function approvalFromEvent(event: RpcEvent): Approval {
  const d = eventPayload(event);
  const command = typeof d.command === 'string' ? d.command : '';
  const description = typeof d.description === 'string' ? d.description : '';
  const patternKey = typeof d.pattern_key === 'string' ? d.pattern_key : '';
  const item: Approval = {
    id: typeof d.id === 'string'
      ? d.id
      : `approval-${event.sessionId ?? 'global'}-${patternKey || Date.now()}`,
    kind: 'approval',
    status: 'needs_you',
    title: typeof d.title === 'string' ? d.title : 'Approval required',
    highImpact: Boolean(d.high_impact ?? d.highImpact ?? true),
    createdAt: Date.now(),
  };
  if (event.sessionId) item.sessionId = event.sessionId;
  if (typeof d.session === 'string') item.session = d.session;
  else if (event.sessionId) item.session = `Session ${event.sessionId.slice(0, 8)}`;
  const summary = [command, description].filter(Boolean).join('\n');
  if (summary) item.summary = summary;
  if (typeof d.visibility === 'string' && (d.visibility === 'private' || d.visibility === 'public')) {
    item.visibility = d.visibility;
  } else {
    item.visibility = 'private';
  }
  return item;
}

function clarifyFromEvent(event: RpcEvent): Clarify {
  const d = eventPayload(event);
  const item: Clarify = {
    id: typeof d.id === 'string' ? d.id : `clarify-${event.sessionId ?? 'global'}-${Date.now()}`,
    kind: 'clarify',
    status: 'needs_you',
    title: typeof d.title === 'string' ? d.title : 'Clarification needed',
    question: typeof d.question === 'string' ? d.question : '',
    createdAt: Date.now(),
  };
  if (event.sessionId) item.sessionId = event.sessionId;
  return item;
}

const HIDDEN_ADMIN_SCREENS = new Set<Screen>([
  // TODO: Skills/Tools is temporarily hidden from the PWA until we decide
  // whether this administrative surface belongs in the mobile app.
  // Keep the screen modules in the codebase, but block stale/internal navigation
  // from opening them in the production shell for now.
  'skills',
]);

const SCREEN_TITLES: Record<Screen, string> = {
  home: 'Chats',
  chat: 'Chat',
  voice: 'Voice',
  sessions: 'Sessions',
  approvals: 'Inbox',
  kanban: 'Work',  agents: 'Agents',
  profiles: 'Profiles',
  cron: 'Work',
  artifacts: 'Artifacts',
  skills: 'Skills',
  command: 'System',
  settings: 'Settings',
};

type GatewayHealth = 'checking' | 'running' | 'unavailable';

function StatusChip({ state, gatewayHealth }: { state: ConnectionState; gatewayHealth: GatewayHealth }) {
  const isOk = state === 'connected';
  const isWarn = state === 'reconnecting' || state === 'ticketing';
  const gatewayWarning = isOk && gatewayHealth !== 'running';
  const color = isOk
    ? gatewayWarning
      ? 'var(--hm-color-warning)'
      : 'var(--hm-color-success)'
    : isWarn
      ? 'var(--hm-color-warning)'
      : 'var(--hm-color-danger)';
  const label = isOk
    ? gatewayHealth === 'running'
      ? 'System OK'
      : gatewayHealth === 'checking'
        ? 'Checking'
        : 'Gateway ?'
    : connectionStateLabel(state);
  return (
    <div className="hm-status-chip" data-testid="status-chip" style={{ borderColor: 'var(--hm-color-border)' }}>
      <span
        className="hm-status-chip__dot"
        style={{ background: color, animation: isOk && !gatewayWarning ? 'hm-pulse 2s infinite' : undefined }}
      />
      <span className="hm-status-chip__label">{label}</span>
    </div>
  );
}

function gatewayStatusLabel(state: ConnectionState, gatewayHealth: GatewayHealth): string {
  if (state !== 'connected') return connectionStateLabel(state);
  if (gatewayHealth === 'running') return 'Gateway ready';
  if (gatewayHealth === 'checking') return 'Checking gateway';
  return 'Gateway ?';
}



export function AppShell({ connectionState, rpc, rest, onRetry, connectionError }: AppShellProps) {
  const [navStack, setNavStack] = useState<Screen[]>(() => {
    const initial = getInitialScreen();
    return initial === 'home' ? ['home'] : ['home', initial];
  });
  const navStackRef = useRef(navStack);
  const [screenEntry, setScreenEntry] = useState<{ id: number; direction: 'forward' | 'back' | undefined }>({ id: 0, direction: undefined });
  const screen: Screen = navStack[navStack.length - 1] ?? 'home';
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreStats, setMoreStats] = useState<SystemStats | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(() => screenFromLocationHash() === 'voice');
  const [gatewayHealth, setGatewayHealth] = useState<GatewayHealth>('checking');
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck | undefined>();
  const [updateDismissedVersion, setUpdateDismissedVersion] = useState<string | null>(() => {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(UPDATE_DISMISSED_STORAGE_KEY);
  });
  const moreSheet = usePresence(moreOpen, 220);
  const activeName = useProfilesStore((s) => s.activeName);
  const currentName = useProfilesStore((s) => s.currentName);
  const { profiles, load: loadProfiles } = useProfilesStore();
  const { sessions, load } = useSessionsStore();
  const { sessionId, storedSessionId } = useChatStore();
  const addActivityItem = useActivityStore((s) => s.addItem);
  const loadActivity = useActivityStore((s) => s.load);
  const pendingApprovals = useActivityStore(
    (s) => s.items.filter((item) => item.kind === 'approval' && item.status === 'needs_you').length,
  );
  const { loadBoards } = useProjectsStore();

  const currentSession = sessions.find((s) => {
    if (storedSessionId && (s.id === storedSessionId || s.lineageRootId === storedSessionId)) return true;
    if (sessionId && (s.id === sessionId || s.lineageRootId === sessionId)) return true;
    return false;
  });
  const screenTitle = screen === 'chat' && currentSession?.title ? currentSession.title : SCREEN_TITLES[screen];
  const moreSheetRef = useRef<HTMLDivElement>(null);
  const pendingRefreshInFlightRef = useRef(false);
  const chatRecoveryInFlightRef = useRef(false);
  const pushSyncInFlightRef = useRef(false);

  useEffect(() => {
    persistScreen(screen);
  }, [screen]);

  // Lazy-load gateway stats for the More sheet health summary (M7 mockup).
  useEffect(() => {
    if (!moreOpen) return undefined;
    let cancelled = false;
    rest
      .systemStats()
      .then((s) => {
        if (!cancelled) setMoreStats(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [moreOpen, rest]);

  useEffect(() => {
    function persistCurrentScreen() {
      persistScreen(screen);
    }
    function persistWhenHidden() {
      if (document.visibilityState === 'hidden') persistCurrentScreen();
    }
    window.addEventListener('pagehide', persistCurrentScreen);
    document.addEventListener('visibilitychange', persistWhenHidden);
    return () => {
      window.removeEventListener('pagehide', persistCurrentScreen);
      document.removeEventListener('visibilitychange', persistWhenHidden);
    };
  }, [screen]);

  // History-backed navigation: each screen change pushes a history entry so
  // Android/browser Back moves within the app instead of exiting it.
  useEffect(() => {
    // A cold start can restore straight into a deep screen (e.g. a chat), but
    // the fresh document has a single history entry, so history.back() is a
    // silent no-op and the header back button looks dead. Rebuild the entries
    // the restored stack implies: mark this entry as the root, then push one
    // dummy per level so Back has somewhere to land.
    const depth = navStackRef.current.length;
    window.history.replaceState({ hmNav: 0 }, '');
    for (let i = 1; i < depth; i += 1) window.history.pushState({ hmNav: i }, '');
    const onPopState = () => {
      if (dismissTopBackLayer()) {
        // An open layer (menu, sheet, keyboard) consumed the back press;
        // restore the history entry it cost us so depth stays aligned.
        window.history.pushState({ hmNav: navStackRef.current.length - 1 }, '');
        return;
      }
      const stack = navStackRef.current;
      // ponytail: at root we cannot cancel the pop — the OS/browser leaves the app, as expected.
      // A forward press is treated as back; gesture-first PWAs rarely see it.
      if (stack.length <= 1) return;
      const next = stack.slice(0, -1);
      navStackRef.current = next;
      setNavStack(next);
      setScreenEntry((entry) => ({ id: entry.id + 1, direction: 'back' }));
      persistScreen(next[next.length - 1] ?? 'home');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // The More sheet is the topmost back layer: Back closes it before navigating.
  useEffect(() => {
    if (!moreOpen) return undefined;
    return registerBackLayer({ priority: 100, dismiss: () => setMoreOpen(false) });
  }, [moreOpen]);

  useEffect(() => {
    if (!moreOpen) return;
    void load(rest);
  }, [moreOpen, load, rest]);

  useEffect(() => {
    if (!moreOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMoreOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  useEffect(() => {
    void loadProfiles(rest);
  }, [rest, loadProfiles]);

  // Notification deep link (`#/chat?session=<id>`, e.g. a cron result): open that
  // durable session once connected, then drop the query so a reload does not reopen it.
  // A tap while the app is already open is a hash-only navigation, so also listen for hashchange.
  useEffect(() => {
    if (connectionState !== 'connected') return undefined;
    const openDeepLink = () => {
      const deepLinkSession = sessionFromLocationHash();
      if (!deepLinkSession) return;
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + '#/chat');
      navigate('chat');
      void useChatStore.getState().resumeSessionIntoChat(rest, rpc, deepLinkSession, activeName).catch(() => undefined);
    };
    openDeepLink();
    window.addEventListener('hashchange', openDeepLink);
    return () => window.removeEventListener('hashchange', openDeepLink);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate is a stable in-component helper
  }, [connectionState, rest, rpc, activeName]);

  useEffect(() => {
    if (connectionState !== 'connected') return undefined;
    let cancelled = false;
    void rest
      .updateCheck()
      .then((next) => {
        if (!cancelled) setUpdateCheck(next);
      })
      .catch(() => {
        if (!cancelled) setUpdateCheck(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionState, rest]);

  useEffect(() => {
    if (!activeName) return;
    rest.setActiveProfile?.(activeName);
    void load(rest);
    void loadBoards(rest);
  }, [activeName, rest, load, loadBoards]);

  useEffect(() => {
    if (connectionState !== 'connected') return undefined;
    let cancelled = false;

    const refreshPendingActions = () => {
      if (cancelled || pendingRefreshInFlightRef.current) return;
      pendingRefreshInFlightRef.current = true;
      const profile = activeName ?? 'default';
      void loadActivity(rest, profile).finally(() => {
        pendingRefreshInFlightRef.current = false;
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshPendingActions();
    };

    refreshPendingActions();
    window.addEventListener('focus', refreshPendingActions);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshPendingActions);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [connectionState, activeName, rest, loadActivity]);

  useEffect(() => {
    if (connectionState !== 'connected') return undefined;
    if (screen === 'chat') return undefined;
    if (activeName && currentName && activeName !== currentName) return undefined;
    let cancelled = false;

    const recoverActiveChatHistory = () => {
      if (cancelled || chatRecoveryInFlightRef.current) return;
      const { sessionId: liveId, storedSessionId: durableId, messages } = useChatStore.getState();
      if (!liveId && !durableId && messages.length === 0) return;
      chatRecoveryInFlightRef.current = true;
      const profile = activeName ?? useChatStore.getState().cacheProfile ?? 'default';
      void (async () => {
        try {
          await useSessionsStore.getState().load(rest);
          if (cancelled) return;
          await useChatStore.getState().refreshHistory(rest, profile);
        } finally {
          chatRecoveryInFlightRef.current = false;
        }
      })();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') recoverActiveChatHistory();
    };

    recoverActiveChatHistory();
    window.addEventListener('focus', recoverActiveChatHistory);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', recoverActiveChatHistory);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [connectionState, screen, activeName, currentName, rest]);

  useEffect(() => {
    if (connectionState !== 'connected') return undefined;
    let cancelled = false;

    const syncExistingPushSubscription = () => {
      if (cancelled || pushSyncInFlightRef.current) return;
      pushSyncInFlightRef.current = true;
      const profile = activeName ?? 'default';
      void (async () => {
        try {
          const status = await rest.pushStatus();
          if (!cancelled && status.available && status.vapidPublicKey) {
            await syncPushSubscription(rest, status.vapidPublicKey, profile);
          }
        } catch {
          // Best-effort startup/focus sync; Settings still shows the explicit push state.
        } finally {
          pushSyncInFlightRef.current = false;
        }
      })();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') syncExistingPushSubscription();
    };

    syncExistingPushSubscription();
    window.addEventListener('focus', syncExistingPushSubscription);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', syncExistingPushSubscription);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [connectionState, activeName, rest]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function probeGateway() {
      if (connectionState !== 'connected') {
        if (!cancelled) setGatewayHealth('checking');
        return;
      }
      try {
        await rest.systemStats();
        if (!cancelled) setGatewayHealth('running');
      } catch {
        if (!cancelled) setGatewayHealth('unavailable');
      }
    }

    void probeGateway();
    if (connectionState === 'connected') {
      timer = window.setInterval(() => {
        void probeGateway();
      }, 30_000);
    }

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [connectionState, rest]);

  useEffect(() => {
    const onApprovalRequired = (event: RpcEvent) => addActivityItem(approvalFromEvent(event));
    const onClarifyRequired = (event: RpcEvent) => addActivityItem(clarifyFromEvent(event));
    const onStatusUpdate = (event: RpcEvent) => {
      const d = eventPayload(event);
      const kind = typeof d.kind === 'string' ? d.kind : undefined;
      const text = typeof d.text === 'string' ? d.text : undefined;
      if (kind === 'process' && text) {
        addActivityItem({
          id: `status-${event.sessionId ?? 'global'}-${Date.now()}`,
          kind: 'run',
          status: 'running',
          title: text,
          createdAt: Date.now(),
        });
      }
    };

    rpc.events.addEventListener('approval.request', onApprovalRequired);
    rpc.events.addEventListener('clarify.request', onClarifyRequired);
    rpc.events.addEventListener('status.update', onStatusUpdate);
    return () => {
      rpc.events.removeEventListener('approval.request', onApprovalRequired);
      rpc.events.removeEventListener('clarify.request', onClarifyRequired);
      rpc.events.removeEventListener('status.update', onStatusUpdate);
    };
  }, [rpc, addActivityItem]);



  function navigate(s: Screen) {
    if (HIDDEN_ADMIN_SCREENS.has(s)) {
      s = 'home';
    }
    if (s !== navStackRef.current[navStackRef.current.length - 1]) {
      // Tab roots (Chats/Inbox) reset the stack so tabs never show a back button.
      const next = s === 'home' || s === 'approvals' ? [s] : [...navStackRef.current, s];
      navStackRef.current = next;
      setNavStack(next);
      setScreenEntry((entry) => ({ id: entry.id + 1, direction: 'forward' }));
      window.history.pushState({ hmNav: next.length - 1 }, '');
    }
    persistScreen(s);
    setMoreOpen(false);
  }


  const activeProfile = profiles.find((p) => p.name === activeName);
  const activeModel = activeProfile?.model?.trim() || 'Model not set';
  const activeProfileLabel = activeProfile?.displayName ?? activeName ?? 'default';
  const gatewayLabel = gatewayStatusLabel(connectionState, gatewayHealth);
  const showUpdateNotification = updateCheck?.updateAvailable === true && updateCheck.latest !== updateDismissedVersion;

  function dismissUpdateNotification() {
    const version = updateCheck?.latest ?? updateCheck?.current;
    if (!version) return;
    localStorage.setItem(UPDATE_DISMISSED_STORAGE_KEY, version);
    setUpdateDismissedVersion(version);
  }


  const MORE_ITEMS: { key: Screen; label: string; icon: IconName; sub?: string }[] = [
    { key: 'profiles', label: 'Profiles', icon: 'profiles', sub: activeProfile ? `${activeProfileLabel} · ${activeModel}` : activeModel },
    { key: 'agents', label: 'Agents', icon: 'agents' },
    { key: 'cron', label: 'Schedules', icon: 'cron' },
    { key: 'artifacts', label: 'Artifacts', icon: 'file' },
    { key: 'command', label: 'System', icon: 'system', sub: gatewayLabel },
    { key: 'settings', label: 'Settings', icon: 'settings' },
  ];

  const TABS: { key: Screen | 'more'; label: string; icon: IconName; badge?: number | undefined }[] = [
    { key: 'home', label: 'Chats', icon: 'chat' },
    { key: 'approvals', label: 'Inbox', icon: 'shield', badge: pendingApprovals || undefined },
    // ponytail: Work tab hidden — user doesn't use the kanban board. Route stays for deep links.
    { key: 'more', label: 'More', icon: 'menu' },
  ];

  return (
    <div className="hm-app-shell">
      {/* ── Header ───────────────────────────────────────────────── */}
      <header className={`hm-header${navStack.length > 1 ? ' hm-header--sub' : ''}`} data-testid="app-header">
        {navStack.length > 1 && (
          <button
            type="button"
            className="hm-header__back"
            onClick={() => window.history.back()}
            aria-label={`Back to ${SCREEN_TITLES[navStack[navStack.length - 2] ?? 'home']}`}
          >
            <Icon name="back" size={20} />
          </button>
        )}
        <h1 className="hm-header__title">{screenTitle}</h1>
        {(connectionState !== 'connected' || gatewayHealth !== 'running') && (
          <button
            type="button"
            className="hm-header__status"
            onClick={() => navigate('command')}
            aria-label="Open system status"
          >
            <StatusChip state={connectionState} gatewayHealth={gatewayHealth} />
          </button>
        )}
      </header>

      {/* ── Connection banner ────────────────────────────────────── */}
      {connectionState !== 'offline' && (
        <ConnectionBanner state={connectionState} error={connectionError} onRetry={onRetry} />
      )}
      {showUpdateNotification && updateCheck ? (
        <UpdateNotification update={updateCheck} onDismiss={dismissUpdateNotification} />
      ) : null}

      {/* ── Screen ───────────────────────────────────────────────── */}
      <main key={screenEntry.id} className={`hm-screen${screenEntry.direction ? ` hm-screen-enter-${screenEntry.direction}` : ''}`}>
        <LazyScreenErrorBoundary key={screen}>
          <Suspense fallback={<p className="hm-muted hm-loading">Loading…</p>}>
        {connectionState === 'offline' ? (
          <div className="hm-offline" data-testid="offline-card">
            <BrandMark />
            <div className="hm-offline__icon" aria-hidden="true">📡</div>
            <h2 className="hm-offline__title">Can&rsquo;t reach the gateway</h2>
            <p className="hm-offline__url hm-mono">
              Connection refused at {typeof window !== 'undefined' ? window.location.host : ''}
            </p>
            <div className="hm-offline__actions">
              <button
                type="button"
                className="hm-btn hm-btn--primary"
                onClick={onRetry ?? (() => window.location.reload())}
              >
                Retry
              </button>
              <button type="button" className="hm-btn hm-btn--ghost" onClick={() => navigate('settings')}>
                Change gateway URL
              </button>
            </div>
            <p className="hm-offline__hint">Tailscale on? Gateway running? Check Settings → Connection.</p>
          </div>
        ) : (
          <>
            {screen === 'chat'      && (
              <div className="hm-desktop-split">
                <div className="hm-desktop-split__side" aria-hidden="false">
                  <Chats key={`side-${activeName ?? 'default'}`} rpc={rpc} rest={rest} onNavigate={() => {}} sidebar />
                </div>
                <Chat key={activeName ?? 'default'} rpc={rpc} rest={rest} onOpenVoice={() => startTransition(() => setVoiceOpen(true))} />
              </div>
            )}
            {screen === 'sessions'  && <Sessions key={activeName ?? 'default'} rpc={rpc} rest={rest} onSessionOpen={() => navigate('chat')} />}
            {screen === 'approvals' && <Activity key={activeName ?? 'default'} rpc={rpc} rest={rest} />}
            {screen === 'kanban'    && <Projects key={activeName ?? 'default'} rest={rest} onNavigate={(s) => navigate(s as Screen)} />}
            {screen === 'agents'    && <Agents key={activeName ?? 'default'} rpc={rpc} />}
            {screen === 'profiles'  && <Profiles key={activeName ?? 'default'} rest={rest} />}
            {screen === 'command'   && <CommandCenter key={activeName ?? 'default'} rest={rest} />}
            {screen === 'home'      && <Chats key={activeName ?? 'default'} rpc={rpc} rest={rest} onNavigate={(s) => navigate(s as Screen)} onOpenVoice={() => startTransition(() => setVoiceOpen(true))} />}
            {screen === 'cron'      && <Cron key={activeName ?? 'default'} rest={rest} onNavigate={(s) => navigate(s as Screen)} />}
            {screen === 'artifacts' && <Artifacts key={activeName ?? 'default'} rest={rest} />}
            {screen === 'settings'  && (
              <Settings
                key={activeName ?? 'default'}
                rest={rest}
                onNavigate={(s) => navigate(s as Screen)}
                onLogout={() => void useConnectionStore.getState().logout()}
              />
            )}
          </>
        )}
          </Suspense>
        </LazyScreenErrorBoundary>
      </main>

      {/* ── Bottom tab bar ─────────────────────────────────────────── */}
      <nav className="hm-tabbar" aria-label="Primary">
        {TABS.map((tab) => {
          if (tab.key === 'more') {
            return (
              <button
                key="more"
                type="button"
                className={`hm-tab${moreOpen ? ' hm-tab--active' : ''}`}
                onClick={() => setMoreOpen(true)}
                aria-label={tab.label}
                aria-haspopup="dialog"
                aria-expanded={moreOpen}
              >
                <Icon name={tab.icon} size={22} />
                <span className="hm-tab__label">{tab.label}</span>
              </button>
            );
          }
          const active = screen === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              className={`hm-tab${active ? ' hm-tab--active' : ''}`}
              onClick={() => navigate(tab.key as Screen)}
              aria-label={tab.label}
              aria-current={active ? 'page' : undefined}
            >
              <span className="hm-tab__icon">
                <Icon name={tab.icon} size={22} />
                {tab.badge != null && tab.badge > 0 && <span className="hm-tab__badge">{tab.badge}</span>}
              </span>
              <span className="hm-tab__label">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* ── More sheet ─────────────────────────────────────────────── */}
      {(moreOpen || moreSheet.mounted) && (
        <div
          className="hm-more-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="More"
          data-closing={moreSheet.leaving || undefined}
        >
          <button className="hm-more-sheet__overlay" onClick={() => setMoreOpen(false)} aria-hidden="true" tabIndex={-1} />
          <div className="hm-more-sheet__panel" ref={moreSheetRef}>
            <div className="hm-more-sheet__grabber" aria-hidden="true" />
            {gatewayHealth === 'running' && moreStats && (
              <div className="hm-more-health" data-testid="more-health">
                <span className="hm-more-health__line">
                  <span className="hm-more-health__dot" aria-hidden="true" />
                  Gateway running · up {fmtUptime(moreStats.uptimeSeconds)}
                </span>
                <span className="hm-more-health__line hm-more-health__line--muted">
                  CPU {fmtPercent(moreStats.cpuPercent)} · RAM {fmtGb(moreStats.memoryUsedMb)} / {fmtGb(moreStats.memoryTotalMb)} · Disk{' '}
                  {fmtGb(moreStats.diskUsedMb)} / {fmtGb(moreStats.diskTotalMb)}
                </span>
              </div>
            )}
            <div className="hm-more-sheet__list">
              {MORE_ITEMS.map((item) => (
                <button key={item.key} type="button" className="hm-more-row" onClick={() => navigate(item.key)}>
                  <span className="hm-more-row__icon" aria-hidden="true"><Icon name={item.icon} size={20} /></span>
                  <span className="hm-more-row__text">
                    <span className="hm-more-row__label">{item.label}</span>
                    {item.sub && <span className="hm-more-row__sub">{item.sub}</span>}
                  </span>
                  <Icon name="chevR" size={16} />
                </button>
              ))}
            </div>
            <div className="hm-more-sheet__version">Hermes PWA v{HERMES_PWA_VERSION_LABEL}</div>
          </div>
        </div>
      )}
      {voiceOpen && (
        <div className="hm-voice-overlay">
          <Voice key={activeName ?? 'default'} onClose={() => setVoiceOpen(false)} />
        </div>
      )}
    </div>
  );
}
