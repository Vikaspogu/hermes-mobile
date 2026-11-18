import { useEffect, useState } from 'react';
import { HERMES_PWA_VERSION_LABEL } from '../app/version';
import {

  useProfilesStore,
  useSpawnStore,
  type RestClient,
  type SystemStats,
} from '@hermes-pwa/core';
import { fmtPercent, fmtUptime } from '../lib/formatStats';
import { Icon, type IconName } from '../components/Icon';
import '../styles/screens/more.css';

interface MoreProps {
  rest: RestClient;
  onNavigate: (screen: string) => void;
  onBack?: (() => void) | undefined;
}
export function More({ rest, onNavigate, onBack }: MoreProps) {
  const [stats, setStats] = useState<SystemStats | null>(null);
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


  const activeProfile = profiles.find((p) => p.name === activeName);
  const profileSub = `active: ${activeProfile?.displayName ?? activeName ?? 'default'} · ${
    activeProfile?.model?.trim() || 'model not set'
  }`;

  const rows: { key: string; icon: IconName; label: string; sub: string; badge?: string }[] = [
    { key: 'agents', icon: 'sparkle', label: 'Agents', sub: `${activeSubagents} active subagents · spawn tree`, badge: `${activeSubagents} LIVE` },
    { key: 'kanban', icon: 'kanban', label: 'Projects', sub: 'Kanban boards and project work', badge: 'BOARDS' },
    { key: 'skills', icon: 'skills', label: 'Skills', sub: 'Installed capabilities and tools', badge: 'SKILLS' },
    { key: 'cron', icon: 'cron', label: 'Cron', sub: 'Recurring jobs and schedules', badge: 'SCHEDULE' },
    { key: 'profiles', icon: 'profiles', label: 'Profiles', sub: profileSub, badge: 'ACTIVE' },
    { key: 'settings', icon: 'settings', label: 'Settings', sub: 'Model picker, connection and push', badge: 'MODEL' },
  ];

  return (
    <div className="hm-more-screen">
      <header className="hm-more__header">
        {onBack && (
          <button type="button" className="hm-iconbtn" aria-label="Back" onClick={onBack}>
            <Icon name="back" size={20} />
          </button>
        )}
        <div>
          <h1>Control Cockpit</h1>
          <p>hermes-pwa v{HERMES_PWA_VERSION_LABEL}</p>
        </div>
        <button type="button" className="hm-iconbtn hm-more__reload" aria-label="Reload App" onClick={() => window.location.reload()}>
          <Icon name="refresh" size={22} />
        </button>
      </header>
      {stats && (
        <section className="hm-qp-hero hm-more-health" data-testid="more-health">
          <div className="hm-more-health__head">
            <span className="hm-dot" aria-hidden="true" />
            <strong>Gateway running</strong>
            <span className="hm-more-health__up">up {fmtUptime(stats.uptimeSeconds)}</span>
          </div>
          {([
            ['CPU', stats.cpuPercent],
            ['RAM', stats.memoryPercent ?? (stats.memoryTotalMb ? ((stats.memoryUsedMb ?? 0) / stats.memoryTotalMb) * 100 : undefined)],
            ['Disk', stats.diskPercent ?? (stats.diskTotalMb ? ((stats.diskUsedMb ?? 0) / stats.diskTotalMb) * 100 : undefined)],
          ] as const).map(([label, percent]) => (
            <div className="hm-more-health__metric" key={label}>
              <div className="hm-more-health__metric-label"><span>{label}</span><span>{fmtPercent(percent)}</span></div>
              <div className="hm-metricbar">
                <div
                  className={`hm-metricbar__fill${(percent ?? 0) > 85 ? ' hm-metricbar__fill--warn' : ''}`}
                  style={{ width: `${Math.min(100, percent ?? 0)}%` }}
                />
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="hm-more-health__links">
        <button type="button" className="hm-more-health__link" onClick={() => onNavigate('command')}>System details →</button>
        <button type="button" className="hm-more-health__link" onClick={() => onNavigate('artifacts')}>Session artifacts →</button>
      </div>
      <div className="hm-group-label"><span>Control modules</span><span>6 surfaces</span></div>
      <div className="hm-more-list hm-qp-grid-2">
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            className={`hm-qp-tile hm-more-row${row.key === 'skills' || row.key === 'settings' ? ' hm-more-row--amber' : ''}`}
            onClick={() => onNavigate(row.key)}
          >
            <span className="hm-qp-tile__icon hm-more-row__icon" aria-hidden="true">
              <Icon name={row.icon} size={22} />
            </span>
            {row.badge && <span className="hm-more-row__badge">{row.badge}</span>}
            <span className="hm-more-row__text">
              <span className="hm-qp-tile__name hm-more-row__label">{row.label}</span>
              {row.sub && <span className="hm-qp-tile__state hm-more-row__sub">{row.sub}</span>}
            </span>
            <span className="hm-more-row__chev" aria-hidden="true">
              <Icon name="chevR" size={18} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
