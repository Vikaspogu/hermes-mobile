import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CommandCenter } from './CommandCenter';

const makeStatus = (name: string, exitCode: number | null = 0, running = false) => ({
  name,
  running,
  exitCode,
  pid: 4567,
  lines: [`${name} output`],
});

const makeRest = (overrides = {}) => ({
  systemStats: vi.fn().mockResolvedValue({
    pid: 1234,
    uptimeSeconds: 7200,
    cpuPercent: 18,
    memoryUsedMb: 512,
    memoryTotalMb: 2048,
    memoryPercent: 25,
    diskUsedMb: 64 * 1024,
    diskTotalMb: 128 * 1024,
    diskPercent: 50,
    activeSessions: 3,
    version: 'v0.9.0',
  }),
  opsRun: vi.fn().mockResolvedValue({ ok: true, name: 'doctor', pid: 4567 }),
  gatewayAction: vi.fn().mockResolvedValue({ ok: true, name: 'gateway-restart', pid: 4568 }),
  actionStatus: vi.fn((name: string) => Promise.resolve(makeStatus(name))),
  opsCheckpoints: vi.fn().mockResolvedValue([]),
  opsBackups: vi.fn().mockResolvedValue([
    { id: 'backup-state', name: 'hermes-pwa-state-20260611T184500Z', createdAt: Date.now(), sizeMb: 31.1, kind: 'directory' },
    { id: 'backup-archive', name: 'before-hermes-pwa-redesign-20260611T184500Z.zip', createdAt: Date.now() - 5000, sizeMb: 251.6, kind: 'archive' },
  ]),
  ...overrides,
}) as unknown as import('@hermes-pwa/core').RestClient;

describe('CommandCenter (M13 System)', () => {
  it('shows the gateway card with green-dot status, uptime, and Restart/Stop buttons', async () => {
    render(<CommandCenter rest={makeRest()} />);
    await waitFor(() => expect(screen.getByTestId('gateway-card')).toBeInTheDocument());
    expect(screen.getByText(/Gateway running/i)).toBeInTheDocument();
    expect(screen.getByText(/up 2h 0m/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restart…/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Stop…/i })).toBeInTheDocument();
  });

  it('shows CPU, RAM, and Disk metrics with bars', async () => {
    render(<CommandCenter rest={makeRest()} />);
    await waitFor(() => expect(screen.getByText('CPU 18%')).toBeInTheDocument());
    expect(screen.getByText('RAM 0.5 / 2.0 GB')).toBeInTheDocument();
    expect(screen.getByText('Disk 64.0 / 128.0 GB')).toBeInTheDocument();
  });

  it('renders health-check rows derived from action logs and backups', async () => {
    render(<CommandCenter rest={makeRest()} />);
    await waitFor(() => expect(screen.getByText('Security audit')).toBeInTheDocument());
    expect(screen.getByText('Doctor')).toBeInTheDocument();
    expect(screen.getAllByText('passed')).toHaveLength(2);
    expect(screen.getByText('Backups')).toBeInTheDocument();
    expect(screen.getByText(/latest today/i)).toBeInTheDocument();
  });

  it('marks a failed check amber with a fix link', async () => {
    const rest = makeRest({
      actionStatus: vi.fn((name: string) => Promise.resolve(
        name === 'security-audit' ? makeStatus(name, 1) : makeStatus(name),
      )),
    });
    render(<CommandCenter rest={rest} />);
    await waitFor(() => expect(screen.getByText(/failed · exit 1/i)).toBeInTheDocument());
    expect(screen.getByText('fix')).toBeInTheDocument();
  });

  it('marks Backups as failed with fix when there are no backups', async () => {
    const rest = makeRest({ opsBackups: vi.fn().mockResolvedValue([]) });
    render(<CommandCenter rest={rest} />);
    await waitFor(() => expect(screen.getByText(/no backups yet/i)).toBeInTheDocument());
    expect(screen.getByText('fix')).toBeInTheDocument();
  });

  it('runs a health check from its row and streams output in the terminal', async () => {
    const rest = makeRest();
    render(<CommandCenter rest={rest} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Doctor' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Doctor' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: /Doctor terminal/i })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('terminal-output')).toHaveTextContent('doctor output'));
    expect(rest.opsRun).toHaveBeenCalledWith('doctor');
  });

  it('runs a backup from the Backups row', async () => {
    const rest = makeRest({
      opsRun: vi.fn().mockResolvedValue({ ok: true, name: 'backup', pid: 4570 }),
    });
    render(<CommandCenter rest={rest} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Backups' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Backups' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: /Backup terminal/i })).toBeInTheDocument());
    expect(rest.opsRun).toHaveBeenCalledWith('backup');
  });

  it('confirms and starts gateway restart from the Restart button', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const rest = makeRest();
    render(<CommandCenter rest={rest} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Restart…/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Restart…/i }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: /Restart gateway terminal/i })).toBeInTheDocument());
    expect(confirm).toHaveBeenCalled();
    expect(rest.gatewayAction).toHaveBeenCalledWith('restart');
    confirm.mockRestore();
  });

  it('does not call gatewayAction when the confirm is cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const rest = makeRest();
    render(<CommandCenter rest={rest} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Stop…/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Stop…/i }));
    expect(confirm).toHaveBeenCalled();
    expect(rest.gatewayAction).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('shows error on load failure', async () => {
    const rest = makeRest({ systemStats: vi.fn().mockRejectedValue(new Error('network error')) });
    render(<CommandCenter rest={rest} />);
    await waitFor(() => expect(screen.getByText(/network error/)).toBeInTheDocument());
  });
});
