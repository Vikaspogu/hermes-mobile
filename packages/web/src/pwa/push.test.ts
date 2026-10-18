import { afterEach, describe, expect, it, vi } from 'vitest';
import { enablePushNotifications, disablePushNotifications, getPushCapability, urlBase64ToUint8Array } from './push';

const originalNotification = globalThis.Notification;
const originalNavigator = globalThis.navigator;
const originalWindowPushManager = (window as unknown as { PushManager?: unknown }).PushManager;

function setNavigator(value: Partial<Navigator>) {
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
  });
}

function setNotification(permission: NotificationPermission, requestResult: NotificationPermission = permission) {
  Object.defineProperty(globalThis, 'Notification', {
    value: {
      permission,
      requestPermission: vi.fn().mockResolvedValue(requestResult),
    },
    configurable: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
  Object.defineProperty(globalThis, 'Notification', { value: originalNotification, configurable: true });
  (window as unknown as { PushManager?: unknown }).PushManager = originalWindowPushManager;
});

describe('push pwa helpers', () => {
  it('converts URL-safe VAPID key material to bytes', () => {
    const bytes = urlBase64ToUint8Array('AQIDBA');
    expect(Array.from(new Uint8Array(bytes))).toEqual([1, 2, 3, 4]);
  });

  it('reports unsupported when PushManager is missing', () => {
    setNotification('default');
    setNavigator({ serviceWorker: {} as ServiceWorkerContainer, userAgent: 'Chrome', platform: 'Linux' });
    delete (window as unknown as { PushManager?: unknown }).PushManager;

    const capability = getPushCapability();

    expect(capability.supported).toBe(false);
    expect(capability.reason).toMatch(/Web Push/);
  });

  it('blocks iOS Safari tabs until installed as Home Screen PWA', () => {
    setNotification('default');
    setNavigator({
      serviceWorker: {} as ServiceWorkerContainer,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      platform: 'iPhone',
    });
    (window as unknown as { PushManager?: unknown }).PushManager = function PushManager() {};
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);

    const capability = getPushCapability();

    expect(capability.supported).toBe(false);
    expect(capability.iosStandaloneRequired).toBe(true);
    expect(capability.reason).toMatch(/Home Screen/);
  });

  it('subscribes from a granted user gesture and stores a safe backend record', async () => {
    setNotification('granted');
    const pushSubscription = {
      endpoint: 'https://push.example/sub/1',
      toJSON: () => ({ endpoint: 'https://push.example/sub/1', keys: { p256dh: 'p', auth: 'a' } }),
    } as unknown as PushSubscription;
    const pushManager = {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue(pushSubscription),
    };
    setNavigator({
      serviceWorker: { ready: Promise.resolve({ pushManager } as unknown as ServiceWorkerRegistration) } as ServiceWorkerContainer,
      userAgent: 'Chrome',
      platform: 'Linux',
    });
    (window as unknown as { PushManager?: unknown }).PushManager = function PushManager() {};
    const rest = {
      pushSubscribe: vi.fn().mockResolvedValue({ id: 'sha256:sub', enabled: true }),
    } as never;

    await expect(enablePushNotifications(rest, 'AQIDBA', 'default', 'Laptop')).resolves.toEqual({ id: 'sha256:sub', enabled: true });
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    const subscribeOptions = pushManager.subscribe.mock.calls[0]?.[0] as PushSubscriptionOptionsInit;
    expect(subscribeOptions.userVisibleOnly).toBe(true);
    expect(Array.from(new Uint8Array(subscribeOptions.applicationServerKey as ArrayBuffer))).toEqual([1, 2, 3, 4]);
    expect((rest as { pushSubscribe: ReturnType<typeof vi.fn> }).pushSubscribe).toHaveBeenCalledWith(
      { subscription: { endpoint: 'https://push.example/sub/1', keys: { p256dh: 'p', auth: 'a' } }, label: 'Laptop' },
      'default',
    );
  });

  it('replaces an existing browser subscription on explicit enable (stale FCM endpoints return 410)', async () => {
    setNotification('granted');
    const stale = { unsubscribe: vi.fn().mockResolvedValue(true) };
    const fresh = {
      endpoint: 'https://push.example/sub/2',
      toJSON: () => ({ endpoint: 'https://push.example/sub/2', keys: { p256dh: 'p', auth: 'a' } }),
    } as unknown as PushSubscription;
    const pushManager = {
      getSubscription: vi.fn().mockResolvedValue(stale),
      subscribe: vi.fn().mockResolvedValue(fresh),
    };
    setNavigator({
      serviceWorker: { ready: Promise.resolve({ pushManager } as unknown as ServiceWorkerRegistration) } as ServiceWorkerContainer,
      userAgent: 'Chrome',
      platform: 'Linux',
    });
    (window as unknown as { PushManager?: unknown }).PushManager = function PushManager() {};
    const rest = { pushSubscribe: vi.fn().mockResolvedValue({ id: 'sha256:sub2', enabled: true }) } as never;

    await enablePushNotifications(rest, 'AQIDBA', 'default');
    expect(stale.unsubscribe).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect((rest as { pushSubscribe: ReturnType<typeof vi.fn> }).pushSubscribe.mock.calls[0]?.[0].subscription.endpoint).toBe(
      'https://push.example/sub/2',
    );
  });

  it('unsubscribes from the active profile scope', async () => {
    const pushSubscription = {
      endpoint: 'https://push.example/sub/1',
      unsubscribe: vi.fn().mockResolvedValue(true),
    } as unknown as PushSubscription;
    const pushManager = {
      getSubscription: vi.fn().mockResolvedValue(pushSubscription),
    };
    setNavigator({
      serviceWorker: { ready: Promise.resolve({ pushManager } as unknown as ServiceWorkerRegistration) } as ServiceWorkerContainer,
      userAgent: 'Chrome',
      platform: 'Linux',
    });
    const rest = {
      pushUnsubscribe: vi.fn().mockResolvedValue({ ok: true }),
    } as never;

    await disablePushNotifications(rest, 'sha256:sub', 'research');

    expect(pushSubscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect((rest as { pushUnsubscribe: ReturnType<typeof vi.fn> }).pushUnsubscribe).toHaveBeenCalledWith(
      { id: 'sha256:sub', endpoint: 'https://push.example/sub/1' },
      'research',
    );
  });
});
