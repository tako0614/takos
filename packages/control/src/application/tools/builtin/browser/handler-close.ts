/**
 * browser_close handler — closes the active browser session.
 */

import type { ToolHandler } from '../../types';
import {
  getBrowserSessionId,
  clearBrowserSessionId,
  browserHostFetch,
} from './session';

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
