import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlideToApprove } from './SlideToApprove';

// jsdom reports 0 for layout sizes; give the track a real width so the
// knob has travel room (max = 300 - 40 - 2*4 = 252px).
const TRACK_WIDTH = 300;

describe('SlideToApprove', () => {
  let restoreClientWidth: () => void;

  beforeEach(() => {
    const spy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(TRACK_WIDTH);
    restoreClientWidth = () => spy.mockRestore();
  });

  afterEach(() => {
    restoreClientWidth();
  });

  it('confirms via keyboard End', () => {
    const onConfirm = vi.fn();
    render(<SlideToApprove onConfirm={onConfirm} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Slide to approve' }), { key: 'End' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('confirms when arrow keys reach the end of the track', () => {
    const onConfirm = vi.fn();
    render(<SlideToApprove onConfirm={onConfirm} />);
    const knob = screen.getByRole('slider', { name: 'Slide to approve' });
    for (let i = 0; i < 10; i += 1) fireEvent.keyDown(knob, { key: 'ArrowRight' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(knob).toHaveAttribute('aria-valuenow', '100');
  });

  it('confirms on a full drag and snaps back on a short drag', () => {
    const onConfirm = vi.fn();
    const { container } = render(<SlideToApprove onConfirm={onConfirm} />);
    const knob = screen.getByRole('slider', { name: 'Slide to approve' });
    const track = container.querySelector('.hm-slide-track') as HTMLElement;
    track.getBoundingClientRect = () => ({ left: 0 }) as DOMRect;

    // Short drag (40px of 252px travel) → snap back, no confirm.
    fireEvent.pointerDown(knob, { pointerId: 1, clientX: 24 });
    fireEvent.pointerMove(knob, { pointerId: 1, clientX: 64 });
    fireEvent.pointerUp(knob, { pointerId: 1, clientX: 64 });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(knob).toHaveAttribute('aria-valuenow', '0');

    // Full drag to the end → confirm once.
    fireEvent.pointerDown(knob, { pointerId: 2, clientX: 24 });
    fireEvent.pointerMove(knob, { pointerId: 2, clientX: 276 });
    fireEvent.pointerUp(knob, { pointerId: 2, clientX: 276 });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not confirm when disabled', () => {
    const onConfirm = vi.fn();
    render(<SlideToApprove onConfirm={onConfirm} disabled />);
    const knob = screen.getByRole('slider', { name: 'Slide to approve', hidden: true });
    fireEvent.keyDown(knob, { key: 'End' });
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
