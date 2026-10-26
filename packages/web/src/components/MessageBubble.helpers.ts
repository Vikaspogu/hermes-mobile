import { createElement, type AnchorHTMLAttributes, type InputHTMLAttributes } from 'react';
import type { Approval, Message, RpcClient } from '@hermes-pwa/core';

export interface MessageBubbleProps {
  message: Message;
  rpc: RpcClient;
  isLast?: boolean;
  streaming?: boolean;
  liveStatus?: string;
  liveFace?: string | undefined;
  pendingApprovals?: Approval[] | undefined;
  activeSessionIds?: string[] | undefined;
}

export function areMessageBubblePropsEqual(prev: MessageBubbleProps, next: MessageBubbleProps): boolean {
  return (
    prev.message === next.message &&
    prev.rpc === next.rpc &&
    prev.isLast === next.isLast &&
    prev.streaming === next.streaming &&
    prev.liveStatus === next.liveStatus &&
    prev.liveFace === next.liveFace &&
    prev.pendingApprovals === next.pendingApprovals &&
    prev.activeSessionIds === next.activeSessionIds
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
