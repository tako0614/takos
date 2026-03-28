/**
 * browser_open handler — creates a new browser session.
 */

import type { ToolHandler } from '../../types';
import {
  getBrowserSessionId,
  setBrowserSessionId,
  browserHostFetch,
} from './session';
import { bytesToHex } from '../../../../shared/utils/encoding-utils';

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
