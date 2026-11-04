import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolGroup } from './ToolGroup';
import type { RpcClient } from '@hermes-pwa/core';

const rpcMock = { request: vi.fn(), onFrame: vi.fn(), events: new EventTarget() } as unknown as RpcClient;

describe('ToolGroup', () => {
  it('labels failed tools as failed rather than completed successfully', () => {
    render(<ToolGroup rpc={rpcMock} durationMs={9000} tools={[
      { id: 'failed', name: 'terminal', input: { command: 'false' }, output: '{"error":"Command failed"}' },
    ]} />);
    expect(screen.getByRole('button', { name: /1 step · failed/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /1 step · failed/i }));
    expect(screen.getByRole('button', { name: /Ran · false/i }).closest('.hm-tool-group__row')).toHaveClass('hm-tool-group__row--error');
  });

  it('keeps mixed running and failed work running while marking the failed row', () => {
    render(<ToolGroup rpc={rpcMock} streaming tools={[
      { id: 'failed', name: 'terminal', input: { command: 'false' }, output: '{"error":"Command failed"}' },
      { id: 'pending', name: 'read_file', input: { path: 'README.md' } },
    ]} />);
    expect(screen.getByRole('button', { name: /2 steps · running/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ran · false/i }).closest('.hm-tool-group__row')).toHaveClass('hm-tool-group__row--error');
  });

  it('updates the failure label when a tool output changes in place', () => {
    const tools = [{ id: 'tool', name: 'terminal', input: { command: 'false' }, output: 'done' }];
    const { rerender } = render(<ToolGroup rpc={rpcMock} tools={tools} />);
    expect(screen.getByRole('button', { name: /1 step · done/i })).toBeInTheDocument();
    tools[0]!.output = '{"error":"Command failed"}';
    rerender(<ToolGroup rpc={rpcMock} tools={tools} />);
    expect(screen.getByRole('button', { name: /1 step · failed/i })).toBeInTheDocument();
  });

  it('renders terminal row as "Ran · <command>" when done', () => {
    render(
      <ToolGroup
        rpc={rpcMock}
        tools={[{ id: 't1', name: 'terminal', input: { command: 'pytest -k reconnect' }, output: '2 passed' }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /1 step · done/i }));
    expect(screen.getByText('Ran · pytest -k reconnect')).toBeInTheDocument();
    expect(screen.getByText('2 passed')).toBeInTheDocument();
  });

  it('renders running state for tools without output', () => {
    render(<ToolGroup rpc={rpcMock} tools={[{ id: 't1', name: 'search_files', input: { path: 'src' } }]} streaming />);
    expect(screen.getByText('Searching files')).toBeInTheDocument();
  });

  it('expands a tool row to show output', () => {
    render(<ToolGroup rpc={rpcMock} tools={[{ id: 't1', name: 'terminal', input: { command: 'ls' }, output: 'file.txt' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /1 step · done/i }));
    fireEvent.click(screen.getByRole('button', { name: /Ran/i }));
    expect(screen.getAllByText('file.txt').length).toBeGreaterThanOrEqual(1);
  });

  it('collapses finished tool groups by default', () => {
    render(<ToolGroup rpc={rpcMock} tools={[{ id: 't1', name: 'terminal', input: { command: 'ls' }, output: 'x' }]} />);
    const header = screen.getByRole('button', { name: /1 step · done/i });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Ran · ls')).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByText('Ran · ls')).toBeInTheDocument();
  });

  it('shows "Worked for Xm" when durationMs is set', () => {
    render(
      <ToolGroup
        rpc={rpcMock}
        tools={[{ id: 't1', name: 'terminal', input: { command: 'ls' }, output: 'x' }]}
        durationMs={120000}
      />,
    );
    expect(screen.getByRole('button', { name: /Worked for 2m/i })).toBeInTheDocument();
  });

  it('formats sub-minute durations as seconds', () => {
    render(
      <ToolGroup
        rpc={rpcMock}
        tools={[{ id: 't1', name: 'terminal', input: { command: 'ls' }, output: 'x' }]}
        durationMs={9000}
      />,
    );
    expect(screen.getByRole('button', { name: /Worked for 9s/i })).toBeInTheDocument();
  });
});
