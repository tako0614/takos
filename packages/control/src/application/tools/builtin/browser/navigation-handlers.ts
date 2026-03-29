/**
 * Browser navigation & session lifecycle handlers.
 *
 * Consolidates: browser_open, browser_goto, browser_close.
 */

import type { ToolHandler } from '../../types';
import {
  getBrowserSessionId,
  setBrowserSessionId,
  clearBrowserSessionId,
  requireBrowserSessionId,
  browserHostFetch,
} from './session';
import { bytesToHex } from '../../../../shared/utils/encoding-utils';

/* ------------------------------------------------------------------ */
/*  browser_open                                                       */
/* ------------------------------------------------------------------ */

function generateBrowserSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export const browserOpenHandler: ToolHandler = async (args, context) => {
  // Check for existing session
  const existing = getBrowserSessionId(context);
  if (existing) {
    return JSON.stringify({
      error: 'A browser session is already active. Close it with browser_close before opening a new one.',
      session_id: existing,
    });
  }

  const url = args.url as string | undefined;
  const viewportWidth = (args.viewport_width as number) || 1280;
  const viewportHeight = (args.viewport_height as number) || 720;

  const sessionId = generateBrowserSessionId();

  const response = await browserHostFetch(context, '/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      spaceId: context.spaceId,
      userId: context.userId,
      url,
      viewport: { width: viewportWidth, height: viewportHeight },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to open browser session: ${error}`);
  }

  setBrowserSessionId(context, sessionId);

  const result: Record<string, unknown> = {
    session_id: sessionId,
    status: 'active',
    viewport: { width: viewportWidth, height: viewportHeight },
  };

  if (url) {
    result.url = url;
    result.message = `Browser session opened and navigated to ${url}`;
  } else {
    result.message = 'Browser session opened. Use browser_goto to navigate to a URL.';
  }

  return JSON.stringify(result, null, 2);
};

/* ------------------------------------------------------------------ */
/*  browser_goto                                                       */
/* ------------------------------------------------------------------ */

export const browserGotoHandler: ToolHandler = async (args, context) => {
  const sessionId = requireBrowserSessionId(context);
  const url = args.url as string;

  if (!url) {
    throw new Error('url is required');
  }

  const waitUntil = (args.wait_until as string) || 'load';

  const response = await browserHostFetch(
    context,
    `/session/${sessionId}/goto`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, waitUntil }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Navigation failed: ${error}`);
  }

  const result = await response.json() as { url: string; title: string; status: number | null };

  return JSON.stringify({
    url: result.url,
    title: result.title,
    status: result.status,
    message: `Navigated to ${result.url}`,
  }, null, 2);
};

/* ------------------------------------------------------------------ */
/*  browser_close                                                      */
/* ------------------------------------------------------------------ */

export const browserCloseHandler: ToolHandler = async (args, context) => {
  const sessionId = getBrowserSessionId(context);
  if (!sessionId) {
    return 'No active browser session to close.';
  }

  try {
    await browserHostFetch(
      context,
      `/session/${sessionId}`,
      { method: 'DELETE' }
    );
  } catch {
    // Best effort — session may already be gone
  }

  clearBrowserSessionId(context);

  return 'Browser session closed successfully.';
};
