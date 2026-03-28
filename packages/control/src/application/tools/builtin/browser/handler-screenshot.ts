/**
 * browser_screenshot handler — captures a screenshot of the current page.
 */

import type { ToolHandler } from '../../types';
import { requireBrowserSessionId, browserHostFetch } from './session';

export const browserScreenshotHandler: ToolHandler = async (args, context) => {
  const sessionId = requireBrowserSessionId(context);

  const response = await browserHostFetch(
    context,
    `/session/${sessionId}/screenshot`
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Screenshot failed: ${error}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64 = btoa(
    String.fromCharCode(...new Uint8Array(arrayBuffer))
  );

  return JSON.stringify({
    format: 'png',
    encoding: 'base64',
    size_bytes: arrayBuffer.byteLength,
    data: base64,
    message: 'Screenshot captured successfully',
  }, null, 2);
};
