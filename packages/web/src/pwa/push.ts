import type { PushSubscribeBody, PushSubscriptionSafe, RestClient } from '@hermes-pwa/core';

export interface PushCapability {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  reason?: string;
  iosStandaloneRequired: boolean;
  installedStandalone: boolean;
}

function isIosLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  return /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true;
}

export function getPushCapability(): PushCapability {
  const permission: NotificationPermission | 'unsupported' = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  const installedStandalone = isStandaloneDisplay();
  const iosStandaloneRequired = isIosLike() && !installedStandalone;

  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { supported: false, permission, reason: 'Browser APIs are unavailable.', iosStandaloneRequired, installedStandalone };
  }
  if (!('serviceWorker' in navigator)) {
    return { supported: false, permission, reason: 'This browser does not support service workers.', iosStandaloneRequired, installedStandalone };
  }
  if (typeof Notification === 'undefined') {
    return { supported: false, permission, reason: 'This browser does not support notifications.', iosStandaloneRequired, installedStandalone };
  }
  if (!('PushManager' in window)) {
    return { supported: false, permission, reason: 'This browser does not support Web Push.', iosStandaloneRequired, installedStandalone };
  }
  if (iosStandaloneRequired) {
    return {
      supported: false,
      permission,
      reason: 'On iPhone/iPad, install Hermes Mobile to Home Screen first; Safari tabs cannot receive Web Push.',
      iosStandaloneRequired,
      installedStandalone,
    };
  }
  return { supported: true, permission, iosStandaloneRequired, installedStandalone };
}

export function urlBase64ToUint8Array(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output.buffer;
}

async function currentBrowserSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/** Server id (`sha256:<hex of endpoint>`) of this browser's push subscription, or null if it has none. */
export async function currentPushSubscriptionId(): Promise<string | null> {
  if (!getPushCapability().supported) return null;
  const subscription = await currentBrowserSubscription().catch(() => null);
  if (!subscription?.endpoint) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subscription.endpoint));
  return 'sha256:' + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function enablePushNotifications(
  rest: RestClient,
  vapidPublicKey: string,
  profile: string,
  label = 'Hermes Mobile',
): Promise<PushSubscriptionSafe> {
  const capability = getPushCapability();
  if (!capability.supported) {
    throw new Error(capability.reason ?? 'Push notifications are not supported.');
  }
  if (!vapidPublicKey) {
    throw new Error('Push server is missing a VAPID public key.');
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    // Must be called from a user gesture by the Settings button handler.
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  const registration = await navigator.serviceWorker.ready;
  // Explicit Enable always mints a fresh subscription: a reused one can be stale on the push
  // service side (Chrome/FCM answers 410 Gone) while the browser still reports it as active.
  const stale = await registration.pushManager.getSubscription();
  if (stale) await stale.unsubscribe().catch(() => false);
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  const body: PushSubscribeBody = { subscription: subscription.toJSON(), label };
  return rest.pushSubscribe(body, profile);
}

export async function disablePushNotifications(rest: RestClient, id: string | undefined, profile: string): Promise<void> {
  const subscription = await currentBrowserSubscription().catch(() => null);
  if (subscription) {
    await subscription.unsubscribe().catch(() => false);
  }
  const body: { id?: string; endpoint?: string } = {};
  if (id) body.id = id;
  if (subscription?.endpoint) body.endpoint = subscription.endpoint;
  await rest.pushUnsubscribe(body, profile);
}

/**
 * Automatically re-register the browser push subscription with the server
 * if it has drifted (e.g. after PWA reinstall, SW update, or iOS endpoint rotation).
 *
 * This runs on app startup WITHOUT requiring a user gesture: if the browser
 * already has Notification.permission === 'granted' and an active PushSubscription,
 * we simply make sure the server knows about it. No permission prompts are shown.
 *
 * Returns true if a re-sync happened.
 */
export async function syncPushSubscription(
  rest: RestClient,
  vapidPublicKey: string,
  profile: string,
  label = 'Hermes Mobile',
): Promise<boolean> {
  const capability = getPushCapability();
  if (!capability.supported) return false;
  if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return false;
  if (!vapidPublicKey) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const browserSub = await registration.pushManager.getSubscription();
    if (!browserSub) return false;

    // Always re-register. The backend push/subscribe endpoint is idempotent:
    // it upserts by endpoint hash, so re-subscribing with the same endpoint
    // is a no-op. If the browser endpoint changed (after reinstall/SW update),
    // this creates a new server record and marks the old one stale.
    const body: PushSubscribeBody = { subscription: browserSub.toJSON(), label };
    await rest.pushSubscribe(body, profile);
    return true;
  } catch {
    // Best-effort sync; don't break app startup if push re-sync fails.
    return false;
  }
}
