/**
 * browser_action handler — performs actions on the current page.
 */

import type { ToolHandler } from '../../types';
import { requireBrowserSessionId, browserHostFetch } from './session';

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
