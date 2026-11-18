import { startTransition, Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { Approval, Clarify, ConnectionState, RpcClient, RestClient, RpcEvent, UpdateCheck } from '@hermes-pwa/core';
import { connectionStateLabel, useActivityStore, useProfilesStore, useSessionsStore, useChatStore, useConnectionStore, useProjectsStore } from '@hermes-pwa/core';
import { Chats } from '../screens/Chats';
import { More } from '../screens/More';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { Icon, type IconName } from '../components/Icon';
import { BrandMark } from '../components/BrandMark';
import { UpdateNotification } from '../components/UpdateNotification';
import { LazyScreenErrorBoundary } from './LazyScreenErrorBoundary';
import { getInitialScreen, persistScreen, screenFromLocationHash, sessionFromLocationHash } from '../lib/screenStorage';
import { dismissTopBackLayer } from '../lib/backLayers';
import { syncPushSubscription } from '../pwa/push';
import '../styles/screens/more.css';
import '../styles/screens/offline.css';
import '../styles/screen-transitions.css';

export type Screen =
  | 'home'
  | 'chat'
  | 'sessions'
  | 'approvals'
  | 'more'
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
const Skills = lazy(() => import('../screens/Skills').then((module) => ({ default: module.Skills })));
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
  const sessionId =
    event.sessionId ?? (typeof d.session_id === 'string' && d.session_id ? d.session_id : undefined);
  const approvalId =
    typeof d.approval_id === 'string' && d.approval_id
      ? d.approval_id
      : typeof d.request_id === 'string' && d.request_id
        ? d.request_id
        : typeof d.id === 'string' && d.id
          ? d.id
          : event.rpcRequestId !== undefined
            ? `approval-req-${String(event.rpcRequestId)}`
            : `approval-${sessionId ?? 'global'}-${patternKey || Date.now()}`;
  const item: Approval = {
    id: approvalId,
    kind: 'approval',
    status: 'needs_you',
    title: typeof d.title === 'string' ? d.title : 'Approval required',
    highImpact: Boolean(d.high_impact ?? d.highImpact ?? true),
    createdAt: Date.now(),
  };
  if (event.rpcRequestId !== undefined) item.rpcRequestId = event.rpcRequestId;
  if (sessionId) {
    item.sessionId = sessionId;
    // Live WS events carry the originating chat id; recovered REST queue keys do not.
    item.sourceSessionId = sessionId;
  }
  if (typeof d.session === 'string') item.session = d.session;
  else if (sessionId) item.session = `Session ${sessionId.slice(0, 8)}`;
  const summary = [command, description].filter(Boolean).join('\n');
  if (summary) item.summary = summary;
  if (typeof d.visibility === 'string' && (d.visibility === 'private' || d.visibility === 'public')) {
    item.visibility = d.visibility;
  } else {
    item.visibility = 'private';
  }
  return item;
}

function clarifyItemsFromEvent(event: RpcEvent): Clarify[] {
  const d = eventPayload(event);
  const sessionId =
    event.sessionId ?? (typeof d.session_id === 'string' && d.session_id ? d.session_id : undefined);
  const lockedAnswers =
    d.answers && typeof d.answers === 'object' && !Array.isArray(d.answers)
      ? (d.answers as Record<string, unknown>)
      : {};
  const questions = Array.isArray(d.questions)
    ? d.questions.filter((q): q is Record<string, unknown> => {
        if (!q || typeof q !== 'object') return false;
        const qid = (q as Record<string, unknown>).qid;
        return typeof qid === 'string' && qid.length > 0 && !(qid in lockedAnswers);
      })
    : [];
  const clarifyId =
    typeof d.id === 'string' && d.id
      ? d.id
      : event.rpcRequestId !== undefined
        ? `clarify-req-${String(event.rpcRequestId)}`
        : `clarify-${sessionId ?? 'global'}-${Date.now()}`;
  const title = typeof d.title === 'string' ? d.title : 'Clarification needed';

  if (Array.isArray(d.questions)) {
    return questions.map((q) => {
      const qid = q.qid as string;
      const item: Clarify = {
        id: `${clarifyId}:${qid}`,
        kind: 'clarify',
        status: 'needs_you',
        title,
        question: typeof q.question === 'string' ? q.question : '',
        qid,
        createdAt: Date.now(),
      };
      if (event.rpcRequestId !== undefined) item.rpcRequestId = event.rpcRequestId;
      if (sessionId) item.sessionId = sessionId;
      return item;
    });
  }

  const item: Clarify = {
    id: clarifyId,
    kind: 'clarify',
    status: 'needs_you',
    title,
    question: typeof d.question === 'string' ? d.question : '',
    createdAt: Date.now(),
  };
  if (event.rpcRequestId !== undefined) item.rpcRequestId = event.rpcRequestId;
  if (sessionId) item.sessionId = sessionId;
  return [item];
}


