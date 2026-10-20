import { useEffect, useState } from 'react';
import {
  useChatStore,
  useProfilesStore,
  useSpawnStore,
  type RestClient,
  type SystemStats,
} from '@hermes-pwa/core';
import { fmtGb, fmtPercent, fmtUptime } from '../lib/formatStats';
import '../styles/screens/more.css';

interface MoreProps {
  rest: RestClient;
  onNavigate: (screen: string) => void;
}

export function More({ rest, onNavigate }: MoreProps) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [artifactCount, setArtifactCount] = useState<number | null>(null);
  const sessionId = useChatStore((s) => s.sessionId);
  const activeName = useProfilesStore((s) => s.activeName);
  const profiles = useProfilesStore((s) => s.profiles);
  const activeSubagents = useSpawnStore(
    (s) => s.tree.filter((n) => n.status === 'running' || n.status === 'queued').length,
  );

  useEffect(() => {
    let cancelled = false;
    rest
      .systemStats()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [rest]);

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;
    rest
      .sessionArtifacts(sessionId)
      .then((artifacts) => {
        if (!cancelled) setArtifactCount(artifacts.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [rest, sessionId]);

  const activeProfile = profiles.find((p) => p.name === activeName);
  const profileSub = `active: ${activeProfile?.displayName ?? activeName ?? 'default'} · ${
    activeProfile?.model?.trim() || 'model not set'
  }`;

  const rows: { key: string; icon: string; label: string; sub: string | undefined }[] = [
    { key: 'profiles', icon: '👤', label: 'Profiles', sub: profileSub },
    {
      key: 'agents',
      icon: '✦',
      label: 'Agents',
      sub: `${activeSubagents} active subagent${activeSubagents === 1 ? '' : 's'}`,
    },
    {
      key: 'artifacts',
      icon: '🗂',
      label: 'Artifacts',
      sub: artifactCount != null ? `${artifactCount} files this session` : undefined,
    },
    { key: 'command', icon: '🖥', label: 'System', sub: 'gateway, backups, doctor' },
    { key: 'settings', icon: '⚙', label: 'Settings', sub: 'connection, notifications' },
  ];

  return (
    <div className="hm-more-screen">
      {stats && (
        <section className="hm-more-health" data-testid="more-health">
          <div className="hm-more-health__head">
            <span className="hm-dot" aria-hidden="true" />
            <strong>Gateway running</strong>
            <span className="hm-more-health__up">up {fmtUptime(stats.uptimeSeconds)}</span>
          </div>
          <div className="hm-more-health__metric">
            <span>CPU {fmtPercent(stats.cpuPercent)}</span>
            <div className="hm-metricbar">
              <div className="hm-metricbar__fill" style={{ width: `${Math.min(100, stats.cpuPercent)}%` }} />
            </div>
          </div>
          <div className="hm-more-health__metric">
            <span>
              RAM {fmtGb(stats.memoryUsedMb)} / {fmtGb(stats.memoryTotalMb)}
            </span>
            <div className="hm-metricbar">
              <div
                className="hm-metricbar__fill"
                style={{ width: `${Math.min(100, stats.memoryPercent ?? 0)}%` }}
              />
            </div>
          </div>
          <div className="hm-more-health__metric">
            <span>
              Disk {fmtGb(stats.diskUsedMb)} / {fmtGb(stats.diskTotalMb)}
            </span>
            <div className="hm-metricbar">
              <div
                className="hm-metricbar__fill hm-metricbar__fill--warn"
                style={{ width: `${Math.min(100, stats.diskPercent ?? 0)}%` }}
              />
            </div>
          </div>
        </section>
      )}

      <div className="hm-more-list">
        {rows.map((row) => (
          <button key={row.key} type="button" className="hm-more-row" onClick={() => onNavigate(row.key)}>
            <span className="hm-more-row__icon" aria-hidden="true">
              {row.icon}
            </span>
            <span className="hm-more-row__text">
              <span className="hm-more-row__label">{row.label}</span>
              {row.sub && <span className="hm-more-row__sub">{row.sub}</span>}
            </span>
            <span className="hm-more-row__chev" aria-hidden="true">
              ›
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
