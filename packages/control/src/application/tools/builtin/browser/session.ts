/**
 * Browser session helpers for tool handlers.
 *
 * Manages the mapping between a ToolContext (run) and the active browser session.
 * One session per run, stored in a module-level cache.
 */

import type { ToolContext } from '../../tool-definitions.ts';

/**
 * In-memory store: runId → browserSessionId.
 * Cleaned up when browser_close is called.
 */
const runBrowserSessions = new Map<string, string>();

export function getBrowserSessionId(context: ToolContext): string | undefined {
  return runBrowserSessions.get(context.runId);
}

export function setBrowserSessionId(context: ToolContext, sessionId: string): void {
  runBrowserSessions.set(context.runId, sessionId);
}

export function clearBrowserSessionId(context: ToolContext): void {
  runBrowserSessions.delete(context.runId);
}

export function requireBrowserSessionId(context: ToolContext): string {
  const sessionId = getBrowserSessionId(context);
  if (!sessionId) {
    throw new Error('No active browser session. Call browser_open first.');
  }
  return sessionId;
}

/**
 * Forward a request to the BROWSER_HOST service binding.
 */
export async function browserHostFetch(
  context: ToolContext,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const browserHost = context.env.BROWSER_HOST;
  if (!browserHost) {
    throw new Error('Browser service not available. BROWSER_HOST binding is not configured.');
  }
  return browserHost.fetch(
    new Request(`https://browser-host.internal${path}`, init)
  );
}
