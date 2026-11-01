import { useState } from 'react';
import type { ConnectionStore } from '@hermes-pwa/core';

interface LoginProps {
  store: ConnectionStore;
  error: string | undefined;
}

export function Login({ store, error }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const detailedProviders = store.authProviders ?? [];
  const statusProviders = store.status?.authProviders ?? [];
  const passwordProvider = detailedProviders.find((provider) => provider.supportsPassword)?.name
    ?? (statusProviders.includes('basic') ? 'basic' : undefined)
    ?? (detailedProviders.length === 0 && statusProviders.length === 0 ? 'basic' : undefined);
  const passwordSignInUnsupported = store.status?.authRequired === true && !passwordProvider;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password || !passwordProvider) return;
    setLoading(true);
    await store.login(passwordProvider, username, password);
    setLoading(false);
  }

  return (
    <main className="hm-app-shell" style={{ overflowY: 'auto', padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: '420px', margin: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <section className="hm-qp-hero">
          <div className="hm-qp-hero__top">
            <div>
              <h1 className="hm-qp-hero__title">Sign in to Hermes</h1>
              <div className="hm-qp-hero__telemetry">SELF-HOSTED GATEWAY · SESSION AUTH</div>
            </div>
            <span className="hm-qp-presence">PWA</span>
          </div>
          <p className="hm-subtitle" style={{ marginTop: 10, marginBottom: 0 }}>
            Use your Dashboard credentials. Hermes Mobile shares the same session.
          </p>
          <div className="hm-qp-pills">
            <span className={`hm-qp-pill ${error || passwordSignInUnsupported ? 'hm-qp-pill--rose' : 'hm-qp-pill--emerald'}`}>
              <span className="hm-qp-pill__dot" aria-hidden="true" />
              {passwordSignInUnsupported ? 'AUTH UNSUPPORTED' : error ? 'AUTH ERROR' : 'READY FOR CREDENTIALS'}
            </span>
          </div>
        </section>

        {passwordSignInUnsupported ? (
          <div className="hm-card-list">
            <div className="hm-warning-banner hm-warning-banner--error" role="alert">
              <strong>Password sign-in unavailable</strong>
              <p>This Hermes server does not support password sign-in in the mobile PWA.</p>
            </div>
          </div>
        ) : (
          <form className="hm-card-list" onSubmit={onSubmit}>
            {error ? (
              <div className="hm-warning-banner hm-warning-banner--error" role="alert">
                <strong>Login failed</strong>
                <p>{error}</p>
              </div>
            ) : null}

            <label className="hm-check-card" htmlFor="username">
              <span className="hm-status-label">Username</span>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your-username"
                autoComplete="username"
                required
              />
            </label>

            <label className="hm-check-card" htmlFor="password">
              <span className="hm-status-label">Password</span>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </label>

            <button className="hm-primary" type="submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
