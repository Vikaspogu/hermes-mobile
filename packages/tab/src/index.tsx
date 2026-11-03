/* eslint-disable react-refresh/only-export-components */
import React, { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import qrcode from 'qrcode-generator';
import './style.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PluginDiagnostics {
  origin: string;
  https: boolean;
  localhost: boolean;
  private_ip: boolean;
  app_url: string;
  manifest_url: string;
  service_worker_url: string;
  app_scope: string;
  dist_ready: boolean;
}

interface ApiStatus {
  auth_required?: boolean;
  gateway_state?: string;
}

interface CheckResult {
  label: string;
  detail: string;
  state: 'pass' | 'warn' | 'fail' | 'pending';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPluginBase(): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}/api/plugins/hermes-pwa`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function fetchOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'GET', credentials: 'include' });
    return res.ok;
  } catch {
    return false;
  }
}

function qrCodeDataUrl(value: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(value, 'Byte');
  qr.make();
  return qr.createDataURL(5, 2);
}

function useDiagnostics() {
  const [diag, setDiag] = useState<PluginDiagnostics | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [manifestOk, setManifestOk] = useState<boolean | null>(null);
  const [swOk, setSwOk] = useState<boolean | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const base = getPluginBase();
      try {
        const d = await fetchJson<PluginDiagnostics>(`${base}/diagnostics`);
        if (cancelled) return;
        setDiag(d);

        // Parallel checks
        const [apiRes, manifestRes, swRes] = await Promise.allSettled([
          fetchJson<ApiStatus>(`${d.origin}/api/status`).catch(() => ({} as ApiStatus)),
          fetchOk(d.manifest_url),
          fetchOk(d.service_worker_url),
        ]);

        if (cancelled) return;
        if (apiRes.status === 'fulfilled') setApiStatus(apiRes.value);
        if (manifestRes.status === 'fulfilled') setManifestOk(manifestRes.value);
        if (swRes.status === 'fulfilled') setSwOk(swRes.value);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return { diag, apiStatus, manifestOk, swOk, error };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function Badge({ state }: { state: CheckResult['state'] }) {
  const labels: Record<CheckResult['state'], string> = {
    pass: 'OK',
    warn: 'Check',
    fail: 'Fail',
    pending: '...',
  };
  return <span className={`hm-badge hm-badge--${state}`}>{labels[state]}</span>;
}

function StatusCard({ check }: { check: CheckResult }) {
  return (
    <div className="hm-status-card">
      <div className="hm-status-card__content">
        <span className="hm-status-label">{check.label}</span>
        <span className="hm-status-detail">{check.detail}</span>
      </div>
      <Badge state={check.state} />
    </div>
  );
}

function MobileTab() {
  const { diag, apiStatus, manifestOk, swOk, error } = useDiagnostics();

  const checks = useMemo<CheckResult[]>(() => {
    if (!diag) return [];

    const results: CheckResult[] = [
      {
        label: 'PWA dist built',
        detail: diag.dist_ready
          ? 'Build output exists in dashboard/dist/mobile/.'
          : 'Build output missing. Run npm run build.',
        state: diag.dist_ready ? 'pass' : 'fail',
      },
      {
        label: 'HTTPS / Secure context',
        detail: diag.https
          ? 'Connection is encrypted.'
          : diag.localhost
            ? 'Localhost is acceptable for development.'
            : 'Use HTTPS for installability. If on a private network, use Tailscale or a reverse proxy with TLS.',
        state: diag.https || diag.localhost ? 'pass' : 'warn',
      },
      {
        label: 'API reachable',
        detail: apiStatus
          ? 'Hermes API responded.'
          : 'Waiting for API check…',
        state: apiStatus ? 'pass' : 'pending',
      },
      {
        label: 'Auth status',
        detail:
          apiStatus == null
            ? 'Checking…'
            : apiStatus.auth_required
              ? 'Authentication is required. Log in before opening the PWA.'
              : 'No auth required or session is active.',
        state: apiStatus == null ? 'pending' : 'pass',
      },
      {
        label: 'Manifest reachable',
        detail:
          manifestOk == null
            ? 'Checking…'
            : manifestOk
              ? `Manifest fetched successfully.`
              : `Could not fetch manifest.`,
        state: manifestOk == null ? 'pending' : manifestOk ? 'pass' : 'fail',
      },
      {
        label: 'Service worker reachable',
        detail:
          swOk == null
            ? 'Checking…'
            : swOk
              ? `Service worker fetched successfully. Scope: ${diag.app_scope}`
              : `Could not fetch service worker.`,
        state: swOk == null ? 'pending' : swOk ? 'pass' : 'fail',
      },
      {
        label: 'App URL',
        detail: diag.app_url,
        state: 'pass',
      },
    ];

    return results;
  }, [diag, apiStatus, manifestOk, swOk]);

  const networkWarning = useMemo(() => {
    if (!diag) return null;
    if (!diag.https && !diag.localhost) {
      return (
        <div className="hm-warning-banner">
          <strong>Non-secure origin</strong>
          <p>
            You are serving Hermes over HTTP on a non-localhost address. Browsers block PWA
            installability on insecure origins. Use Tailscale, a local reverse proxy with TLS
            (nginx/Caddy), or Cloudflare Tunnel to provide HTTPS.
          </p>
        </div>
      );
    }
    if (diag.private_ip) {
      return (
        <div className="hm-warning-banner">
          <strong>Private IP detected</strong>
          <p>
            You are on a private IP address ({diag.origin}). For mobile install, ensure your phone
            can reach this address (same Wi-Fi, Tailscale, or VPN), or use a public HTTPS origin.
          </p>
        </div>
      );
    }
    return null;
  }, [diag]);

  const pluginBase = getPluginBase();
  const appUrl = diag?.app_url ?? `${pluginBase}/app/`;
  const appQrDataUrl = useMemo(() => qrCodeDataUrl(appUrl), [appUrl]);

  return (
    <div className="hm-mobile-tab">
      <div className="hm-mobile-tab__hero">
        <p className="hm-mobile-tab__eyebrow">Hermes PWA</p>
        <h1 className="hm-mobile-tab__title">I.V.A.N</h1>
        <p className="hm-mobile-tab__subtitle">
          Installable mobile control plane for Hermes Agent. Run diagnostics below, then open the
          app on your phone or copy the URL.
        </p>
        <div className="hm-mobile-tab__actions">
          <a className="hm-button hm-button--primary" href={appUrl} target="_blank" rel="noreferrer">
            Open PWA
          </a>
          <a
            className="hm-button hm-button--secondary"
            href={diag?.manifest_url ?? `${appUrl}manifest.json`}
            target="_blank"
            rel="noreferrer"
          >
            Manifest
          </a>
        </div>
      </div>

      {networkWarning}

      {error ? (
        <div className="hm-warning-banner hm-warning-banner--error">
          <strong>Diagnostics failed</strong>
          <p>{error}</p>
        </div>
      ) : null}

      <div className="hm-mobile-tab__grid">
        {checks.map((check) => (
          <StatusCard key={check.label} check={check} />
        ))}
      </div>

      <div className="hm-install-card">
        <div className="hm-install-card__copy">
          <h2>Install from phone</h2>
          <p>Scan the QR code with your phone camera, then on Android Chrome install the app, or on iPhone use Safari → Share → Add to Home Screen.</p>
          <code>{appUrl}</code>
        </div>
        <div className="hm-install-card__qr" aria-label="QR code for I.V.A.N app URL">
          <img src={appQrDataUrl} alt="QR code for I.V.A.N app URL" />
          <span>Scan to open on phone</span>
        </div>
      </div>
    </div>
  );
}

function mount(container: HTMLElement): () => void {
  const root: Root = createRoot(container);
  root.render(
    <StrictMode>
      <MobileTab />
    </StrictMode>,
  );
  return () => root.unmount();
}

if (typeof window !== 'undefined') {
  const globals = window as unknown as Record<string, unknown>;
  globals.HermesMobileTab = { mount, MobileTab };

  const plugins = globals.__HERMES_PLUGINS__ as
    | { register?: (name: string, component: React.ComponentType) => void }
    | undefined;
  const sdk = globals.__HERMES_PLUGIN_SDK__ as
    | {
        React?: typeof React;
        hooks?: {
          useEffect?: typeof useEffect;
          useRef?: typeof import('react').useRef;
        };
      }
    | undefined;

  // Dashboard plugin contract: the host loads this bundle and expects it to
  // call window.__HERMES_PLUGINS__.register(name, Component).  Register as soon
  // as the registry exists. Newer Dashboard builds expose host React/hooks via
  // __HERMES_PLUGIN_SDK__; older builds do not, so keep a no-hooks class-based
  // fallback instead of silently skipping register().
  if (plugins?.register) {
    const hasHostSdk = Boolean(
      sdk?.React?.createElement &&
        sdk.hooks?.useEffect &&
        sdk.hooks?.useRef,
    );

    if (hasHostSdk && sdk?.React?.createElement && sdk.hooks?.useEffect && sdk.hooks?.useRef) {
      const { createElement } = sdk.React;
      const { useEffect: useHostEffect, useRef: useHostRef } = sdk.hooks;

      const HermesPwaDashboardPlugin: React.FC = () => {
        const containerRef = useHostRef<HTMLDivElement | null>(null);

        useHostEffect(() => {
          if (!containerRef.current) return undefined;
          return mount(containerRef.current);
        }, []);

        return createElement('div', { ref: containerRef });
      };

      plugins.register('hermes-pwa', HermesPwaDashboardPlugin);
    } else {
      class HermesPwaDashboardPlugin extends React.Component {
        private container: HTMLDivElement | null = null;
        private cleanup: (() => void) | undefined;

        override componentDidMount() {
          if (this.container) this.cleanup = mount(this.container);
        }

        override componentWillUnmount() {
          this.cleanup?.();
        }

        override render() {
          return React.createElement('div', {
            ref: (node: HTMLDivElement | null) => {
              this.container = node;
            },
          });
        }
      }

      plugins.register('hermes-pwa', HermesPwaDashboardPlugin);
    }
  }
}

export { mount, MobileTab };
export default mount;
