export type HapticKind = 'tap' | 'confirm' | 'notify';

export function haptic(kind: HapticKind): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (typeof window !== 'undefined' && window.matchMedia) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (!window.matchMedia('(pointer: coarse)').matches) return;
    }
    navigator.vibrate(kind === 'tap' ? 10 : kind === 'confirm' ? [10, 40, 10] : 20);
  } catch {
    // Optional feedback must never interrupt the user's action.
  }
}
