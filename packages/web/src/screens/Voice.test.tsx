import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Voice } from './Voice';

describe('Voice', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the idle call state and toggles engines', () => {
    render(<Voice />);
    expect(screen.getByText('Ready to talk')).toBeTruthy();
    expect(screen.getByRole('button', { name: /start voice/i })).toBeTruthy();
    const engine = screen.getByRole('button', { name: /engine: codex/i });
    fireEvent.click(engine);
    expect(screen.getByRole('button', { name: /engine: hermes/i })).toBeTruthy();
  });

  it('shows a mic error when getUserMedia is blocked', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) },
    });
    render(<Voice />);
    fireEvent.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(screen.getByText(/Microphone blocked: NotAllowedError/)).toBeTruthy());
  });
});
