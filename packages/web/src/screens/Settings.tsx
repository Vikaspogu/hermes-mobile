import { useEffect, useMemo, useState } from 'react';
import { useProfilesStore, useModelStore } from '@hermes-pwa/core';
import type { RestClient, SystemStats, PushStatus } from '@hermes-pwa/core';
import { HERMES_PWA_VERSION_LABEL } from '../app/version';
import { currentPushSubscriptionId, disablePushNotifications, enablePushNotifications, getPushCapability } from '../pwa/push';
import '../styles/screens/settings.css';
import { BottomSheet } from '../components/BottomSheet'; // ponytail: prototype.css's trailing @import of screens/*.css is dropped by Vite
import { applyTheme, readTheme, THEME_OPTIONS, THEME_STORAGE_KEY, type ThemeSetting } from '../lib/theme';

interface SettingsProps {
  rest: RestClient;
  onNavigate: (screen: string) => void;
  onLogout: () => void;
}

// M14 local preferences — no server-side setting exists for these yet.
// NOTIFY_* storage keys are local-only for now (THEME_STORAGE_KEY comes from ../lib/theme).
const NOTIFY_APPROVALS_STORAGE_KEY = 'hermes-pwa.notifyApprovals.v1';
const NOTIFY_RUNS_STORAGE_KEY = 'hermes-pwa.notifyRuns.v1';

const THEME_LABELS = Object.fromEntries(THEME_OPTIONS.map((o) => [o.id, o.label])) as Record<ThemeSetting, string>;

function readStoredBool(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

function writeStoredBool(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* private mode — preference just doesn't persist */
  }
}

function Row({ title, sub, mono = false, right, onClick, ariaLabel }: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  mono?: boolean;
  right?: React.ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const body = (
    <>
      <div className="hm-set-row__body">
        <div className="hm-set-row__title">{title}</div>
        {sub ? <div className={`hm-set-row__sub${mono ? ' hm-set-row__sub--mono' : ''}`}>{sub}</div> : null}
      </div>
      {right}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="hm-set-row hm-set-row--link" onClick={onClick} aria-label={ariaLabel}>
        {body}
      </button>
    );
  }
  return <div className="hm-set-row">{body}</div>;
}

function Chevron() {
  return (
    <span className="hm-set-row__chevron" aria-hidden="true">
      ›
    </span>
  );
}