const SCREEN_TITLES: Record<Screen, string> = {
  home: 'Chats',
  chat: 'Chat',
  voice: 'Voice',
  sessions: 'Sessions',
  approvals: 'Inbox',
  more: 'More',
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




export function AppShell({ connectionState, rpc, rest, onRetry, connectionError }: AppShellProps) {
  const [navStack, setNavStack] = useState<Screen[]>(() => {
    const initial = getInitialScreen();
    return initial === 'home' ? ['home'] : ['home', initial];
  });
  const navStackRef = useRef(navStack);
  const [screenEntry, setScreenEntry] = useState<{ id: number; direction: 'forward' | 'back' | undefined }>({ id: 0, direction: undefined });
  const screen: Screen = navStack[navStack.length - 1] ?? 'home';
  const [voiceOpen, setVoiceOpen] = useState(() => screenFromLocationHash() === 'voice');
  const [gatewayHealth, setGatewayHealth] = useState<GatewayHealth>('checking');
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck | undefined>();
  const [updateDismissedVersion, setUpdateDismissedVersion] = useState<string | null>(() => {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(UPDATE_DISMISSED_STORAGE_KEY);
  });
  const activeName = useProfilesStore((s) => s.activeName);
  const currentName = useProfilesStore((s) => s.currentName);
  const { load: loadProfiles } = useProfilesStore();
  const { sessions, load } = useSessionsStore();
  const { sessionId, storedSessionId } = useChatStore();
  const addActivityItem = useActivityStore((s) => s.addItem);
  const cancelRpcRequest = useActivityStore((s) => s.cancelRpcRequest);
  const clearRpcRequests = useActivityStore((s) => s.clearRpcRequests);
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
  const voiceRef = useRef<HTMLDivElement>(null);
  const pendingRefreshInFlightRef = useRef(false);
  const chatRecoveryInFlightRef = useRef(false);
  const pushSyncInFlightRef = useRef(false);
  const hadConnectedOnceRef = useRef(false);
  const needsReconnectRebindRef = useRef(false);

  useEffect(() => {
    persistScreen(screen);
  }, [screen]);


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
    const onPopState = (event: PopStateEvent) => {
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
      const depth = typeof event.state?.hmNav === 'number' ? event.state.hmNav : stack.length - 2;
      const next = stack.slice(0, Math.max(1, depth + 1));
      navStackRef.current = next;
      setNavStack(next);
      setScreenEntry((entry) => ({ id: entry.id + 1, direction: 'back' }));
      persistScreen(next[next.length - 1] ?? 'home');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);


  useEffect(() => {
    if (!voiceOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = voiceRef.current;
    if (!dialog) return;
    const background = Array.from(dialog.parentElement?.children ?? []).filter((element) => element !== dialog) as HTMLElement[];
    background.forEach((element) => { element.inert = true; });
    const closeButton = () => dialog.querySelector<HTMLElement>('button[aria-label="Close voice"]');
    const frame = window.requestAnimationFrame(() => closeButton()?.focus());
    const observer = new MutationObserver(() => {
      if (document.activeElement === document.body || !document.contains(document.activeElement)) closeButton()?.focus();
    });
    observer.observe(dialog, { childList: true, subtree: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setVoiceOpen(false); return; }
      if (event.key !== 'Tab') return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (!dialog.contains(document.activeElement)) { event.preventDefault(); first.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('keydown', onKey);
      background.forEach((element) => { element.inert = false; });
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [voiceOpen]);

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
    if (connectionState !== 'connected') {
      if (hadConnectedOnceRef.current) {
        needsReconnectRebindRef.current = true;
      }
      clearRpcRequests();
      return undefined;
    }
    hadConnectedOnceRef.current = true;
    let cancelled = false;

    const rebindIfNeeded = () => {
      if (cancelled || !needsReconnectRebindRef.current) return;
      if (activeName && currentName && activeName !== currentName) return;
      needsReconnectRebindRef.current = false;
      void useChatStore
        .getState()
        .rebindLiveSession(rpc, activeName)
        .then((ok) => {
          if (!ok && !cancelled) {
            needsReconnectRebindRef.current = true;
          }
        });
    };

    const refreshPendingActions = () => {
      rebindIfNeeded();
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
  }, [connectionState, activeName, currentName, rpc, rest, loadActivity, clearRpcRequests]);

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
    const onClarifyRequired = (event: RpcEvent) => {
      for (const item of clarifyItemsFromEvent(event).reverse()) {
        addActivityItem(item);
      }
    };
    const onRequestCancel = (event: RpcEvent) => {
      const d = eventPayload(event);
      const rawId =
        (typeof d.id === 'string' && d.id.length > 0) || typeof d.id === 'number'
          ? d.id
          : (typeof d.request_id === 'string' && d.request_id.length > 0) || typeof d.request_id === 'number'
            ? d.request_id
            : undefined;
      const domainId =
        typeof d.approval_id === 'string' && d.approval_id
          ? d.approval_id
          : typeof d.clarify_id === 'string' && d.clarify_id
            ? d.clarify_id
            : undefined;
      if (rawId !== undefined || domainId) {
        cancelRpcRequest(rawId, domainId);
      }
    };
    const onApprovalCancelled = (event: RpcEvent) => {
      const d = eventPayload(event);
      const approvalId = typeof d.approval_id === 'string' && d.approval_id ? d.approval_id : undefined;
      if (approvalId) {
        cancelRpcRequest(undefined, approvalId);
      }
    };
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
    rpc.events.addEventListener('request.cancel', onRequestCancel);
    rpc.events.addEventListener('approval.cancelled', onApprovalCancelled);
    rpc.events.addEventListener('status.update', onStatusUpdate);
    return () => {
      rpc.events.removeEventListener('approval.request', onApprovalRequired);
      rpc.events.removeEventListener('clarify.request', onClarifyRequired);
      rpc.events.removeEventListener('request.cancel', onRequestCancel);
      rpc.events.removeEventListener('approval.cancelled', onApprovalCancelled);
      rpc.events.removeEventListener('status.update', onStatusUpdate);
    };
  }, [rpc, addActivityItem, cancelRpcRequest]);



  function navigate(s: Screen, replace = false) {
    if (s !== navStackRef.current[navStackRef.current.length - 1]) {
      // Tab roots (Chats/Inbox) reset the stack so tabs never show a back button.
      const next = s === 'home' || s === 'approvals' ? [s] : [...navStackRef.current, s];
      navStackRef.current = next;
      setNavStack(next);
      setScreenEntry((entry) => ({ id: entry.id + 1, direction: 'forward' }));
      if (replace) window.history.replaceState({ hmNav: next.length - 1 }, '');
      else window.history.pushState({ hmNav: next.length - 1 }, '');
    }
    persistScreen(s);
  }


  const showHomeFab = screen === 'home' && connectionState !== 'offline';
  const showUpdateNotification = updateCheck?.updateAvailable === true && updateCheck.latest !== updateDismissedVersion;

  function dismissUpdateNotification() {
    const version = updateCheck?.latest ?? updateCheck?.current;
    if (!version) return;
    localStorage.setItem(UPDATE_DISMISSED_STORAGE_KEY, version);
    setUpdateDismissedVersion(version);
  }



  const TABS: { key: Screen | 'more'; label: string; icon: IconName; badge?: number | undefined }[] = [
    { key: 'home', label: 'Chats', icon: 'chat' },
    { key: 'approvals', label: 'Inbox', icon: 'shield', badge: pendingApprovals || undefined },
    // ponytail: Work tab hidden — user doesn't use the kanban board. Route stays for deep links.
    { key: 'more', label: 'More', icon: 'menu' },
  ];

  const hasScreenHeader = screen === 'home' || screen === 'more' || screen === 'approvals';
  const hasCustomHeader = hasScreenHeader && connectionState === 'connected' && gatewayHealth === 'running';
  return (
    <div className="hm-app-shell">
      {/* ── Header ───────────────────────────────────────────────── */}
      <header className={`hm-header${navStack.length > 1 ? ' hm-header--sub' : ''}${hasCustomHeader ? ' hm-header--custom' : ''}`} data-testid="app-header">
        {navStack.length > 1 && screen !== 'chat' && !hasCustomHeader && (
          <button
            type="button"
            className="hm-header__back"
            onClick={() => window.history.back()}
            aria-label={`Back to ${SCREEN_TITLES[navStack[navStack.length - 2] ?? 'home']}`}
          >
            <Icon name="back" size={20} />
          </button>
        )}
        <h1 className="hm-header__title" aria-hidden={hasScreenHeader}>{screenTitle}</h1>
        {(connectionState !== 'connected' || gatewayHealth !== 'running') && (
          <div className="hm-header__right">
            {screen !== 'chat' && screen !== 'home' && connectionState !== 'offline' && (
              <ConnectionBanner state={connectionState} error={connectionError} onRetry={onRetry} />
            )}
            <button
              type="button"
              className="hm-header__status"
              onClick={() => navigate('command')}
              aria-label="Open system status"
            >
              <StatusChip state={connectionState} gatewayHealth={gatewayHealth} />
            </button>
          </div>
        )}
      </header>
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
                  <Chats key={`side-${activeName ?? 'default'}`} rpc={rpc} rest={rest} onNavigate={() => {}} onOpenVoice={() => startTransition(() => setVoiceOpen(true))} onRetry={onRetry} sidebar />
                </div>
                <Chat key={activeName ?? 'default'} rpc={rpc} rest={rest} onOpenVoice={() => startTransition(() => setVoiceOpen(true))} onRetry={onRetry} onBack={() => (navStack[0] === 'home' && navStack.length > 1 ? window.history.go(1 - navStack.length) : navigate('home', true))} />
              </div>
            )}
            {screen === 'sessions'  && <Sessions key={activeName ?? 'default'} rpc={rpc} rest={rest} onSessionOpen={() => navigate('chat')} />}
            {screen === 'approvals' && <Activity key={activeName ?? 'default'} rpc={rpc} rest={rest} />}
            {screen === 'kanban'    && <Projects key={activeName ?? 'default'} rest={rest} onNavigate={(s) => navigate(s as Screen)} />}
            {screen === 'skills'    && <Skills key={activeName ?? 'default'} rest={rest} />}
            {screen === 'agents'    && <Agents key={activeName ?? 'default'} rpc={rpc} />}
            {screen === 'profiles'  && <Profiles key={activeName ?? 'default'} rest={rest} />}
            {screen === 'command'   && <CommandCenter key={activeName ?? 'default'} rest={rest} />}
            {screen === 'home'      && <Chats key={activeName ?? 'default'} rpc={rpc} rest={rest} onNavigate={(s) => navigate(s as Screen)} onOpenVoice={() => startTransition(() => setVoiceOpen(true))} onRetry={onRetry} />}
            {screen === 'more'      && <More rest={rest} onNavigate={(s) => navigate(s as Screen)} onBack={navStack.length > 1 ? () => window.history.back() : undefined} />}
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
      <nav className={`hm-tabbar${screen === 'chat' ? ' hm-tabbar--chat' : ''}${showHomeFab ? ' hm-tabbar--with-fab' : ''}`} aria-label="Primary">
        {TABS.map((tab) => {
          if (tab.key === 'more') {
            return (
              <button
                key="more"
                type="button"
                className={`hm-tab${screen === 'more' ? ' hm-tab--active' : ''}`}
                onClick={() => navigate('more')}
                aria-label={tab.label}
                aria-current={screen === 'more' ? 'page' : undefined}
              >
                <span className="hm-tab__icon">
                  <Icon name={tab.icon} size={22} filled={screen === 'more'} />
                </span>
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
                <Icon name={tab.icon} size={22} filled={active} />
                {tab.badge != null && tab.badge > 0 && <span className="hm-tab__badge">{tab.badge}</span>}
              </span>
              <span className="hm-tab__label">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* M3 companion FAB: new chat, thumb-reach next to the nav capsule. */}
      {showHomeFab && (
        <button
          type="button"
          className="hm-home-fab"
          aria-label="New chat"
          data-testid="chats-qa-new"
          onClick={() => {
            useChatStore.getState().startNewSession(activeName);
            navigate('chat');
          }}
        >
          <Icon name="edit" size={20} />
          <span>New</span>
        </button>
      )}

      {voiceOpen && (
        <div className="hm-voice-overlay" ref={voiceRef} role="dialog" aria-modal="true" aria-label="Voice call" tabIndex={-1}>
          <Voice key={activeName ?? 'default'} onClose={() => setVoiceOpen(false)} />
        </div>
      )}
    </div>
  );
}
