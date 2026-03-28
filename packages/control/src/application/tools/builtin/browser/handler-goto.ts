/**
 * browser_goto handler — navigates the browser to a URL.
 */

import type { ToolHandler } from '../../types';
import { requireBrowserSessionId, browserHostFetch } from './session';

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
