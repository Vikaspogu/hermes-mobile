import { useCallback, useEffect, useState } from 'react';
import type {
  SystemActionStatus,
  Checkpoint as DomainCheckpoint,
  OpsRunResult,
  RestClient,
  SystemStats as DomainSystemStats,
} from '@hermes-pwa/core';
import { fmtGb, fmtUptime } from '../lib/formatStats';
import '../styles/screens/system.css';

interface SystemScreenProps {
  rest: RestClient;
}

interface SystemStats {
  cpuPercent: number | undefined;
  memoryMb: number | undefined;
  memoryTotalMb: number | undefined;
  memoryPercent: number | undefined;
  diskUsedMb: number | undefined;
  diskTotalMb: number | undefined;
  diskPercent: number | undefined;
  uptimeSeconds: number | undefined;
}

interface BackupEntry {
  id: string;
  name: string;
  createdAt: number | undefined;
  sizeMb: number | undefined;
  kind: string | undefined;
}

type CheckStatus = 'passed' | 'failed' | 'running' | 'unknown';

interface HealthCheck {
  key: 'doctor' | 'security-audit' | 'backup';
  label: string;
  status: CheckStatus;
  sub: string;
  fix: boolean;
}

type TerminalState = {
  open: boolean;
  title: string;
  command: string;
  actionName?: string | undefined;
  running: boolean;
  lines: string[];
  pid?: number | null | undefined;
  exitCode?: number | null | undefined;
  error?: string | undefined;
};

function fmtMb(mb: number | undefined): string {
  if (mb == null) return '—';
  if (mb >= 1024) return fmtGb(mb);
  return `${mb.toFixed(1)} MB`;
}

function fmtGbShort(mb: number | undefined): string {
  if (mb == null) return '—';
  return (mb / 1024).toFixed(1);
}

