import { act, render } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { useShallow } from 'zustand/react/shallow';
import { useActivityStore, type Approval, type Clarify } from '@hermes-pwa/core';
import { pendingApprovalsForMessage, selectDockApproval, selectPendingApprovals } from './pendingApprovals';

describe('pending approval selectors', () => {
  beforeEach(() => {
    useActivityStore.setState({ items: [], loading: false, error: undefined });
  });

  it('keeps the selected approval reference stable across unrelated activity-store changes', () => {
    const approval = {
      id: 'approval-1',
      kind: 'approval',
      status: 'needs_you',
      title: 'Approval required',
      highImpact: true,
      sessionId: 'session-1',
      createdAt: 1,
    } as Approval;
    const clarify = {
      id: 'clarify-1',
      kind: 'clarify',
      status: 'needs_you',
      title: 'Question',
      question: 'Continue?',
      createdAt: 2,
    } as Clarify;
    const selections: Approval[][] = [];

    function Probe() {
      const pending = useActivityStore(useShallow((s) => selectPendingApprovals(s.items)));
      selections.push(pending);
      return null;
    }

    render(<Probe />);
    expect(selections).toHaveLength(1);

    act(() => {
      useActivityStore.setState({ items: [approval], loading: false, error: undefined });
    });
    expect(selections).toHaveLength(2);
    const selectedWithApproval = selections[1];

    act(() => {
      useActivityStore.setState({ items: [approval, clarify], loading: false, error: undefined });
    });
    expect(selections).toHaveLength(2);
    expect(selections[1]).toBe(selectedWithApproval);
  });

  it('passes recovered approval props only to the last message bubble', () => {
    const approvals = [
      {
        id: 'approval-1',
        kind: 'approval',
        status: 'needs_you',
        title: 'Approval required',
        highImpact: true,
        sessionId: 'session-1',
        createdAt: 1,
      } as Approval,
    ];

    expect(pendingApprovalsForMessage(approvals, 0, 2)).toBeUndefined();
    expect(pendingApprovalsForMessage(approvals, 1, 2)).toBe(approvals);
  });

  it('never exposes a high-risk approval without an explicit source thread in a chat dock', () => {
    const highRisk = { id: 'high', kind: 'approval', status: 'needs_you', highImpact: true } as Approval;
    const queueOnly = { ...highRisk, id: 'queue-only', sessionId: 'queue-key' } as Approval;
    const attributed = { ...highRisk, id: 'attributed', sourceSessionId: 'thread-1', sessionId: 'queue-key' } as Approval;
    const lowRisk = { id: 'low', kind: 'approval', status: 'needs_you', highImpact: false } as Approval;

    expect(selectDockApproval([highRisk], ['other-session'])).toBeUndefined();
    expect(selectDockApproval([queueOnly], ['queue-key'])).toBeUndefined();
    expect(selectDockApproval([attributed], ['thread-1'])).toBe(attributed);
    expect(selectDockApproval([lowRisk], ['other-session'])).toBe(lowRisk);
  });
});
