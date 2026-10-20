import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';

import { useReducedMotion } from '../hooks/useReducedMotion';
import { useProfilesStore, useChatStore, useSessionsStore } from '@hermes-pwa/core';
import '../styles/screens/voice.css';
// Live voice call with the Hermes agent. Ports the talk-desktop dashboard web
// client (agent-platform-custom images/hermes-agent/plugins/talk-desktop) into
// a PWA screen: WebRTC realtime session, two engines (Codex Live gpt-live-1,
// Hermes gpt-realtime-2.1), server-side task delegation, call-style controls.

const API = '/api/plugins/hermes-pwa/voice';
const IDLE_MS = 3500;
const VOICE_DELEGATE_NOTE =
  "[voice] Reply briefly and naturally in the user's language so it can be READ ALOUD (2-4 sentences, no markdown or lists). The text is dictated and may contain errors, use the latest intent. Do not claim something is done before it actually is.\n\n";

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
  callId: string; // voice call id → persists as a Hermes session on hang-up
  callProfile: string | null;
  callStartedAt: number | null; // ms epoch, client clock
  timers: number[];
  audioCtx: AudioContext | null;
  remoteAnalyser: AnalyserNode | null;
  audioEls: HTMLAudioElement[];
}

async function rest<T>(path: string, body: unknown, timeoutMs = 20_000): Promise<T> {
  const r = await fetch(API + path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(r.status + ': ' + (await r.text()).slice(0, 200));
  return (await r.json()) as T;
}
async function apiGet<T>(path: string, timeoutMs = 10_000): Promise<T> {
  const r = await fetch(API + path, { method: 'GET', credentials: 'same-origin', signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(r.status + ': ' + (await r.text()).slice(0, 200));
  return (await r.json()) as T;
}
function playChime(kind: 'connect' | 'end', existing?: AudioContext | null) {
  try {
    const Ctx = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    // Reuse the call's already-running AudioContext; a fresh one starts suspended
    // on Android when the chime fires outside a user gesture.
    const ctx = existing && existing.state === 'running' ? existing : Ctx ? new Ctx() : null;
    if (!ctx) return;
    const own = ctx !== existing;
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
    if (own) {
      window.setTimeout(() => {
        try {
          void ctx.close();
        } catch {
          /* ignore */
        }
      }, 900);
    }
  } catch {
    /* ignore */
  }
}
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' (code block omitted) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Codex Live delegation.context.append rejects payloads > 500 tokens.
function capForVoiceContext(text: string, maxChars = 400, maxWords = 100): string {
  const words = text.split(/\s+/);
  const byWords = words.length > maxWords ? words.slice(0, maxWords).join(' ') + '…' : text;
  return byWords.length > maxChars ? byWords.slice(0, maxChars - 1).trimEnd() + '…' : byWords;
}

type CallState = 'idle' | 'connecting' | 'reconnecting' | 'listening' | 'thinking' | 'working' | 'speaking';

type Rgb = [number, number, number];

// One parameter set per call state; the engine eases every value toward the
// active state's set (~400ms settle) so transitions cross-fade instead of snap.
interface OrbParams {
  rgb: Rgb;
  flowSpeed: number; // swirl rate of the dot field
  noiseAmp: number; // positional wobble amplitude
  audioGain: number; // how strongly live audio level pumps the sphere
  scatter: number; // 0 = sphere, 1 = flattened orbiting ring (connecting)
  breathSpeed: number; // idle breathing rate
  rotSpeed: number; // sphere rotation rate
  satellites: number; // orbiting "task" dots (working)
}

function hexToRgb(hex: string, fallback: Rgb): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1] ?? '', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const orbBase = { flowSpeed: 1, noiseAmp: 0.05, audioGain: 0.2, scatter: 0, breathSpeed: 1, rotSpeed: 0.5, satellites: 0 };

function orbParams(accent: Rgb, warn: Rgb, dim: Rgb): Record<CallState, OrbParams> {
  const teal: Rgb = [45, 212, 191];
  const violet: Rgb = [167, 139, 250];
  return {
    idle: { ...orbBase, rgb: dim, flowSpeed: 0.15, noiseAmp: 0.02, audioGain: 0, breathSpeed: 0.35, rotSpeed: 0.1 },
    connecting: { ...orbBase, rgb: accent, flowSpeed: 0.8, noiseAmp: 0.07, scatter: 0.85, breathSpeed: 2.4, rotSpeed: 1.7 },
    reconnecting: { ...orbBase, rgb: warn, flowSpeed: 0.6, noiseAmp: 0.1, scatter: 0.5, breathSpeed: 3.4, rotSpeed: 1.2 },
    listening: { ...orbBase, rgb: teal, flowSpeed: 1.0, noiseAmp: 0.06, audioGain: 0.55, breathSpeed: 1.1, rotSpeed: 0.5 },
    thinking: { ...orbBase, rgb: violet, flowSpeed: 2.3, noiseAmp: 0.12, audioGain: 0.1, breathSpeed: 1.6, rotSpeed: 1.9 },
    working: { ...orbBase, rgb: warn, flowSpeed: 1.4, noiseAmp: 0.08, breathSpeed: 1.4, rotSpeed: 1.0, satellites: 3 },
    speaking: { ...orbBase, rgb: accent, flowSpeed: 1.2, noiseAmp: 0.05, audioGain: 0.7, breathSpeed: 1.0, rotSpeed: 0.6 },
  };
}

// Dot-sphere orb (muse/dots-style): fibonacci sphere of dots; states are blended
// parameter sets, amplitude is spring-smoothed, phase accumulates (never snaps).
// Levels arrive by ref so audio-rate updates never re-render React.
function VoiceOrb({
  state,
  micRef,
  remoteRef,
}: {
  state: CallState;
  micRef: { current: number };
  remoteRef: { current: number };
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const live = useRef(state);
  live.current = state;
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // ponytail: colors are captured at mount; a theme switch mid-call keeps the old palette until remount.
    const styles = getComputedStyle(canvas);
    const accent = hexToRgb(styles.getPropertyValue('--hm-color-accent'), [99, 102, 241]);
    const warn = hexToRgb(styles.getPropertyValue('--hm-color-warning'), [245, 158, 11]);
    const dim = hexToRgb(styles.getPropertyValue('--hm-color-text-muted'), [107, 114, 128]);
    const params = orbParams(accent, warn, dim);

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const SIZE = 220;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const N = 380;
    const dots: [number, number, number][] = [];
    for (let i = 0; i < N; i++) {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / N);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      dots.push([Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)]);
    }

    // Reduced motion: one static frame per state change, no animation loop.
    if (reduced) {
      const p = params[live.current];
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = `rgb(${p.rgb[0]},${p.rgb[1]},${p.rgb[2]})`;
      const R = SIZE * 0.3;
      for (const [x, y, z] of dots) {
        const depth = (z + 1) / 2;
        ctx.globalAlpha = 0.2 + depth * 0.8;
        ctx.beginPath();
        ctx.arc(SIZE / 2 + x * R, SIZE / 2 + y * R, 1 + depth * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }

    const cur: OrbParams = { ...params[live.current] };
    let level = 0;
    let phase = 0;
    let rot = 0;
    let breath = 0;
    let raf = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = params[live.current] ?? params.idle;
      // Blend every parameter toward the active state (~400ms settle).
      const k = 1 - Math.exp(-dt * 3.5);
      cur.flowSpeed += (target.flowSpeed - cur.flowSpeed) * k;
      cur.noiseAmp += (target.noiseAmp - cur.noiseAmp) * k;
      cur.audioGain += (target.audioGain - cur.audioGain) * k;
      cur.scatter += (target.scatter - cur.scatter) * k;
      cur.breathSpeed += (target.breathSpeed - cur.breathSpeed) * k;
      cur.rotSpeed += (target.rotSpeed - cur.rotSpeed) * k;
      cur.satellites += (target.satellites - cur.satellites) * k;
      for (let c = 0; c < 3; c++) cur.rgb[c] = (cur.rgb[c] ?? 0) + ((target.rgb[c] ?? 0) - (cur.rgb[c] ?? 0)) * k;

      // Spring amplitude: fast attack, slower release.
      const st = live.current;
      const lvlTarget = Math.min(1, (st === 'speaking' ? remoteRef.current : st === 'listening' ? micRef.current : 0) * 2.2);
      level += (lvlTarget - level) * (1 - Math.exp(-dt * (lvlTarget > level ? 14 : 5)));

      phase += dt * cur.flowSpeed;
      rot += dt * cur.rotSpeed;
      breath += dt * cur.breathSpeed;

      const R = SIZE * 0.3;
      const scale = (1 + 0.045 * Math.sin(breath * Math.PI * 2)) * (1 + level * cur.audioGain * 0.35);
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = `rgb(${Math.round(cur.rgb[0] ?? 0)},${Math.round(cur.rgb[1] ?? 0)},${Math.round(cur.rgb[2] ?? 0)})`;
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      for (const [x0, y0, z0] of dots) {
        // rotate around Y, then blend sphere → ring as scatter rises
        let x = x0 * cr + z0 * sr;
        let z = -x0 * sr + z0 * cr;
        let y = y0;
        const sc = cur.scatter;
        if (sc > 0.01) {
          const len = Math.hypot(x, z) || 1;
          const ringX = (x / len) * 1.25;
          const ringZ = (z / len) * 1.25;
          x += (ringX - x) * sc;
          z += (ringZ - z) * sc;
          y += (y0 * 0.12 - y) * sc;
        }
        const wob = 1 + cur.noiseAmp * Math.sin(phase * 3 + y0 * 9 + x0 * 5);
        const lift = 1 + level * 0.3 * Math.sin(phase * 2 + x0 * 4);
        const px = SIZE / 2 + x * R * scale * wob;
        const py = SIZE / 2 + y * R * scale * wob * lift;
        const depth = (z + 1.3) / 2.3;
        ctx.globalAlpha = 0.15 + depth * 0.85;
        ctx.beginPath();
        ctx.arc(px, py, 1 + depth * 2.2 + level * 2.4 * depth, 0, Math.PI * 2);
        ctx.fill();
      }
      // Orbiting task dots while working.
      const sats = Math.round(cur.satellites);
      for (let i = 0; i < sats; i++) {
        const a = phase * 1.6 + (i * Math.PI * 2) / Math.max(1, sats);
        const px = SIZE / 2 + Math.cos(a) * R * 1.4;
        const py = SIZE / 2 + Math.sin(a) * R * 1.4 * 0.35;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(phase * 4 + i * 2);
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [reduced, micRef, remoteRef]);

  return <canvas ref={canvasRef} className="hm-voice__orb" aria-hidden="true" />;
}
function fmtElapsed(s: number): string {
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return mm + ':' + String(ss).padStart(2, '0');
}
export function Voice({ onClose }: { onClose?: () => void }) {
  const [stage, setStage] = useState('');
  const [err, setErr] = useState('');
  const [muted, setMuted] = useState(false);
  const [live, setLive] = useState(false);
  const [items, setItems] = useState<TranscriptItem[]>([]);
  // Levels live in refs: they update at audio rate and must not re-render React.
  const micLevelRef = useRef(0);
  const remoteLevelRef = useRef(0);
  const [speaking, setSpeaking] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [workingSince, setWorkingSince] = useState<number | null>(null);
  const [userDone, setUserDone] = useState(false); // user finished a turn, bot hasn't answered yet
  const [, setCallStart] = useState<number | null>(null); // still recorded server-side; no on-screen clock in M8
  const speakingUntilRef = useRef(0);
  const [login, setLogin] = useState<LoginState | null>(null);
  const [engine, setEngine] = useState<Engine>('codex'); // codex = gpt-live-1, hermes = gpt-realtime-2.1
  const activeProfile = useProfilesStore((s) => s.activeName);
  const [resume, setResume] = useState<{ threadId: string; sessionId: string; endedAt: number } | null>(null);
  useEffect(() => {
    // Last finished call per profile → "Continue last call" (thread resume).
    let alive = true;
    void apiGet<{ profiles?: Record<string, { threadId?: string; sessionId?: string; endedAt?: number | null } | undefined> }>('/threads')
      .then((r) => {
        if (!alive) return;
        const p = r.profiles?.[activeProfile || ''] ?? r.profiles?.[''];
        if (p?.threadId && (p.endedAt ?? 0) > 0) {
          setResume({ threadId: p.threadId, sessionId: p.sessionId || '', endedAt: p.endedAt || 0 });
        } else {
          setResume(null);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [activeProfile]);
  const refs = useRef<LiveRefs | null>(null);
  const itemsRef = useRef<TranscriptItem[]>([]);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const sessionId = useChatStore((s) => s.sessionId ?? s.storedSessionId);
  const sessionTitle = useSessionsStore((s) => s.sessions.find((x) => x.id === sessionId)?.title);
  // Tracks an in-progress start() so double-taps can't spawn two peer connections
  // and "Cancel" can unwind a half-built call.
  const startingRef = useRef<{ pc: RTCPeerConnection | null; stream: MediaStream | null; cancelled: boolean } | null>(null);
  const loginPollRef = useRef(0);
  const pinnedRef = useRef(true); // auto-scroll transcript only while pinned to bottom
  useEffect(() => {
    itemsRef.current = items;
    const el = transcriptRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [items]);
  const push = useCallback((who: Speaker, text: string) => {
    const oneShot = who === 'tool' || who === 'sys';
    setItems((prev) => {
      const now = Date.now();
      const next = prev.slice();
      const last = next[next.length - 1];
      if (!oneShot && last && last.who === who && (!last.done || now - last.at < IDLE_MS)) {
        next[next.length - 1] = { ...last, text: last.text + text, at: now, done: false };
      } else {
        next.push({ who, text, at: now, done: oneShot });
      }
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
          next[i] = { ...it, text: text.length > it.text.length ? text : it.text, at: Date.now(), done: true };
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

  // M8: per-second call clock removed with the status-bar timer display.

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

  // Persist the finished call as a real Hermes session (source 'voice') so it shows
  // in Sessions, is searchable, and can be resumed in chat. Fire-and-forget.
  // ponytail: sendBeacon would be more unload-proof; rest() is enough for the
  // common hang-up path — add beacon if unmount drops calls in practice.
  const persistCall = useCallback((r: LiveRefs) => {
    if (!r.threadId || !r.callStartedAt) return;
    const msgs = itemsRef.current
      .filter((it) => it.who === 'user' || it.who === 'bot')
      .map((it) => ({ who: it.who, text: it.text, at: Math.round(it.at / 1000) }));
    if (!msgs.length) return;
    void rest('/call/save', {
      callId: r.callId,
      profile: r.callProfile,
      threadId: r.threadId,
      startedAt: Math.round(r.callStartedAt / 1000),
      endedAt: Math.round(Date.now() / 1000),
      messages: msgs,
    }, 10_000).catch(() => undefined);
  }, []);

  const stop = useCallback(async () => {
    const r = refs.current;
    if (r) persistCall(r);
    // Unwind a half-built call (user tapped Cancel while connecting).
    const s = startingRef.current;
    if (s) {
      s.cancelled = true;
      startingRef.current = null;
      try {
        s.pc?.close();
      } catch {
        /* ignore */
      }
      try {
        s.stream?.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
    }
    refs.current = null;
    setLive(false);
    setMuted(false);
    setStage('');
    micLevelRef.current = 0;
    remoteLevelRef.current = 0;
    setSpeaking(false);
    setWorking(null);
    setWorkingSince(null);
    setUserDone(false);
    setCallStart(null);
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
    r.audioEls.forEach((a) => {
      try {
        a.pause();
        a.srcObject = null;
      } catch {
        /* ignore */
      }
    });
    playChime('end', r.audioCtx);
    try {
      if (r.audioCtx) await r.audioCtx.close();
    } catch {
      /* ignore */
    }
    if (r.threadId) {
      try {
        await rest('/codexlive/stop', { threadId: r.threadId });
      } catch {
        /* ignore */
      }
    }
  }, [persistCall]);

  // Delegation: the voice model asks for a task, we run it server-side via the
  // talk-desktop delegate route and feed the result back into the live session.
  const runDelegation = useCallback(
    async (dreq: string, feedBack: (out: string) => void) => {
      push('tool', 'delegation: ' + dreq.slice(0, 180));
      let out = '';
      try {
        const r = await rest<{ output?: string }>(
          '/codexlive/delegate',
          { prompt: VOICE_DELEGATE_NOTE + dreq, language: 'en' },
          95_000,
        );
        out = r?.output ?? '';
      } catch (e) {
        out = 'delegation failed: ' + String(e instanceof Error ? e.message : e).slice(0, 140);
      }
      out = stripMarkdown(out || 'The task could not be completed.');
      push('tool', 'result: ' + (out.length > 220 ? out.slice(0, 220).trimEnd() + '…' : out));
      try {
        feedBack(capForVoiceContext(out));
      } catch {
        /* ignore */
      }
      setWorking(null);
      setWorkingSince(null);
    },
    [push],
  );

  const start = useCallback(async (resumeThreadId?: string) => {
    if (startingRef.current || refs.current) return; // double-tap guard
    setErr('');
    setItems([]);
    pinnedRef.current = true;
    setStage('requesting mic…');
    startingRef.current = { pc: null, stream: null, cancelled: false };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      startingRef.current = null;
      setStage('');
      setErr('Microphone blocked: ' + ((e as DOMException)?.name || '') + ' — allow mic access and try again.');
      return;
    }
    // User hit Cancel while the OS mic prompt was open.
    if (!startingRef.current || startingRef.current.cancelled) {
      stream.getTracks().forEach((t) => t.stop());
      setStage('');
      return;
    }
    startingRef.current.stream = stream;

    try {

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
      // Barge-in: user started talking — cut the speaking linger immediately so
      // the orb flips to listening instead of lingering in speaking.
      else if (t === 'input_audio_buffer.speech_started' || t === 'speech_started' || t === 'response.cancelled') {
        speakingUntilRef.current = 0;
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
        setWorkingSince(Date.now());
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
          setWorkingSince(Date.now());
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
    dc.onclose = () => {
      if (refs.current) sys('Voice channel closed.');
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
      if (pc.connectionState === 'disconnected') {
        // Often a transient Wi-Fi blip; keep the call and say so.
        setStage('reconnecting');
        return;
      }
      setStage(pc.connectionState);
      if (pc.connectionState === 'connected') {
        playChime('connect', refs.current?.audioCtx);
        sys('Live — start talking.');
        setCallStart(Date.now());
      }
      if (pc.connectionState === 'failed') {
        // Transcript stays on screen; the user can read it and retry.
        setErr('Connection lost — transcript kept, tap Start voice to retry.');
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
        const lvl = Math.min(1, sum / buf.length / 90);
        micLevelRef.current = lvl;
        // M8: mic level bar removed; orb + waveform carry the visual feedback
        const ra = refs.current?.remoteAnalyser;
        let rl = 0;
        if (ra) {
          ra.getByteFrequencyData(buf2);
          let s2 = 0;
          for (let i = 0; i < buf2.length; i++) s2 += buf2[i] ?? 0;
          rl = Math.min(1, s2 / buf2.length / 90);
        }
        remoteLevelRef.current = rl;
        // Bail-out setState: React skips the re-render when the value is unchanged,
        // so transitions render but steady-state costs nothing.
        setSpeaking((prev) => {
          const next = Date.now() < speakingUntilRef.current || rl > 0.05;
          return prev === next ? prev : next;
        });
      }, 150);
    }

    refs.current = {
      pc,
      stream,
      dc,
      threadId: null,
      callId: crypto.randomUUID(),
      callProfile: activeProfile && activeProfile !== 'default' ? activeProfile : null,
      callStartedAt: Date.now(),
      timers: [lvlTimer],
      audioCtx,
      audioEls: [],
      remoteAnalyser: null,
    };
    startingRef.current = null; // refs owns cleanup from here on

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (!refs.current) return; // cancelled mid-negotiation
      setStage('negotiating…');
      // Android Wi-Fi can trickle ICE slowly; give gathering up to 2s so the
      // offer we POST carries candidates (candidate-less offers fail silently).
      if (pc.iceGatheringState !== 'complete') {
        await new Promise<void>((resolve) => {
          const to = window.setTimeout(resolve, 2000);
          pc.addEventListener('icegatheringstatechange', () => {
            if (pc.iceGatheringState === 'complete') {
              window.clearTimeout(to);
              resolve();
            }
          });
        });
      }
      if (!refs.current) return;
      const sdp = pc.localDescription?.sdp ?? offer.sdp;
      if (engine === 'codex') {
        const r2 = await rest<{ answer?: string; threadId?: string }>('/codexlive/session', {
          language: 'en',
          profile: activeProfile && activeProfile !== 'default' ? activeProfile : null,
          voice: 'cove',
          offer: sdp,
          threadId: resumeThreadId,
          callId: refs.current?.callId,
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
        if (!refs.current) return;
        const res = await fetch(sess.offerUrl + '?model=' + encodeURIComponent(sess.model || ''), {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + sess.clientSecret, 'Content-Type': 'application/sdp' },
          body: sdp ?? '',
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error('offer ' + res.status + ': ' + (await res.text()).slice(0, 140));
        await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
      }
      setLive(true);
    } catch (e) {
      // refs/starting already null here means the user cancelled deliberately —
      // stop() ran from the button; don't flash a bogus error over it.
      if (refs.current || startingRef.current) {
        setErr(String(e instanceof Error ? e.message : e).slice(0, 300));
      }
      void stop();
    }
    } catch (e) {
      // Setup section failed (audio graph, peer connection): don't leak the mic.
      setErr('Could not start audio: ' + String(e instanceof Error ? e.message : e).slice(0, 200));
      void stop();
    }
  }, [engine, finalize, push, runDelegation, stop, sys, activeProfile]);

  // Hang up if the screen unmounts mid-call (drawer navigation, tab close).
  useEffect(() => {
    return () => {
      window.clearInterval(loginPollRef.current);
      const r = refs.current;
      refs.current = null;
      if (!r) return;
      persistCall(r);
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
  }, [persistCall]);

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
      window.clearInterval(loginPollRef.current);
      const iv = window.setInterval(() => {
        void (async () => {
          try {
            const st = await apiGet<{ configured?: boolean; login?: { message?: string } }>('/codex/status');
            if (st?.configured) {
              window.clearInterval(iv);
              loginPollRef.current = 0;
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
      loginPollRef.current = iv;
    } catch (e) {
      setLogin({ message: String(e instanceof Error ? e.message : e).slice(0, 200) });
    }
  }, [sys]);

  const connected = live && stage === 'connected';
  // Speaking wins over working/thinking so interim bot speech reads as speech;
  // barge-in (speech_started) zeroes the linger and drops straight to listening.
  const callState: CallState = !live
    ? 'idle'
    : !connected
      ? stage === 'reconnecting'
        ? 'reconnecting'
        : 'connecting'
      : speaking
        ? 'speaking'
        : working
          ? 'working'
          : userDone
            ? 'thinking'
            : 'listening';
  const stateLabel: Record<CallState, string> = {
    idle: 'Ready to talk',
    connecting: stage === 'requesting mic…' ? 'Requesting microphone…' : stage === 'negotiating…' ? 'Negotiating…' : 'Connecting…',
    reconnecting: 'Reconnecting…',
    listening: 'Listening',
    thinking: 'Thinking…',
    working: 'Working on it…',
    speaking: 'Speaking',
  };
  const connecting = !live && stage !== '';

  return (
    <div className="hm-voice">
      {onClose && (
        <header className="hm-voice__top">
          <button type="button" className="hm-iconbtn" aria-label="Close voice" onClick={onClose}>
            <Icon name="back" size={20} />
          </button>
          <div className="hm-voice__head">
            <p className="hm-voice__title">Voice · {sessionTitle ?? 'New chat'}</p>
            <p className="hm-voice__sub">Codex engine · transcript saves to this chat</p>
          </div>
        </header>
      )}
      <div className={`hm-voice__stage hm-voice__stage--${callState}`}>
        <div className={`hm-voice__orb hm-voice__orb--${callState}`} aria-hidden="true">
          <VoiceOrb state={callState} micRef={micLevelRef} remoteRef={remoteLevelRef} />
        </div>
        <div className={`hm-voice__wave${live ? ' hm-voice__wave--live' : ''}`} aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
        <p className="hm-voice__status" aria-live="polite">
          {err || stateLabel[callState]}
        </p>
        {working && !err && (
          <p className="hm-voice__working">
            ⚙ {working}
            {workingSince ? ` · ${fmtElapsed((Date.now() - workingSince) / 1000)}` : ''}
          </p>
        )}
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

      <div
        className="hm-voice__transcript"
        ref={transcriptRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {items.length === 0 && (
          <p className="hm-voice__empty">Say “summarize my notifications” or hold to talk…</p>
        )}
        {items.map((it, i) => (
          <div key={i} className={`hm-voice__bubble hm-voice__bubble--${it.who}`}>
            {it.text}
          </div>
        ))}
      </div>

      <div className="hm-voice__controls">
        {live ? (
          <>
            <button
              type="button"
              className={`hm-roundbtn${muted ? ' hm-roundbtn--muted' : ''}`}
              onClick={toggleMute}
              aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
            >
              <Icon name="mic" size={22} />
            </button>
            <button
              type="button"
              className="hm-roundbtn hm-roundbtn--end"
              onClick={() => void stop()}
              aria-label="End call"
            >
              <Icon name="close" size={22} />
            </button>
            {/* M8 mockup has a keyboard (text input) button; no text-input mode exists yet */}
            <button type="button" className="hm-roundbtn" aria-label="Open keyboard" disabled>
              <Icon name="edit" size={22} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="hm-voice__chip"
              onClick={() => setEngine(engine === 'codex' ? 'hermes' : 'codex')}
            >
              Engine: {engine === 'codex' ? 'Codex' : 'Hermes'}
            </button>
            {resume && (
              <button
                type="button"
                className="hm-voice__chip"
                onClick={() => {
                  const tid = resume.threadId;
                  setResume(null);
                  void start(tid);
                }}
              >
                Continue last call
              </button>
            )}
            {err && !login && (
              <button type="button" className="hm-voice__chip" onClick={() => void signIn()}>
                Sign in to Codex
              </button>
            )}
            <button
              type="button"
              className="hm-voice__call"
              onClick={() => (connecting ? void stop() : void start())}
              aria-label={connecting ? 'Cancel connecting' : 'Start voice call'}
            >
              <Icon name={connecting ? 'close' : 'mic'} size={18} />
              {connecting ? 'Cancel' : 'Start voice'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
