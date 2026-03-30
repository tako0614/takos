/**
 * Browser DOM interaction handlers.
 *
 * Consolidates: browser_action, browser_extract, browser_html, browser_screenshot.
 */

import type { ToolHandler } from '../../tool-definitions';
import { requireBrowserSessionId, browserHostFetch } from './session';

/* ------------------------------------------------------------------ */
/*  browser_action                                                     */
/* ------------------------------------------------------------------ */

export const browserActionHandler: ToolHandler = async (args, context) => {
  const sessionId = requireBrowserSessionId(context);
  const actionType = args.action as string;

  if (!actionType) {
    throw new Error('action is required');
  }

  // Build the action payload based on type
  const actionPayload: Record<string, unknown> = { type: actionType };

  switch (actionType) {
    case 'click':
    case 'hover':
    case 'check':
    case 'uncheck':
    case 'focus':
    case 'clear':
      if (!args.selector) throw new Error(`selector is required for "${actionType}" action`);
      actionPayload.selector = args.selector;
      break;

    case 'type':
      if (!args.selector) throw new Error('selector is required for "type" action');
      if (typeof args.text !== 'string') throw new Error('text is required for "type" action');
      actionPayload.selector = args.selector;
      actionPayload.text = args.text;
      break;

    case 'scroll':
      actionPayload.direction = args.direction || 'down';
      actionPayload.amount = args.amount;
      if (args.selector) actionPayload.selector = args.selector;
      break;

    case 'select':
      if (!args.selector) throw new Error('selector is required for "select" action');
      if (!args.value) throw new Error('value is required for "select" action');
      actionPayload.selector = args.selector;
      actionPayload.value = args.value;
      break;

    case 'press':
      if (!args.key) throw new Error('key is required for "press" action');
      actionPayload.key = args.key;
      break;

    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }

  const response = await browserHostFetch(
    context,
    `/session/${sessionId}/action`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(actionPayload),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Action failed: ${error}`);
  }

  const result = await response.json() as { ok: boolean; message: string };
  return result.message;
};

/* ------------------------------------------------------------------ */
/*  browser_extract                                                    */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  browser_html                                                       */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  browser_screenshot                                                 */
/* ------------------------------------------------------------------ */

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
