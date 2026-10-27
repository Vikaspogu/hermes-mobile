type ServiceWorkerStatus = 'unsupported' | 'registering' | 'ready' | 'failed';

export interface ServiceWorkerState {
  status: ServiceWorkerStatus;
  scope?: string;
  error?: string;
}

let updateCheckCleanup: (() => void) | undefined;
let controllerChangeCleanup: (() => void) | undefined;
let reloadPromptShown = false;

async function checkForServiceWorkerUpdate(registration: ServiceWorkerRegistration): Promise<void> {
  try {
    await registration.update();
  } catch {
    // Silent freshness check only. A failed update check must not block app startup.
  }
}

function installSilentUpdateChecks(registration: ServiceWorkerRegistration): void {
  updateCheckCleanup?.();

  const onFocus = () => {
    void checkForServiceWorkerUpdate(registration);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      void checkForServiceWorkerUpdate(registration);
    }
  };

  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibilityChange);
  updateCheckCleanup = () => {
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

function installControllerChangeReloadPrompt(): void {
  controllerChangeCleanup?.();
  reloadPromptShown = false;

  // No active controller means this is the first install. Do not reload/prompt
  // the user just because the PWA became controlled for the first time.
  if (!navigator.serviceWorker.controller) {
    controllerChangeCleanup = undefined;
    return;
  }

  const onControllerChange = () => {
    if (reloadPromptShown) return;
    reloadPromptShown = true;
    const shouldReload = typeof window.confirm === 'function'
      ? window.confirm('A new Hermes Mobile version is ready. Reload now?')
      : true;
    if (shouldReload) {
      window.location.reload();
    }
  };

  const serviceWorker = navigator.serviceWorker;
  serviceWorker.addEventListener('controllerchange', onControllerChange);
  controllerChangeCleanup = () => {
    serviceWorker.removeEventListener('controllerchange', onControllerChange);
  };
}

export async function registerServiceWorker(): Promise<ServiceWorkerState> {
  if (!('serviceWorker' in navigator)) {
    return { status: 'unsupported' };
  }

  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './', updateViaCache: 'none' });
    installControllerChangeReloadPrompt();
    installSilentUpdateChecks(registration);
    await checkForServiceWorkerUpdate(registration);
    return { status: 'ready', scope: registration.scope };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
