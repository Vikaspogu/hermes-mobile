import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { usePullToRefresh, PTR_THRESHOLD } from './usePullToRefresh';

function Harness({ onRefresh }: { onRefresh: () => void }) {
  const ptr = usePullToRefresh(onRefresh);
  return (
    <div
      data-testid="scroller"
      onTouchStart={ptr.onTouchStart}
      onTouchMove={ptr.onTouchMove}
      onTouchEnd={ptr.onTouchEnd}
    />
  );
}

function pull(scroller: HTMLElement, dy: number) {
  fireEvent.touchStart(scroller, { touches: [{ clientY: 100 }] });
  fireEvent.touchMove(scroller, { touches: [{ clientY: 100 + dy }] });
  fireEvent.touchEnd(scroller);
}

describe('usePullToRefresh', () => {
  it('fires onRefresh when pulled past the threshold at scroll top', () => {
    const onRefresh = vi.fn();
    render(<Harness onRefresh={onRefresh} />);
    const scroller = screen.getByTestId('scroller');
    // pull = dy * 0.5, so dy needs 2 * PTR_THRESHOLD to trigger
    pull(scroller, PTR_THRESHOLD * 2 + 20);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not fire onRefresh for a short pull', () => {
    const onRefresh = vi.fn();
    render(<Harness onRefresh={onRefresh} />);
    pull(screen.getByTestId('scroller'), 40);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('does not track when the container is scrolled down', () => {
    const onRefresh = vi.fn();
    render(<Harness onRefresh={onRefresh} />);
    const scroller = screen.getByTestId('scroller');
    Object.defineProperty(scroller, 'scrollTop', { value: 200, configurable: true });
    pull(scroller, PTR_THRESHOLD * 3);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
