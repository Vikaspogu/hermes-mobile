import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Artifacts } from './Artifacts';
import { useChatStore } from '@hermes-pwa/core';

const makeRest = (overrides = {}) => ({
  sessionArtifacts: vi.fn().mockResolvedValue([
    { id: 'a-1', name: 'screenshot.png', type: 'image', mime_type: 'image/png', size: 102400, created_at: Date.now() },
    { id: 'a-2', name: 'report.pdf', type: 'file', mime_type: 'application/pdf', size: 204800, created_at: Date.now() },
    { id: 'a-3', name: 'https://example.com', type: 'link', url: 'https://example.com', created_at: Date.now() },
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

  it('renders artifact rows', async () => {
    render(<Artifacts rest={makeRest()} />);
    await waitFor(() => expect(screen.getAllByTestId('artifact-row').length).toBe(3));
    expect(screen.getByText('screenshot.png')).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('filters to images only', async () => {
    render(<Artifacts rest={makeRest()} />);
    await waitFor(() => expect(screen.getAllByTestId('artifact-row').length).toBe(3));
    fireEvent.click(screen.getByRole('tab', { name: 'Images' }));
    expect(screen.getAllByTestId('artifact-row').length).toBe(1);
    expect(screen.getByText('screenshot.png')).toBeInTheDocument();
  });

  it('filters to links only', async () => {
    render(<Artifacts rest={makeRest()} />);
    await waitFor(() => expect(screen.getAllByTestId('artifact-row').length).toBe(3));
    fireEvent.click(screen.getByRole('tab', { name: 'Links' }));
    expect(screen.getAllByTestId('artifact-row').length).toBe(1);
    expect(screen.getByText('https://example.com')).toBeInTheDocument();
  });

  it('shows a friendly note when the backend has no artifacts API (404)', async () => {
    const { HermesHttpError } = await import('@hermes-pwa/core');
    const rest = makeRest({
      sessionArtifacts: vi.fn().mockRejectedValue(new HermesHttpError(404, 'Not Found', '{"detail":"No such API endpoint"}')),
    });
    render(<Artifacts rest={rest} />);
    await waitFor(() => expect(screen.getByText(/no artifacts API yet/i)).toBeInTheDocument());
  });
});
