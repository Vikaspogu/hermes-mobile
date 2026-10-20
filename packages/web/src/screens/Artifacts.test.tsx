import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Artifacts } from './Artifacts';
import { useChatStore } from '@hermes-pwa/core';

const makeRest = (overrides = {}) => ({
  sessionArtifacts: vi.fn().mockResolvedValue([
    { id: 'a-1', name: 'screenshot.png', type: 'image/png', path: '/files/screenshot.png', createdAt: Date.now() - 2 * 3600_000 },
    { id: 'a-2', name: 'output.txt', type: 'text/plain', path: '/files/output.txt', createdAt: Date.now() - 24 * 3600_000 },
    { id: 'a-3', name: 'https://example.com', type: 'link', path: 'https://example.com', createdAt: Date.now() },
  ]),
  ...overrides,
}) as unknown as import('@hermes-pwa/core').RestClient;

describe('Artifacts', () => {
  beforeEach(() => {
    useChatStore.setState({ sessionId: 'sess-abc' } as ReturnType<typeof useChatStore.getState>);
  });

  it('shows empty state when no session', () => {
    useChatStore.setState({ sessionId: undefined } as ReturnType<typeof useChatStore.getState>);
    render(<Artifacts rest={makeRest()} />);
    expect(screen.getByText(/No active session/i)).toBeInTheDocument();
  });

  it('renders artifact rows with name and sub-line', async () => {
    render(<Artifacts rest={makeRest()} />);
    await waitFor(() => expect(screen.getAllByTestId('artifact-row').length).toBe(3));
    expect(screen.getByText('screenshot.png')).toBeInTheDocument();
    expect(screen.getByText('output.txt')).toBeInTheDocument();
    expect(screen.getByText('Image · 2h')).toBeInTheDocument();
    expect(screen.getByText('Text · 1d')).toBeInTheDocument();
  });

  it('makes each row a link that opens the artifact', async () => {
    render(<Artifacts rest={makeRest()} />);
    await waitFor(() => expect(screen.getAllByTestId('artifact-row').length).toBe(3));
    const row = screen.getByRole('link', { name: /Open screenshot\.png/ });
    expect(row).toHaveAttribute('href', '/files/screenshot.png');
    expect(row).toHaveAttribute('target', '_blank');
  });

  it('shows the preview footnote below the list', async () => {
    render(<Artifacts rest={makeRest()} />);
    await waitFor(() => expect(screen.getAllByTestId('artifact-row').length).toBe(3));
    expect(screen.getByText(/Tap a row for full-screen preview/i)).toBeInTheDocument();
  });

  it('shows empty state when the session has no artifacts', async () => {
    render(<Artifacts rest={makeRest({ sessionArtifacts: vi.fn().mockResolvedValue([]) })} />);
    await waitFor(() => expect(screen.getByText('No artifacts')).toBeInTheDocument());
  });

  it('treats a missing artifacts API (404) as the normal empty state, not an error', async () => {
    const { HermesHttpError } = await import('@hermes-pwa/core');
    const rest = makeRest({
      sessionArtifacts: vi.fn().mockRejectedValue(new HermesHttpError(404, 'Not Found', '{"detail":"No such API endpoint"}')),
    });
    render(<Artifacts rest={rest} />);
    await waitFor(() => expect(screen.getByText('No artifacts')).toBeInTheDocument());
    expect(document.querySelector('.hm-warning-banner--error')).toBeNull();
  });
});