function fmtDate(ts: number | undefined): string {
  if (!ts) return '';
  const d = new Date(ts > 10_000_000_000 ? ts : ts * 1000);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return `today · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  if (diffDays === 1) return 'yesterday';
  return `${diffDays}d ago`;
}

function parseStats(raw: DomainSystemStats): SystemStats {
  return {
    cpuPercent: raw.cpuPercent,
    memoryMb: raw.memoryUsedMb,
    memoryTotalMb: raw.memoryTotalMb,
    memoryPercent: raw.memoryPercent,
    diskUsedMb: raw.diskUsedMb,
    diskTotalMb: raw.diskTotalMb,
    diskPercent: raw.diskPercent,
    uptimeSeconds: raw.uptimeSeconds,
  };
}

function backupSortRank(item: BackupEntry): number {
  if (item.kind === 'archive') return 0;
  if (item.kind === 'directory') return 1;
  return 2;
}

function parseBackups(raw: DomainCheckpoint[]): BackupEntry[] {
  return raw
    .map((item) => ({
      id: item.id,
      name: item.name,
      createdAt: item.createdAt,
      sizeMb: item.sizeMb,
      kind: item.kind,
    }))
    .sort((a, b) => backupSortRank(a) - backupSortRank(b) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** Map an ops action log to a health-check status. No real health-check API
 *  exists; the action log (exit code) is the only record of the last run. */
function checkFromAction(status: SystemActionStatus | null): { status: CheckStatus; sub: string } {
  if (!status) return { status: 'unknown', sub: 'not run yet · tap to run' };
  if (status.running) return { status: 'running', sub: 'running…' };
  if (status.exitCode === 0) return { status: 'passed', sub: 'passed' };
  if (status.exitCode != null) return { status: 'failed', sub: `failed · exit ${status.exitCode}` };
  return { status: 'unknown', sub: 'not run yet · tap to run' };
}

function terminalFromStatus(previous: TerminalState, status: SystemActionStatus): TerminalState {
  return {
    ...previous,
    actionName: status.name || previous.actionName,
    running: status.running,
    pid: status.pid,
    exitCode: status.exitCode,
    lines: status.lines.length > 0 ? status.lines : previous.lines,
  };
}

function fallbackLines(command: string, result: OpsRunResult): string[] {
  const lines = [`$ ${command}`];
  if (result.pid != null) lines.push(`started pid ${result.pid}`);
  if (result.message) lines.push(result.message);
  else if (result.status) lines.push(result.status);
  else if (result.ok === true) lines.push('Started. Waiting for action log…');
  else lines.push('Started.');
  return lines;
}

const CHECK_COMMANDS: Record<HealthCheck['key'], { title: string; command: string }> = {
  doctor: { title: 'Doctor', command: 'hermes doctor' },
  'security-audit': { title: 'Security audit', command: 'hermes security audit' },
  backup: { title: 'Backup', command: 'hermes backup' },
};

export function CommandCenter({ rest }: SystemScreenProps) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [actions, setActions] = useState<Record<string, SystemActionStatus | null>>({});
  const [loading, setLoading] = useState(true);
  const [opsRunning, setOpsRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [terminal, setTerminal] = useState<TerminalState | null>(null);
  const [pollAction, setPollAction] = useState<string | null>(null);

  const refreshSystem = useCallback(async () => {
    const [raw, backupRows, doctor, audit] = await Promise.all([
      rest.systemStats(),
      rest.opsBackups().catch(() => []),
      rest.actionStatus('doctor', 1).catch(() => null),
      rest.actionStatus('security-audit', 1).catch(() => null),
    ]);
    setStats(parseStats(raw));
    setBackups(parseBackups(backupRows));
    setActions({ doctor, 'security-audit': audit });
  }, [rest]);

  useEffect(() => {
    void (async () => {
      try {
        await refreshSystem();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshSystem]);

  useEffect(() => {
    if (!pollAction) return undefined;
    const actionName = pollAction;
    let cancelled = false;
    let timer: number | undefined;

    async function poll() {
      try {
        const status = await rest.actionStatus(actionName, 800);
        if (cancelled) return;
        setTerminal((prev) => (prev ? terminalFromStatus(prev, status) : prev));
        if (status.running) {
          timer = window.setTimeout(() => void poll(), 1000);
        } else {
          setPollAction(null);
          setOpsRunning(null);
          void refreshSystem().catch(() => undefined);
        }
      } catch (err) {
        if (cancelled) return;
        setTerminal((prev) => prev
          ? { ...prev, running: false, error: err instanceof Error ? err.message : 'Failed to read action log' }
          : prev);
        setPollAction(null);
        setOpsRunning(null);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [pollAction, refreshSystem, rest]);

  async function startTerminalAction(
    title: string,
    command: string,
    start: () => Promise<OpsRunResult>,
    runningKey?: string,
  ) {
    setOpsRunning(runningKey ?? title);
    setTerminal({
      open: true,
      title,
      command,
      running: true,
      lines: [`$ ${command}`, 'starting…'],
    });
    try {
      const result = await start();
      const actionName = result.name ?? runningKey;
      if (actionName) {
        setTerminal((prev) => prev
          ? {
              ...prev,
              actionName,
              pid: result.pid,
              lines: fallbackLines(command, result),
            }
          : prev);
        setPollAction(actionName);
      } else {
        setTerminal((prev) => prev
          ? {
              ...prev,
              running: false,
              pid: result.pid,
              lines: fallbackLines(command, result),
            }
          : prev);
        setOpsRunning(null);
      }
    } catch (err) {
      setTerminal((prev) => prev
        ? {
            ...prev,
            running: false,
            error: err instanceof Error ? err.message : 'Action failed',
            lines: [...prev.lines, err instanceof Error ? err.message : 'Action failed'],
          }
        : prev);
      setOpsRunning(null);
    }
  }

  async function runCheck(key: HealthCheck['key']) {
    const def = CHECK_COMMANDS[key];
    await startTerminalAction(def.title, def.command, () => rest.opsRun(key), key);
  }

  async function runGatewayAction(action: 'restart' | 'stop') {
    const label = action === 'restart' ? 'Restart gateway' : 'Stop gateway';
    const command = `hermes gateway ${action}`;
    const ok = window.confirm(`${label}? This interrupts all live sessions.`);
    if (!ok) return;
    await startTerminalAction(label, command, () => rest.gatewayAction(action), `gateway-${action}`);
  }

  function closeTerminal() {
    setTerminal((prev) => (prev ? { ...prev, open: false } : prev));
  }

  if (loading) {
    return (
      <div className="hm-command">
        <p className="hm-muted hm-loading">Loading system info…</p>
      </div>
    );
  }

  const latestArchive = backups.find((backup) => backup.kind === 'archive');
  const latestBackup = latestArchive ?? backups[0];

  const checks: HealthCheck[] = (['security-audit', 'doctor'] as const).map((key) => {
    const result = checkFromAction(actions[key] ?? null);
    return {
      key,
      label: CHECK_COMMANDS[key].title,
      status: result.status,
      sub: result.sub,
      fix: result.status === 'failed',
    };
  });
  checks.push(latestBackup
    ? {
        key: 'backup',
        label: 'Backups',
        status: 'passed',
        sub: `latest ${fmtDate(latestBackup.createdAt) || '—'} · ${fmtMb(latestBackup.sizeMb)}`,
        fix: false,
      }
    : {
        key: 'backup',
        label: 'Backups',
        status: 'failed',
        sub: 'no backups yet',
        fix: true,
      });

  return (
    <div className="hm-command hm-system hm-scroll">
      {error && <div className="hm-warning-banner hm-warning-banner--error">{error}</div>}

      <div className="hm-card hm-system__gateway" data-testid="gateway-card">
        <div className="hm-system__gateway-title">
          <span className="hm-system__gateway-name">
            <span className="hm-dot" aria-hidden="true" />
            Gateway running
          </span>
          <span className="hm-system__gateway-uptime">up {fmtUptime(stats?.uptimeSeconds)}</span>
        </div>
        <div className="hm-system__gateway-actions">
          <button
            type="button"
            className="hm-btn hm-btn--ghost"
            disabled={opsRunning === 'gateway-restart'}
            onClick={() => void runGatewayAction('restart')}
          >
            {opsRunning === 'gateway-restart' ? 'Restarting…' : 'Restart…'}
          </button>
          <button
            type="button"
            className="hm-btn hm-btn--danger-outline"
            disabled={opsRunning === 'gateway-stop'}
            onClick={() => void runGatewayAction('stop')}
          >
            {opsRunning === 'gateway-stop' ? 'Stopping…' : 'Stop…'}
          </button>
        </div>
      </div>

      {(stats?.cpuPercent != null || stats?.memoryMb != null || stats?.diskUsedMb != null) && (
        <div className="hm-card hm-system__metrics">
          {stats!.cpuPercent != null && (
            <div className="hm-system__metric">
              <div className="hm-system__metric-label">CPU {Math.round(stats!.cpuPercent)}%</div>
              <div className="hm-metricbar">
                <div className="hm-metricbar__fill" style={{ width: `${Math.min(100, stats!.cpuPercent)}%` }} />
              </div>
            </div>
          )}
          {stats!.memoryMb != null && (
            <div className="hm-system__metric">
              <div className="hm-system__metric-label">
                RAM {fmtGbShort(stats!.memoryMb)} / {fmtGb(stats!.memoryTotalMb)}
              </div>
              <div className="hm-metricbar">
                <div className="hm-metricbar__fill" style={{ width: `${Math.min(100, stats!.memoryPercent ?? 0)}%` }} />
              </div>
            </div>
          )}
          {stats!.diskUsedMb != null && (
            <div className="hm-system__metric">
              <div className="hm-system__metric-label">
                Disk {fmtGbShort(stats!.diskUsedMb)} / {fmtGb(stats!.diskTotalMb)}
              </div>
              <div className="hm-metricbar">
                <div
                  className="hm-metricbar__fill hm-metricbar__fill--warn"
                  style={{ width: `${Math.min(100, stats!.diskPercent ?? 0)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="hm-group-label">Health checks</div>
      {checks.map((check) => (
        <button
          key={check.key}
          type="button"
          className="hm-system__check"
          disabled={opsRunning === check.key}
          onClick={() => void runCheck(check.key)}
          aria-label={check.fix ? `${check.label} — fix` : check.label}
        >
          <span
            className={`hm-system__check-icon${
              check.status === 'passed'
                ? ' hm-system__check-icon--ok'
                : check.status === 'failed'
                  ? ' hm-system__check-icon--warn'
                  : ' hm-system__check-icon--idle'
            }`}
            aria-hidden="true"
          >
            {check.status === 'passed' ? '✓' : check.status === 'failed' ? '⚠' : check.status === 'running' ? '…' : '○'}
          </span>
          <span className="hm-system__check-body">
            <span className="hm-system__check-title">{check.label}</span>
            <span className="hm-system__check-sub">{check.sub}</span>
          </span>
          {check.fix && <span className="hm-system__check-fix">fix</span>}
        </button>
      ))}

      {terminal?.open && (
        <div className="hm-sheet hm-command__terminal" role="dialog" aria-modal="true" aria-label={`${terminal.title} terminal`}>
          <button className="hm-sheet__overlay" onClick={closeTerminal} aria-label="Close terminal" />
          <div className="hm-sheet__content hm-command__terminal-content">
            <div className="hm-command__terminal-head">
              <div>
                <h3 className="hm-sheet__title">{terminal.title}</h3>
                <div className="hm-command__terminal-meta">
                  {terminal.running ? 'running' : terminal.exitCode === 0 ? 'completed' : terminal.error ? 'error' : 'finished'}
                  {terminal.pid != null ? ` · pid ${terminal.pid}` : ''}
                  {terminal.exitCode != null ? ` · exit ${terminal.exitCode}` : ''}
                </div>
              </div>
              <button type="button" className="hm-ghost" onClick={closeTerminal}>Close</button>
            </div>
            {terminal.error && <div className="hm-warning-banner hm-warning-banner--error">{terminal.error}</div>}
            <pre className="hm-command__terminal-output" data-testid="terminal-output">
              {terminal.lines.join('\n')}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
