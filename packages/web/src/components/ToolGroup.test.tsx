import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolGroup } from './ToolGroup';
import type { RpcClient } from '@hermes-pwa/core';

const rpcMock = { request: vi.fn(), onFrame: vi.fn(), events: new EventTarget() } as unknown as RpcClient;

describe('ToolGroup', () => {
  it('renders terminal row as "Ran · <command>" when done', () => {
    render(
      <ToolGroup
        rpc={rpcMock}
        tools={[{ id: 't1', name: 'terminal', input: { command: 'pytest -k reconnect' }, output: '2 passed' }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Ran · pytest -k reconnect/i }));
    // Summary + expanded row both carry the title.
    expect(screen.getAllByText('Ran · pytest -k reconnect').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('2 passed')).toBeInTheDocument();
  });

  it('renders running state for tools without output', () => {
    render(<ToolGroup rpc={rpcMock} tools={[{ id: 't1', name: 'search_files', input: { path: 'src' } }]} streaming />);
    expect(screen.getAllByText('Searching files').length).toBeGreaterThanOrEqual(1);
  });

  it('expands a tool row to show output', () => {
    render(<ToolGroup rpc={rpcMock} tools={[{ id: 't1', name: 'terminal', input: { command: 'ls' }, output: 'file.txt' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /Ran · ls/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /Ran · ls/i })[1]!);
    expect(screen.getAllByText('file.txt').length).toBeGreaterThanOrEqual(1);
  });

  it('collapses finished tool groups by default', () => {
    render(<ToolGroup rpc={rpcMock} tools={[{ id: 't1', name: 'terminal', input: { command: 'ls' }, output: 'x' }]} />);
    const header = screen.getByRole('button', { name: /Ran · ls/i });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    // Collapsed: only the header summary carries the title.
    expect(screen.getAllByText('Ran · ls')).toHaveLength(1);
    fireEvent.click(header);
    // Expanded: header summary + row title.
    expect(screen.getAllByText('Ran · ls').length).toBeGreaterThanOrEqual(2);
  });
});
