import type { ActionItem, Approval } from '@hermes-pwa/core';

export function selectPendingApprovals(items: ActionItem[]): Approval[] {
  return items.filter((item): item is Approval => item.kind === 'approval' && item.status === 'needs_you');
}

export function pendingApprovalsForMessage(
  pendingApprovals: Approval[],
  index: number,
  messageCount: number,
): Approval[] | undefined {
  return index === messageCount - 1 ? pendingApprovals : undefined;
}

/**
 * The one approval shown in the chat thread's sticky dock (M2/M3 mockup):
 * scoped to the active chat when the approval carries session attribution;
 * unattributed (recovered/global) approvals stay visible in any chat.
 */
export function selectDockApproval(pendingApprovals: Approval[], activeSessionIds: string[]): Approval | undefined {
  const ids = new Set(activeSessionIds);
  return pendingApprovals.find((item) => {
    if (item.sourceSessionId) return ids.has(item.sourceSessionId);
    if (item.sessionId) return ids.has(item.sessionId);
    return true;
  });
}
