/**
 * Type definitions for the BrowserSession container host.
 */

import type { DurableObjectNamespace, R2Bucket } from '../../shared/types/bindings.ts';

export interface BrowserSessionEnv {
  BROWSER_CONTAINER: DurableObjectNamespace;
  BROWSER_CHECKPOINTS?: R2Bucket;
  TAKOS_EGRESS?: { fetch(request: Request): Promise<Response> };
}

export interface BrowserSessionTokenInfo {
  sessionId: string;
  spaceId: string;
  userId: string;
}

export interface CreateSessionPayload {
  sessionId: string;
  spaceId: string;
  userId: string;
  url?: string;
  viewport?: { width: number; height: number };
}

export interface BrowserSessionState {
  sessionId: string;
  spaceId: string;
  userId: string;
  status: 'starting' | 'active' | 'stopped';
  createdAt: string;
}
