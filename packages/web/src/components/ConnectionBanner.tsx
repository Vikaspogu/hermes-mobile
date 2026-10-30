import { useEffect, useState } from 'react';
import type { ConnectionState } from '@hermes-pwa/core';

const RECONNECT_GRACE_MS = 1500;

interface ConnectionBannerProps {
  state: ConnectionState;
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
}

export function ConnectionBanner({ state, error, onRetry }: ConnectionBannerProps) {
  const isOffline = state === 'offline';
  const isReconnecting = state === 'reconnecting' || state === 'ticketing';
  const [graceElapsed, setGraceElapsed] = useState(false);

  useEffect(() => {
    if (!isReconnecting) {
      setGraceElapsed(false);
      return undefined;
    }
    setGraceElapsed(false);
    const timer = setTimeout(() => {
      setGraceElapsed(true);
    }, RECONNECT_GRACE_MS);
    return () => clearTimeout(timer);
  }, [isReconnecting]);

  if (state === 'connected') return null;
  if (!isOffline && !isReconnecting) return null;
  if (isReconnecting && !graceElapsed) return null;

  const title = isOffline ? 'Offline' : 'Reconnecting…';
  const message = error ?? (isOffline ? 'Check your connection and try again.' : 'Live updates disconnected.');
  const modifier = isOffline ? 'hm-conn-banner--error' : 'hm-conn-banner--warn';

  return (
    <div
      className={`hm-conn-banner ${modifier}`}
      role="status"
      aria-live="polite"
      data-testid="connection-banner"
    >
      {onRetry ? (
        <button
          type="button"
          className="hm-conn-pill"
          onClick={onRetry}
          title={`${title} — ${message}`}
        >
          <span className="hm-conn-pill__dot" aria-hidden="true" />
          <span className="hm-conn-pill__label" aria-hidden="true">
            Retry
          </span>
          <span className="hm-sr-only">
            <strong>{title}</strong>
            {' — '}
            {message}
            {' Retry now'}
          </span>
        </button>
      ) : (
        <span className="hm-conn-pill" title={`${title} — ${message}`}>
          <span className="hm-conn-pill__dot" aria-hidden="true" />
          <span className="hm-conn-pill__label" aria-hidden="true">
            {title}
          </span>
          <span className="hm-sr-only">
            <strong>{title}</strong>
            {' — '}
            {message}
          </span>
        </span>
      )}
      <span className="hm-conn-shimmer" aria-hidden="true" />
    </div>
  );
}