function Toggle({ checked, disabled, label, onChange }: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`hm-set-switch${checked ? '' : ' hm-set-switch--off'}`}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Settings({ rest, onNavigate, onLogout }: SettingsProps) {
  const activeName = useProfilesStore((s) => s.activeName);
  const activeProfile = useProfilesStore((s) => s.profiles.find((p) => p.name === s.activeName));
  const { info, error: modelError, loadInfo } = useModelStore();
  const [stats, setStats] = useState<SystemStats | undefined>();
  const [statsError, setStatsError] = useState<string | undefined>();
  const [pushStatus, setPushStatus] = useState<PushStatus | undefined>();
  const [pushLoading, setPushLoading] = useState(true);
  const [pushError, setPushError] = useState<string | undefined>();
  const [pushBusy, setPushBusy] = useState(false);
  const [localPushId, setLocalPushId] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeSetting>(readTheme);
  const [themeSheetOpen, setThemeSheetOpen] = useState(false);
  const [notifyApprovals, setNotifyApprovals] = useState(() => readStoredBool(NOTIFY_APPROVALS_STORAGE_KEY, true));
  const [notifyRuns, setNotifyRuns] = useState(() => readStoredBool(NOTIFY_RUNS_STORAGE_KEY, false));

  const gatewayUrl = typeof window !== 'undefined' ? window.location.origin : 'http://hermes.local:9119';
  const modelLabel = activeProfile?.model ?? info?.model ?? '—';
  const pushProfile = activeName || 'default';
  const pushCapability = useMemo(() => getPushCapability(), []);
  // Only this browser's own subscription counts: another device's must not hide "Enable on this device".
  const activePushSubscription = localPushId
    ? pushStatus?.subscriptions.find((sub) => sub.id === localPushId && sub.enabled)
    : undefined;

  useEffect(() => {
    void loadInfo(rest);
  }, [rest, loadInfo]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    rest
      .systemStats()
      .then((s) => {
        setStats(s);
        setStatsError(undefined);
      })
      .catch((err) => setStatsError(err instanceof Error ? err.message : 'Failed to load stats'));
  }, [rest]);

  function reloadPushStatus() {
    setPushLoading(true);
    Promise.all([rest.pushStatus(pushProfile), currentPushSubscriptionId().catch(() => null)])
      .then(([next, localId]) => {
        setPushStatus(next);
        setLocalPushId(localId);
        setPushError(undefined);
      })
      .catch((err) => setPushError(err instanceof Error ? err.message : 'Failed to load push status'))
      .finally(() => setPushLoading(false));
  }

  useEffect(() => {
    reloadPushStatus();
    // reloadPushStatus intentionally closes over the latest rest client and push profile only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rest, pushProfile]);

  async function handleDevicePushChange(next: boolean) {
    setPushBusy(true);
    setPushError(undefined);
    try {
      if (next) {
        if (!pushStatus?.vapidPublicKey) {
          throw new Error(pushStatus?.reason ?? 'Push server is missing a VAPID public key.');
        }
        await enablePushNotifications(rest, pushStatus.vapidPublicKey, pushProfile);
      } else {
        await disablePushNotifications(rest, activePushSubscription?.id, pushProfile);
      }
      reloadPushStatus();
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'Failed to update notifications');
    } finally {
      setPushBusy(false);
    }
  }

  function selectTheme(next: ThemeSetting) {
    setTheme(next);
    setThemeSheetOpen(false);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* private mode */
    }
  }

  function handleNotifyApprovalsChange(next: boolean) {
    setNotifyApprovals(next);
    writeStoredBool(NOTIFY_APPROVALS_STORAGE_KEY, next);
  }

  function handleNotifyRunsChange(next: boolean) {
    setNotifyRuns(next);
    writeStoredBool(NOTIFY_RUNS_STORAGE_KEY, next);
  }

  const devicePushEnabled = Boolean(activePushSubscription);
  const devicePushDisabled =
    pushBusy ||
    pushLoading ||
    (!devicePushEnabled && (!pushCapability.supported || !pushStatus?.available || !pushStatus.vapidPublicKey));

  return (
    <div className="hm-settings hm-scroll">
      {statsError && <div className="hm-warning-banner hm-warning-banner--error">{statsError}</div>}
      {modelError && <div className="hm-warning-banner hm-warning-banner--error">{modelError}</div>}
      {pushError && <div className="hm-warning-banner hm-warning-banner--error">{pushError}</div>}

      <div className="hm-group-label hm-settings__group-label--first">Connection</div>
      <Row title="Gateway URL" sub={gatewayUrl} mono right={<Chevron />} />
      <Row
        title="Model"
        sub={`${modelLabel} · managed in Profiles`}
        right={<span className="hm-set-row__link">Profiles ›</span>}
        onClick={() => onNavigate('profiles')}
        ariaLabel="Manage model in Profiles"
      />

      <div className="hm-group-label">Notifications</div>
      <Row
        title="Enable on this device"
        right={
          <Toggle
            checked={devicePushEnabled}
            disabled={devicePushDisabled}
            label="Enable notifications on this device"
            onChange={(next) => void handleDevicePushChange(next)}
          />
        }
      />
      <Row
        title="Approval requests"
        right={
          <Toggle
            checked={notifyApprovals}
            label="Approval request notifications"
            onChange={handleNotifyApprovalsChange}
          />
        }
      />
      <Row
        title="Runs completed"
        right={
          <Toggle
            checked={notifyRuns}
            label="Run completion notifications"
            onChange={handleNotifyRunsChange}
          />
        }
      />
      {pushCapability.iosStandaloneRequired && !devicePushEnabled && (
        <p className="hm-settings__note">iPhone/iPad: install Hermes Mobile to Home Screen before enabling notifications.</p>
      )}

      <div className="hm-group-label">Appearance</div>
      <Row
        title="Theme"
        sub={THEME_LABELS[theme]}
        right={<Chevron />}
        onClick={() => setThemeSheetOpen(true)}
        ariaLabel={`Theme: ${THEME_LABELS[theme]}. Tap to change.`}
      />

      <div className="hm-group-label">About</div>
      <Row
        title={`Hermes PWA v${HERMES_PWA_VERSION_LABEL}`}
        sub={`Gateway ${stats?.version ?? '—'} · plugin hermes-pwa`}
      />

      <button type="button" className="hm-btn hm-btn--danger-outline hm-settings__logout" onClick={onLogout}>
        Log out
      </button>

      {themeSheetOpen && (
        <BottomSheet title="Theme" onClose={() => setThemeSheetOpen(false)}>
          {THEME_OPTIONS.map((option) => (
            <Row
              key={option.id}
              title={option.label}
              right={theme === option.id ? <span className="hm-set-row__link">✓</span> : undefined}
              onClick={() => selectTheme(option.id)}
              ariaLabel={`Use ${option.label} theme`}
            />
          ))}
        </BottomSheet>
      )}
    </div>
  );
}
