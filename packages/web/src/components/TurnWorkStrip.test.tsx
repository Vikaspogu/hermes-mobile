import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TurnWorkStrip } from './TurnWorkStrip';
import type { RpcClient } from '@hermes-pwa/core';

const rpcMock = { request: vi.fn(), onFrame: vi.fn(), events: new EventTarget() } as unknown as RpcClient;

describe('TurnWorkStrip', () => {
  it('auto-opens while a tool is still pending approval', () => {
    render(
      <TurnWorkStrip
        rpc={rpcMock}
        groupTools={[{ id: 't1', name: 'execute_code', input: { code: 'x' } }]}
      />,
    );
    expect(screen.getByRole('button', { name: /Worked/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('auto-opens while the turn is streaming', () => {
    render(<TurnWorkStrip rpc={rpcMock} streaming groupThought="thinking..." />);
    expect(screen.getByRole('button', { name: /Worked/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('stays collapsed for a completed turn and shows the duration', () => {
    render(
      <TurnWorkStrip
        rpc={rpcMock}
        durationMs={42_000}
        groupTools={[{ id: 't1', name: 'read', input: { path: 'x' }, output: 'ok' }]}
      />,
    );
    expect(screen.getByRole('button', { name: /Worked for 42s/ })).toHaveAttribute('aria-expanded', 'false');
  });
});
