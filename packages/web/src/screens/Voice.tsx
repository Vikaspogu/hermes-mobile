import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';

// Live voice call with the Hermes agent. Ports the talk-desktop dashboard web
// client (agent-platform-custom images/hermes-agent/plugins/talk-desktop) into
// a PWA screen: WebRTC realtime session, two engines (Codex Live gpt-live-1,
// Hermes gpt-realtime-2.1), server-side task delegation, call-style controls.

const API = '/api/plugins/talk-desktop';
const IDLE_MS = 2600;

type Engine = 'codex' | 'hermes';
type Speaker = 'user' | 'bot' | 'tool' | 'sys';

interface TranscriptItem {
  who: Speaker;
  text: string;
  at: number;
  done: boolean;
}

interface LoginState {
  url?: string;
  code?: string;
  message?: string;
}

interface LiveRefs {
  pc: RTCPeerConnection;
  stream: MediaStream;
  dc: RTCDataChannel;
  threadId: string | null;
  timers: number[];
  audioCtx: AudioContext | null;
  remoteAnalyser: AnalyserNode | null;
  audioEls: HTMLAudioElement[];
}

async function rest<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(API + path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(r.status + ': ' + (await r.text()).slice(0, 200));
  return (await r.json()) as T;
}

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(API + path, { method: 'GET', credentials: 'same-origin' });
  if (!r.ok) throw new Error(r.status + ': ' + (await r.text()).slice(0, 200));
  return (await r.json()) as T;
}

function playChime(kind: 'connect' | 'end') {
  try {
    const Ctx = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const notes = kind === 'connect' ? [523.25, 659.25, 783.99] : [659.25, 523.25, 392.0];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, now + i * 0.08);
      g.gain.linearRampToValueAtTime(0.12, now + i * 0.08 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.08 + 0.28);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(now + i * 0.08);
      o.stop(now + i * 0.08 + 0.3);
    });
    window.setTimeout(() => {
      try {
        void ctx.close();
      } catch {
        /* ignore */
      }
    }, 900);
  } catch {
    /* ignore */
  }
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();
}

type CallState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking';

// Dot-sphere orb (muse-style): fibonacci sphere of dots on a canvas, amplitude
// driven by live audio level, rotation/scatter by call state.
function VoiceOrb({ state, mic, remote }: { state: CallState; mic: number; remote: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const live = useRef({ state, mic, remote });
  live.current = { state, mic, remote };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const styles = getComputedStyle(canvas);
    const accent = styles.getPropertyValue('--color-accent').trim() || '#6366f1';
    const warn = styles.getPropertyValue('--color-warning').trim() || '#f59e0b';
    const dim = styles.getPropertyValue('--color-text-muted').trim() || '#6b7280';
    const N = 380;
    const dots: [number, number, number][] = [];
    for (let i = 0; i < N; i++) {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / N);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      dots.push([Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)]);
    }
    let raf = 0;
    let smooth = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      const { state: st, mic: m, remote: r } = live.current;
      const t = (now - t0) / 1000;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const target = st === 'speaking' ? r : st === 'listening' ? m : 0;
      smooth += (Math.min(1, target * 2.2) - smooth) * 0.15;
      const R = w * 0.3;
      const color = st === 'thinking' ? warn : st === 'idle' ? dim : accent;
      const rot = t * (st === 'thinking' ? 1.6 : st === 'connecting' ? 0.3 : 0.5);
      const scale =
        st === 'connecting'
          ? 0.72 + 0.22 * (0.5 + 0.5 * Math.sin(t * 2.4))
          : (1 + 0.04 * Math.sin(t * 1.5)) * (1 + smooth * 0.2);
      ctx.fillStyle = color;
      for (const [x0, y0, z0] of dots) {
        const x = x0 * Math.cos(rot) + z0 * Math.sin(rot);
        const z = -x0 * Math.sin(rot) + z0 * Math.cos(rot);
        const wob = st === 'thinking' ? 1 + 0.09 * Math.sin(t * 8 + y0 * 9) : 1;
        const px = w / 2 + x * R * scale * wob;
        const py = h / 2 + y0 * R * scale * wob * (1 + smooth * 0.4 * Math.sin(t * 3 + x0 * 4));
        const depth = (z + 1) / 2;
        ctx.globalAlpha = 0.2 + depth * 0.8;
        ctx.beginPath();
        ctx.arc(px, py, 1 + depth * 2.2 + smooth * 2.4 * depth, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} className="hm-voice__orb" width={220} height={220} aria-hidden="true" />;
}

