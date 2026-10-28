import { createElement, type AnchorHTMLAttributes, type InputHTMLAttributes } from 'react';
import type { Approval, Message, RpcClient } from '@hermes-pwa/core';

export interface MessageBubbleProps {
  message: Message;
  rpc: RpcClient;
  isLast?: boolean;
  streaming?: boolean;
  liveStatus?: string;
  liveFace?: string | undefined;
  turnDurationMs?: number | undefined;
  pendingApprovals?: Approval[] | undefined;
  activeSessionIds?: string[] | undefined;
  // When true the bubble's thinking/todo/tool actions are rendered by the turn work
  // strip instead; text messages keep their bubble, tool-only bubbles are omitted.
  suppressActions?: boolean | undefined;
}

// Wire timestamps arrive as epoch seconds or millis depending on source; normalize to ms.
export function toEpochMs(v: number | undefined): number | undefined {
  return v === undefined ? undefined : (v < 1e12 ? v * 1000 : v);
}

export function areMessageBubblePropsEqual(prev: MessageBubbleProps, next: MessageBubbleProps): boolean {
  return (
    prev.message === next.message &&
    prev.rpc === next.rpc &&
    prev.isLast === next.isLast &&
    prev.streaming === next.streaming &&
    prev.liveStatus === next.liveStatus &&
    prev.liveFace === next.liveFace &&
    prev.turnDurationMs === next.turnDurationMs &&
    prev.pendingApprovals === next.pendingApprovals &&
    prev.activeSessionIds === next.activeSessionIds &&
    prev.suppressActions === next.suppressActions
  );
}

export const MARKDOWN_COMPONENTS = {
  a: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) =>
    createElement(
      'a',
      {
        ...props,
        href,
        target: '_blank',
        rel: 'noopener noreferrer',
      },
      children,
    ),
  input: ({ checked }: InputHTMLAttributes<HTMLInputElement>) => (checked ? '[x]' : '[ ]'),
};
