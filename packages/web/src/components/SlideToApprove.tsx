import { useCallback, useEffect, useRef, useState } from 'react';

// M3 mockup: high-risk approvals get no tap button — the knob must travel
// most of the track so a stray thumb can't authorize.
const KNOB_SIZE = 40;
const TRACK_PADDING = 4;
const CONFIRM_RATIO = 0.85;
const KEY_STEP_PERCENT = 10;

interface SlideToApproveProps {
  onConfirm: () => void;
  disabled?: boolean | undefined;
  label?: string | undefined;
}

export function SlideToApprove({ onConfirm, disabled = false, label = 'Slide to approve' }: SlideToApproveProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(0);
  const [dragging, setDragging] = useState(false);
  const confirmedRef = useRef(false);

  const maxPosition = useCallback(() => {
    const width = trackRef.current?.clientWidth ?? 0;
    return Math.max(0, width - KNOB_SIZE - TRACK_PADDING * 2);
  }, []);

  // A failed submit re-enables the control; reset the knob for the retry.
  useEffect(() => {
    if (!disabled) {
      confirmedRef.current = false;
      setPosition(0);
    }
  }, [disabled]);

  const confirm = useCallback(() => {
    if (confirmedRef.current || disabled) return;
    confirmedRef.current = true;
    setPosition(maxPosition());
    onConfirm();
  }, [disabled, maxPosition, onConfirm]);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    // jsdom has no pointer capture and synthetic pointers have no active id;
    // both throw, so guard. Real browsers need it so the drag keeps tracking
    // when the pointer leaves the knob. No preventDefault here — it would
    // block focus, breaking keyboard control after tap.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture unavailable */
    }
    setDragging(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || disabled) return;
    const track = trackRef.current;
    if (!track) return;
    const trackLeft = track.getBoundingClientRect().left;
    const next = event.clientX - trackLeft - TRACK_PADDING - KNOB_SIZE / 2;
    setPosition(Math.min(Math.max(0, next), maxPosition()));
  }

  function onPointerEnd() {
    if (!dragging) return;
    setDragging(false);
    const max = maxPosition();
    if (max > 0 && position >= max * CONFIRM_RATIO) {
      confirm();
    } else {
      setPosition(0);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const max = maxPosition();
    const percent = max > 0 ? (position / max) * 100 : 0;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = Math.min(100, percent + KEY_STEP_PERCENT);
      if (next >= 100) confirm();
      else setPosition((next / 100) * max);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      setPosition((Math.max(0, percent - KEY_STEP_PERCENT) / 100) * max);
    } else if (event.key === 'End') {
      event.preventDefault();
      confirm();
    } else if (event.key === 'Home') {
      event.preventDefault();
      setPosition(0);
    }
  }

  const max = maxPosition();
  const valueNow = max > 0 ? Math.round((position / max) * 100) : 0;

  return (
    <div className="hm-slide-track" ref={trackRef}>
      <span className="hm-slide-hint" aria-hidden="true" />
      <div
        className={`hm-slide-knob${dragging ? ' hm-slide-knob--dragging' : ''}`}
        style={{ left: TRACK_PADDING + position }}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={valueNow}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
      >
        →
      </div>
      <span className="hm-slide-label">{label}</span>
    </div>
  );
}
