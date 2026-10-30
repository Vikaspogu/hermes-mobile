/**
 * Activity / approvals / clarify domain types.
 */

export type ActionKind = 'approval' | 'clarify' | 'run' | 'system';

export type ActionStatus = 'needs_you' | 'running' | 'completed';

export interface ActionItem {
  id: string;
  kind: ActionKind;
  status: ActionStatus;
  title: string;
  summary?: string;
  sessionId?: string;
  sourceSessionId?: string;
  rpcRequestId?: string | number;
  createdAt: number;
}

export interface Approval extends ActionItem {
  kind: 'approval';
  highImpact: boolean;
  visibility?: 'private' | 'public';
  session?: string;
}

export interface Clarify extends ActionItem {
  kind: 'clarify';
  question: string;
}

export function toActionItem(raw: Record<string, unknown>): ActionItem {
  const kind = (raw.kind as ActionKind) ?? 'system';
  const base: ActionItem = {
    id: String(raw.id ?? ''),
    kind,
    status: (raw.status as ActionStatus) ?? 'needs_you',
    title: typeof raw.title === 'string' ? raw.title : 'Untitled',
    createdAt: typeof raw.created_at === 'number' ? raw.created_at : Date.now(),
  };
  if (typeof raw.session_id === 'string') {
    base.sessionId = raw.session_id;
  } else if (typeof raw.sessionId === 'string') {
    base.sessionId = raw.sessionId;
  }
  if (typeof raw.source_session_id === 'string') {
    base.sourceSessionId = raw.source_session_id;
  } else if (typeof raw.sourceSessionId === 'string') {
    base.sourceSessionId = raw.sourceSessionId;
  }

  if (kind === 'approval') {
    const out: Approval = {
      ...base,
      kind: 'approval',
      highImpact: Boolean(raw.high_impact ?? raw.highImpact),
    };
    if (typeof raw.summary === 'string') out.summary = raw.summary;
    if (typeof raw.session === 'string') out.session = raw.session;
    if (typeof raw.visibility === 'string' && (raw.visibility === 'private' || raw.visibility === 'public')) {
      out.visibility = raw.visibility;
    }
    return out;
  }

  if (kind === 'clarify') {
    const out: Clarify = {
      ...base,
      kind: 'clarify',
      question: typeof raw.question === 'string' ? raw.question : '',
    };
    if (typeof raw.summary === 'string') out.summary = raw.summary;
    return out;
  }

  const out: ActionItem = { ...base };
  if (typeof raw.summary === 'string') out.summary = raw.summary;
  return out;
}
