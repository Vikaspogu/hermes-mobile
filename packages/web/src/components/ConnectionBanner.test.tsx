import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConnectionBanner } from './ConnectionBanner';

const RECONNECT_GRACE_MS = 1500;

describe('ConnectionBanner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when connected', () => {
    const { container } = render(<ConnectionBanner state="connected" />);
    expect(container.firstChild).toBeNull();
  });

  it('stays hidden during the 1.5s grace period and shows pill + shimmer after', () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    const { container } = render(
      <ConnectionBanner state="reconnecting" error="Live updates disconnected." onRetry={onRetry} />,
    );
    expect(container.firstChild).toBeNull();

    act(() => {
      vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1);
    });
    expect(container.firstChild).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    const banner = screen.getByTestId('connection-banner');
    expect(banner).toHaveClass('hm-conn-banner--warn');
    expect(screen.getByText(/Reconnecting/i)).toBeInTheDocument();
    expect(screen.getByText(/Live updates/i)).toBeInTheDocument();
    expect(container.querySelector('.hm-conn-shimmer')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Retry now/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders a static status pill without a button when onRetry is omitted', () => {
    vi.useFakeTimers();
    render(<ConnectionBanner state="reconnecting" error="Live updates disconnected." />);
    act(() => {
      vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    });
    expect(screen.getByTestId('connection-banner')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('connection-banner').querySelector('.hm-conn-pill__label')).toHaveTextContent('Reconnecting…');
  });

  it('stays silent when connection recovers before the grace period elapses', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<ConnectionBanner state="reconnecting" />);
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(container.firstChild).toBeNull();

    rerender(<ConnectionBanner state="connected" />);
    act(() => {
      vi.advanceTimersByTime(RECONNECT_GRACE_MS);
    });
    expect(container.firstChild).toBeNull();
  });

  it('does not reset the grace timer when flipping between reconnecting and ticketing', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<ConnectionBanner state="reconnecting" />);
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(container.firstChild).toBeNull();

    rerender(<ConnectionBanner state="ticketing" />);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByTestId('connection-banner')).toBeInTheDocument();
  });

  it('shows offline banner immediately with error variant, shimmer, and retry', () => {
    const onRetry = vi.fn();
    const { container } = render(
      <ConnectionBanner state="offline" error="Network offline." onRetry={onRetry} />,
    );
    const banner = screen.getByTestId('connection-banner');
    expect(banner).toHaveClass('hm-conn-banner--error');
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByText(/Network offline/i)).toBeInTheDocument();
    expect(container.querySelector('.hm-conn-shimmer')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Retry now/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
