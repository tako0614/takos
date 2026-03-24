/**
 * browser_html handler — gets the HTML of the current page.
 */

import type { ToolHandler } from '../../../types';
import { requireBrowserSessionId, browserHostFetch } from '../session';

const MAX_HTML_LENGTH = 100000; // 100KB

export const browserHtmlHandler: ToolHandler = async (args, context) => {
  const sessionId = requireBrowserSessionId(context);

  const response = await browserHostFetch(
    context,
    `/session/${sessionId}/html`
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get HTML: ${error}`);
  }

  const result = await response.json() as { html: string; url: string };

  let html = result.html;
  let truncated = false;
  if (html.length > MAX_HTML_LENGTH) {
    html = html.slice(0, MAX_HTML_LENGTH);
    truncated = true;
  }

  return JSON.stringify({
    url: result.url,
    html,
    truncated,
    original_length: result.html.length,
  }, null, 2);
};