function fmtElapsed(s: number): string {
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return mm + ':' + String(ss).padStart(2, '0');
}
export function Voice() {
  const [stage, setStage] = useState('');
  const [err, setErr] = useState('');
  const [muted, setMuted] = useState(false);
  const [live, setLive] = useState(false);
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [remoteLevel, setRemoteLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [userDone, setUserDone] = useState(false); // user finished a turn, bot hasn't answered yet
  const [callStart, setCallStart] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const speakingUntilRef = useRef(0);
  const [login, setLogin] = useState<LoginState | null>(null);
  const [engine, setEngine] = useState<Engine>('codex'); // codex = gpt-live-1, hermes = gpt-realtime-2.1
  const refs = useRef<LiveRefs | null>(null);
  const itemsRef = useRef<TranscriptItem[]>([]);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    itemsRef.current = items;
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  const push = useCallback((who: Speaker, text: string) => {
    setItems((prev) => {
      const next = prev.slice();
      const last = next[next.length - 1];
      if (last && last.who === who && !last.done) last.text += text;
      else next.push({ who, text, at: Date.now(), done: false });
      return next;
    });
  }, []);

  const sys = useCallback((text: string) => {
    setItems((prev) => prev.concat([{ who: 'sys', text, at: Date.now(), done: true }]));
  }, []);

  const finalize = useCallback((who: Speaker, text: string) => {
    setItems((prev) => {
      const next = prev.slice();
      for (let i = next.length - 1; i >= 0; i--) {
        const it = next[i];
        if (it && it.who === who && !it.done) {
          next[i] = { ...it, text, done: true };
          break;
        }
      }
      return next;
    });
  }, []);

  // A transcript line with no new tokens for IDLE_MS counts as finished.
  useEffect(() => {
    const iv = window.setInterval(() => {
      setItems((prev) => {
        const now = Date.now();
        let changed = false;
        const next = prev.map((it) => {
          if (!it.done && now - it.at > IDLE_MS) {
            changed = true;
            return { ...it, done: true };
          }
          return it;
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => window.clearInterval(iv);
  }, []);

  // Call clock: ticks once per second while a call is connected.
  useEffect(() => {
    if (!callStart) return;
    setElapsed(0);
    const iv = window.setInterval(() => setElapsed((Date.now() - callStart) / 1000), 1000);
    return () => window.clearInterval(iv);
  }, [callStart]);

  // Keep the screen awake for the whole call; re-acquire when the app returns to
  // foreground (the OS drops the lock when the screen turns off or the tab hides).
  useEffect(() => {
    if (!live) return;
    type WakeLockNav = Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    let sentinel: { release: () => Promise<void> } | null = null;
    const acquire = () => {
      (navigator as WakeLockNav).wakeLock
        ?.request('screen')
        .then((s) => {
          sentinel = s;
        })
        .catch(() => {
          /* unsupported or denied: nothing to do */
        });
    };
    acquire();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      sentinel?.release().catch(() => {
        /* ignore */
      });
    };
  }, [live]);

  const stop = useCallback(async () => {
    const r = refs.current;
    refs.current = null;
    setLive(false);
    setMuted(false);
    setStage('');
    setMicLevel(0);
    setRemoteLevel(0);
    setSpeaking(false);
    setWorking(null);
    setUserDone(false);
    setCallStart(null);
    setElapsed(0);
    speakingUntilRef.current = 0;
    if (!r) return;
    r.timers.forEach((t) => window.clearInterval(t));
    try {
      r.stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    try {
      r.pc.close();
    } catch {
      /* ignore */
    }
    try {
      if (r.audioCtx) await r.audioCtx.close();
    } catch {
      /* ignore */
    }
    r.audioEls.forEach((a) => {
      try {
        a.pause();
        a.srcObject = null;
      } catch {
        /* ignore */
      }
    });
    if (r.threadId) {
      try {
        await rest('/codexlive/stop', { threadId: r.threadId });
      } catch {
        /* ignore */
      }
    }
    playChime('end');
  }, []);

  // Delegation: the voice model asks for a task, we run it server-side via the
  // talk-desktop delegate route and feed the result back into the live session.
  const runDelegation = useCallback(
    async (dreq: string, feedBack: (out: string) => void) => {
      push('tool', 'delegation: ' + dreq.slice(0, 180));
      let out = '';
      try {
        const r = await rest<{ output?: string }>('/codexlive/delegate', { prompt: dreq, language: 'en' });
        out = r?.output ?? '';
      } catch (e) {
        out = 'delegation failed: ' + String(e instanceof Error ? e.message : e).slice(0, 140);
      }
      out = stripMarkdown(out || 'The task could not be completed.');
      push('tool', 'result: ' + out.slice(0, 160));
      try {
        feedBack(out.slice(0, 3500));
      } catch {
        /* ignore */
      }
      setWorking(null);
    },
    [push],
  );

  const start = useCallback(async () => {
    setErr('');
    setItems([]);
    setStage('requesting mic…');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      setErr('Microphone blocked: ' + ((e as DOMException)?.name || '') + ' — allow mic access and try again.');
      return;
    }

    const pc = new RTCPeerConnection();
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    const dc = pc.createDataChannel('oai-events');

    dc.onmessage = (ev) => {
      let msg: { type?: string; [k: string]: unknown };
      try {
        msg = JSON.parse(String(ev.data)) as { type?: string };
      } catch {
        return;
      }
      const t = msg.type;
      if (!t) return;
      if (t === 'input_transcript.added') {
        const tx = (msg.item as { text?: string } | undefined)?.text;
        if (tx) push('user', tx);
      } else if (t === 'output_transcript.added') {
        const tx = (msg.item as { text?: string } | undefined)?.text;
        if (tx) push('bot', tx);
        if (tx) {
          speakingUntilRef.current = Date.now() + 1200;
          setUserDone(false);
        }
      } else if (t === 'turn.done') {
        const tu = (msg.turn ?? {}) as { role?: string; transcript?: string };
        if (tu.role === 'user') {
          finalize('user', tu.transcript || '');
          setUserDone(true);
        }
        else if (tu.role === 'assistant') finalize('bot', tu.transcript || '');
      } else if (t === 'session.usage.updated') {
        // ponytail: track live minutes later if a cap matters
      } else if (t === 'error') {
        const m = (msg.error as { message?: string; code?: string } | undefined);
        const text = m?.message || m?.code;
        if (text) sys('error: ' + String(text).slice(0, 160));
      }
      // ── Hermes engine (gpt-realtime-2.1, existing Hermes login) ──
      else if (t === 'conversation.item.input_audio_transcription.delta') push('user', String(msg.delta || ''));
      else if (t === 'conversation.item.input_audio_transcription.completed') {
        finalize('user', String(msg.transcript || ''));
        setUserDone(true);
      } else if (t === 'response.output_audio_transcript.delta') {
        push('bot', String(msg.delta || ''));
        speakingUntilRef.current = Date.now() + 1200;
        setUserDone(false);
      }
      else if (t === 'response.output_audio_transcript.done') finalize('bot', String(msg.transcript || ''));
      else if (t === 'response.function_call_arguments.done') {
        // ponytail: voice tools not wired in the web client yet
      } else if (t === 'delegation.created') {
        // Codex Live lane-v3 delegation: run the task server-side and feed the
        // result back so the voice model can read it aloud.
        const item = (msg.item ?? {}) as { id?: string; content?: unknown };
        let dreq = '';
        try {
          if (Array.isArray(item.content)) {
            dreq = item.content.map((c) => String((c as { text?: string })?.text || '')).join('');
          }
        } catch {
          /* ignore */
        }
        const lastUser = [...itemsRef.current].reverse().find((i) => i.who === 'user');
        dreq = dreq.trim() || (lastUser ? lastUser.text.slice(0, 500) : '');
        setWorking(dreq.slice(0, 80) || 'your request');
        void runDelegation(dreq, (out) => {
          refs.current?.dc.send(
            JSON.stringify({
              type: 'delegation.context.append',
              delegation_item_id: String(item.id || ''),
              content: [{ type: 'input_text', text: out }],
            }),
          );
        });
      } else if (t === 'response.output_item.done') {
        const item = (msg.item ?? {}) as { type?: string; name?: string; arguments?: string; call_id?: string };
        if (item.type === 'function_call' && item.name === 'send_to_chat') {
          let args: { request?: string; text?: string } = {};
          try {
            args = JSON.parse(item.arguments || '{}') as typeof args;
          } catch {
            /* ignore */
          }
          const lastUser = [...itemsRef.current].reverse().find((i) => i.who === 'user');
          const dreq = String(args.request || args.text || '').trim() || (lastUser ? lastUser.text.slice(0, 500) : '');
          setWorking(dreq.slice(0, 80) || 'your request');
          void runDelegation(dreq, (out) => {
            refs.current?.dc.send(
              JSON.stringify({
                type: 'conversation.item.create',
                item: { type: 'function_call_output', call_id: item.call_id, output: out },
              }),
            );
            refs.current?.dc.send(JSON.stringify({ type: 'response.create' }));
          });
        }
      }
    };

    pc.ontrack = (ev) => {
      const audio = new Audio();
      audio.srcObject = ev.streams[0] ?? null;
      audio.autoplay = true;
      refs.current?.audioEls.push(audio);
      const actx = refs.current?.audioCtx;
      const rstream = ev.streams[0];
      if (actx && rstream && refs.current) {
        const an2 = actx.createAnalyser();
        an2.fftSize = 512;
        const mute2 = actx.createGain();
        mute2.gain.value = 0;
        actx.createMediaStreamSource(rstream).connect(an2);
        an2.connect(mute2);
        mute2.connect(actx.destination);
        refs.current.remoteAnalyser = an2;
      }
      audio.play().catch(() => sys('Tap to play audio (autoplay was blocked).'));
    };
    pc.onconnectionstatechange = () => {
      setStage(pc.connectionState);
      if (pc.connectionState === 'connected') {
        playChime('connect');
        sys('Live — start talking.');
        setCallStart(Date.now());
      }
      if (pc.connectionState === 'failed') {
        setErr('Connection lost.');
        void stop();
      }
    };

    // mic level meter (WebAudio analyser — simple bar, no waveform)
    const Ctx = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const audioCtx = Ctx ? new Ctx() : null;
    let lvlTimer = 0;
    if (audioCtx) {
      if (audioCtx.state === 'suspended') {
        try {
          await audioCtx.resume();
        } catch {
          /* ignore */
        }
      }
      const an = audioCtx.createAnalyser();
      an.fftSize = 512;
      const mute = audioCtx.createGain();
      mute.gain.value = 0;
      audioCtx.createMediaStreamSource(stream).connect(an);
      an.connect(mute);
      mute.connect(audioCtx.destination);
      const buf = new Uint8Array(an.frequencyBinCount);
      const buf2 = new Uint8Array(256);
      lvlTimer = window.setInterval(() => {
        an.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] ?? 0;
        setMicLevel(Math.min(1, sum / buf.length / 90));
        const ra = refs.current?.remoteAnalyser;
        let rl = 0;
        if (ra) {
          ra.getByteFrequencyData(buf2);
          let s2 = 0;
          for (let i = 0; i < buf2.length; i++) s2 += buf2[i] ?? 0;
          rl = Math.min(1, s2 / buf2.length / 90);
        }
        setRemoteLevel(rl);
        setSpeaking(Date.now() < speakingUntilRef.current || rl > 0.05);
      }, 150);
    }

    refs.current = { pc, stream, dc, threadId: null, timers: [lvlTimer], audioCtx, audioEls: [], remoteAnalyser: null };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      setStage('negotiating…');
      if (engine === 'codex') {
        const r2 = await rest<{ answer?: string; threadId?: string }>('/codexlive/session', {
          language: 'en',
          profile: null,
          voice: 'cove',
          offer: offer.sdp,
        });
        if (!r2?.answer) throw new Error('no answer SDP');
        if (refs.current) refs.current.threadId = r2.threadId || null;
        await pc.setRemoteDescription({ type: 'answer', sdp: r2.answer });
      } else {
        // Hermes engine: mint a session with Hermes's own login, then exchange
        // the SDP against offerUrl with the one-shot clientSecret (same flow as
        // desktop/plugin.js mintSession + startLive else-branch).
        const sess = await rest<{ offerUrl?: string; clientSecret?: string; model?: string }>('/session', {
          language: 'en',
          profile: null,
          voice: 'verse',
          allowChat: true,
        });
        if (!sess?.offerUrl || !sess.clientSecret) throw new Error('session response missing offerUrl/clientSecret');
        const res = await fetch(sess.offerUrl + '?model=' + encodeURIComponent(sess.model || ''), {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + sess.clientSecret, 'Content-Type': 'application/sdp' },
          body: offer.sdp ?? '',
        });
        if (!res.ok) throw new Error('offer ' + res.status + ': ' + (await res.text()).slice(0, 140));
        await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
      }
      setLive(true);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e).slice(0, 300));
      void stop();
    }
  }, [engine, finalize, push, runDelegation, stop, sys]);

  // Hang up if the screen unmounts mid-call (drawer navigation, tab close).
  useEffect(() => {
    return () => {
      const r = refs.current;
      refs.current = null;
      if (!r) return;
      r.timers.forEach((t) => window.clearInterval(t));
      try {
        r.stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      try {
        r.pc.close();
      } catch {
        /* ignore */
      }
      try {
        void r.audioCtx?.close();
      } catch {
        /* ignore */
      }
      r.audioEls.forEach((a) => {
        try {
          a.pause();
        } catch {
          /* ignore */
        }
      });
      if (r.threadId) {
        void rest('/codexlive/stop', { threadId: r.threadId }).catch(() => undefined);
      }
    };
  }, []);

  const toggleMute = useCallback(() => {
    const r = refs.current;
    if (!r) return;
    const next = !muted;
    setMuted(next);
    try {
      r.pc.getSenders().forEach((s) => {
        if (s.track && s.track.kind === 'audio') s.track.enabled = !next;
      });
    } catch {
      /* ignore */
    }
    sys(next ? 'Microphone muted.' : 'Microphone on.');
  }, [muted, sys]);

  const signIn = useCallback(async () => {
    try {
      setLogin({ message: 'Requesting login…' });
      const r = await rest<{ login?: LoginState } & LoginState>('/codex/login/start', {});
      const lg = r?.login ?? r ?? {};
      if (!lg.url) {
        setLogin({ message: String(lg.message || 'no login URL returned').slice(0, 200) });
        return;
      }
      setLogin({ url: lg.url, code: lg.code || '' });
      const iv = window.setInterval(() => {
        void (async () => {
          try {
            const st = await apiGet<{ configured?: boolean; login?: { message?: string } }>('/codex/status');
            if (st?.configured) {
              window.clearInterval(iv);
              setLogin(null);
              sys('Codex login complete — tap Start voice.');
            } else if (st?.login?.message) {
              setLogin((prev) => (prev ? { ...prev, message: String(st.login?.message).slice(0, 200) } : prev));
            }
          } catch {
            /* ignore */
          }
        })();
      }, 3000);
    } catch (e) {
      setLogin({ message: String(e instanceof Error ? e.message : e).slice(0, 200) });
    }
  }, [sys]);

  const connected = live && stage === 'connected';
  const callState: CallState = !live
    ? 'idle'
    : !connected
      ? 'connecting'
      : working || userDone
        ? 'thinking'
        : speaking
          ? 'speaking'
          : 'listening';
  const stateLabel: Record<CallState, string> = {
    idle: 'Ready to talk',
    connecting: stage === 'requesting mic…' ? 'Requesting microphone…' : 'Connecting…',
    listening: 'Listening',
    thinking: working ? 'Working on it…' : 'Thinking…',
    speaking: 'Speaking',
  };

  return (
    <div className="hm-voice">
      <div className={`hm-voice__stage hm-voice__stage--${callState}`}>
        <VoiceOrb state={callState} mic={micLevel} remote={remoteLevel} />
        <p className="hm-voice__status" aria-live="polite">
          {err || stateLabel[callState]}
          {connected && <span className="hm-voice__timer"> · {fmtElapsed(elapsed)}</span>}
        </p>
        {working && !err && <p className="hm-voice__working">⚙ {working}</p>}
      </div>

      {login && (
        <div className="hm-voice__login">
          {login.url ? (
            <>
              <p className="hm-voice__login-title">Sign in to ChatGPT (Codex)</p>
              <p>
                1. Open:{' '}
                <a href={login.url} target="_blank" rel="noreferrer">
                  {login.url}
                </a>
              </p>
              {login.code && (
                <p>
                  2. Enter code: <b>{login.code}</b>
                </p>
              )}
              <p className="hm-muted">Waiting for you to authorize…</p>
            </>
          ) : (
            <p>{login.message || 'Starting login…'}</p>
          )}
        </div>
      )}

      <div className="hm-voice__transcript" ref={transcriptRef}>
        {items.length === 0 && !live && (
          <div className="hm-empty-state">
            <div className="hm-empty-state__icon">
              <Icon name="wave" size={28} />
            </div>
            <p>Voice call</p>
            <p className="hm-muted">Start a call and talk to Hermes. Transcript appears here.</p>
          </div>
        )}
        {items.map((it, i) => (
          <div key={i} className={`hm-voice__bubble hm-voice__bubble--${it.who}`}>
            {it.text}
          </div>
        ))}
      </div>

      <div className="hm-voice__controls">
        <div
          className={`hm-voice__level${live ? ' hm-voice__level--live' : ''}`}
          style={{ opacity: live ? 0.3 + 0.7 * micLevel : 1 }}
        />
        {!live && (
          <button
            type="button"
            className="hm-voice__chip"
            onClick={() => setEngine(engine === 'codex' ? 'hermes' : 'codex')}
          >
            Engine: {engine === 'codex' ? 'Codex' : 'Hermes'}
          </button>
        )}
        {!live && err && !login && (
          <button type="button" className="hm-voice__chip" onClick={() => void signIn()}>
            Sign in to Codex
          </button>
        )}
        {live && (
          <button type="button" className="hm-voice__chip" onClick={toggleMute}>
            {muted ? 'Unmute' : 'Mute'}
          </button>
        )}
        <button
          type="button"
          className={`hm-voice__call${live ? ' hm-voice__call--end' : ''}`}
          onClick={() => (live ? void stop() : void start())}
        >
          <Icon name={live ? 'close' : 'mic'} size={18} />
          {live ? 'End call' : 'Start voice'}
        </button>
      </div>
    </div>
  );
}
