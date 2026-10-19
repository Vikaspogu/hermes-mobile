export function fmtUptime(s: number | undefined): string {
  if (!s) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function fmtGb(mb: number | undefined): string {
  if (mb == null) return '—';
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function fmtPercent(value: number | undefined): string {
  return value == null ? '—' : `${value.toFixed(1)}%`;
}
