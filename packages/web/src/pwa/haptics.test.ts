import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { haptic } from './haptics';

const originalVibrate = Object.getOwnPropertyDescriptor(navigator, 'vibrate');
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

function mockMedia(reducedMotion = false, coarsePointer = true) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? reducedMotion : coarsePointer,
    })),
  });
}

describe('haptic', () => {
  const vibrate = vi.fn();

  beforeEach(() => {
    vibrate.mockReset();
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    mockMedia();
  });

  afterEach(() => {
    if (originalVibrate) Object.defineProperty(navigator, 'vibrate', originalVibrate);
    else Reflect.deleteProperty(navigator, 'vibrate');
    if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
    else Reflect.deleteProperty(window, 'matchMedia');
  });

  it.each([
    ['tap', 10],
    ['confirm', [10, 40, 10]],
    ['notify', 20],
  ] as const)('uses the %s vibration pattern', (kind, pattern) => {
    haptic(kind);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(pattern);
  });

  it('does nothing when vibration is unavailable', () => {
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined });
    expect(() => haptic('tap')).not.toThrow();
  });

  it('does not interrupt actions when vibration throws', () => {
    vibrate.mockImplementation(() => {
      throw new Error('Vibration unavailable');
    });
    expect(() => haptic('confirm')).not.toThrow();
  });

  it('respects reduced motion preferences', () => {
    mockMedia(true);
    haptic('tap');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('avoids vibration for a fine pointer', () => {
    mockMedia(false, false);
    haptic('tap');
    expect(vibrate).not.toHaveBeenCalled();
  });
});
