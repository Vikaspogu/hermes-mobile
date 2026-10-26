import type { ActionItem, Approval, Message } from '@hermes-pwa/core';
import { firstStringField } from './toolView';

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
const APPROVAL_ROW_TOOLS = new Set(['terminal', 'execute_code']);

function compactText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * True when the chat can render this approval inline on a pending
 * approval-tool row (ApprovalInline). The dock must then stay hidden so the
 * two surfaces never double-render the same approval.
 */
export function approvalClaimedByToolRow(
  approval: Approval,
  messages: Message[],
  activeSessionIds: string[],
): boolean {
  const ids = new Set(activeSessionIds);
  if (approval.sourceSessionId && !ids.has(approval.sourceSessionId)) return false;
  const pendingTool = messages
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.toolCalls ?? [])
    .find((tool) => APPROVAL_ROW_TOOLS.has(tool.name) && tool.output === undefined);
  if (!pendingTool) return false;
  const summary = firstStringField(pendingTool.input, ['command', 'code', 'context', 'preview']);
  if (summary) {
    const approvalSummary = compactText(approval.summary);
    const toolText = compactText(summary);
    if (approvalSummary && toolText && (approvalSummary.includes(toolText) || toolText.includes(approvalSummary))) return true;
  }
  return approval.sourceSessionId
    ? ids.has(approval.sourceSessionId)
    : Boolean(approval.sessionId && ids.has(approval.sessionId));
}
export function selectDockApproval(pendingApprovals: Approval[], activeSessionIds: string[]): Approval | undefined {
  const ids = new Set(activeSessionIds);
  return pendingApprovals.find((item) => {
    if (item.sourceSessionId) return ids.has(item.sourceSessionId);
    if (item.sessionId) return ids.has(item.sessionId);
    return true;
  });
}
