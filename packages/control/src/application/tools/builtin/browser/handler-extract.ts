/**
 * browser_extract handler — extracts data from the current page.
 */

import type { ToolHandler } from '../../types';
import { requireBrowserSessionId, browserHostFetch } from './session';

export const browserExtractHandler: ToolHandler = async (args, context) => {
  const sessionId = requireBrowserSessionId(context);

  const selector = args.selector as string | undefined;
  const evaluate = args.evaluate as string | undefined;

  if (!selector && !evaluate) {
    throw new Error('Either selector or evaluate must be provided');
  }

  const response = await browserHostFetch(
    context,
    `/session/${sessionId}/extract`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector, evaluate }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Extraction failed: ${error}`);
  }

  const result = await response.json() as { data: unknown };

  // Truncate large results
  const output = JSON.stringify(result.data, null, 2);
  const MAX_OUTPUT = 50000;
  if (output.length > MAX_OUTPUT) {
    return output.slice(0, MAX_OUTPUT) + '\n\n... (truncated)';
  }
  return output;
};
