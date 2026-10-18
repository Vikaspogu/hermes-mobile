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

  it('caps delegation.context.append under 500 tokens, strips **bold**, and keeps one user bubble across deltas', async () => {
    let dcInstance: { onmessage?: (ev: { data: string }) => void; send: ReturnType<typeof vi.fn> } | null = null;
    class FakePC {
      iceGatheringState = 'complete';
      connectionState = 'connected';
      localDescription = { sdp: 'v=0' };
      addTrack = vi.fn();
      createDataChannel = vi.fn(() => {
        dcInstance = { send: vi.fn() };
        return dcInstance;
      });
      createOffer = vi.fn().mockResolvedValue({ sdp: 'v=0' });
      setLocalDescription = vi.fn().mockResolvedValue(undefined);
      setRemoteDescription = vi.fn().mockResolvedValue(undefined);
      close = vi.fn();
      getSenders = vi.fn(() => []);
    }
    vi.stubGlobal('RTCPeerConnection', FakePC);
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
    });
    const longOutput = '**Yes**—both apps are on Android. ' + 'word '.repeat(600);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/codexlive/session')) {
        return { ok: true, json: async () => ({ answer: 'v=0', threadId: 'th-1' }) };
      }
      if (url.endsWith('/codexlive/delegate')) {
        return { ok: true, json: async () => ({ output: longOutput }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<Voice />);
    fireEvent.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(dcInstance).not.toBeNull());

    dcInstance!.onmessage?.({
      data: JSON.stringify({ type: 'input_transcript.added', item: { text: 'Are they both available in Android' } }),
    });
    dcInstance!.onmessage?.({
      data: JSON.stringify({ type: 'turn.done', turn: { role: 'user', transcript: 'Are they both available in Android' } }),
    });
    dcInstance!.onmessage?.({
      data: JSON.stringify({ type: 'input_transcript.added', item: { text: '? Which one do you recommend' } }),
    });

    await waitFor(() => {
      const userBubbles = container.querySelectorAll('.hm-voice__bubble--user');
      expect(userBubbles.length).toBe(1);
      expect(userBubbles[0]?.textContent).toBe('Are they both available in Android? Which one do you recommend');
    });

    dcInstance!.onmessage?.({
      data: JSON.stringify({
        type: 'delegation.created',
        item: { id: 'item_1', content: [{ text: 'Compare Simply Piano and flowkey' }] },
      }),
    });

    await waitFor(() => expect(dcInstance!.send).toHaveBeenCalled());
    const sent = JSON.parse(String(dcInstance!.send.mock.calls[0]?.[0])) as {
      type: string;
      content: { text: string }[];
    };
    expect(sent.type).toBe('delegation.context.append');
    const appendedText = sent.content[0]?.text ?? '';
    expect(appendedText.startsWith('Yes—both apps are on Android.')).toBe(true);
    expect(appendedText.length).toBeLessThanOrEqual(400);
    expect(appendedText.split(/\s+/).length).toBeLessThanOrEqual(241);
  });

  it('sends the finished codex call as /call/save on hang-up, with threadId and the transcript', async () => {
    let dcInstance: { onmessage?: (ev: { data: string }) => void; send: ReturnType<typeof vi.fn> } | null = null;
    class FakePC {
      iceGatheringState = 'complete';
      connectionState = 'connected';
      localDescription = { sdp: 'v=0' };
      addTrack = vi.fn();
      createDataChannel = vi.fn(() => {
        dcInstance = { send: vi.fn() };
        return dcInstance;
      });
      createOffer = vi.fn().mockResolvedValue({ sdp: 'v=0' });
      setLocalDescription = vi.fn().mockResolvedValue(undefined);
      setRemoteDescription = vi.fn().mockResolvedValue(undefined);
      close = vi.fn();
      getSenders = vi.fn(() => []);
    }
    vi.stubGlobal('RTCPeerConnection', FakePC);
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/codexlive/session')) {
        return { ok: true, json: async () => ({ answer: 'v=0', threadId: 'th-42' }) };
      }
      if (url.endsWith('/call/save')) {
        return { ok: true, json: async () => ({}) };
      }
      if (url.endsWith('/threads')) {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<Voice />);
    fireEvent.click(screen.getByRole('button', { name: /start voice/i }));
    await waitFor(() => expect(dcInstance).not.toBeNull());
    // Wait until the call is actually live so dc.onmessage is wired before we
    // feed it transcript events (they are silently dropped otherwise).
    await waitFor(() => screen.getByRole('button', { name: /end call/i }));
    dcInstance!.onmessage?.({
      data: JSON.stringify({ type: 'input_transcript.added', item: { text: 'Hello there' } }),
    });
    dcInstance!.onmessage?.({
      data: JSON.stringify({ type: 'turn.done', turn: { role: 'user', transcript: 'Hello there' } }),
    });
    // Let the itemsRef sync effect run before hang-up (persistCall reads the ref).
    await waitFor(() => expect(container.querySelectorAll('.hm-voice__bubble--user').length).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: /end call/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/call/save'), expect.objectContaining({ method: 'POST' })));
    const saveCall = (fetchMock.mock.calls as Array<[string, RequestInit?]>).find((c) => c[0].endsWith('/call/save'));
    const body = JSON.parse(String(saveCall?.[1]?.body ?? '{}'));
    expect(body.threadId).toBe('th-42');
    expect(body.messages).toEqual([{ who: 'user', text: 'Hello there', at: expect.any(Number) }]);
  });
});
