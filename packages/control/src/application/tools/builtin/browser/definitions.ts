/**
 * Browser tool definitions for agent use.
 */

import type { ToolDefinition } from '../../tool-definitions.ts';

export const BROWSER_OPEN: ToolDefinition = {
  name: 'browser_open',
  description:
    'Open a new browser session and optionally navigate to a URL. ' +
    'Returns a session ID for subsequent browser operations. ' +
    'Only one browser session can be active at a time per run. ' +
    'To search the web, open https://duckduckgo.com, use browser_action to type your query into the search box (selector: "input[name=q]") and press Enter, ' +
    'then use browser_extract to get search results. For image search, navigate to https://duckduckgo.com/?q=QUERY&iax=images&ia=images.',
  category: 'browser',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Initial URL to navigate to (optional)',
      },
      viewport_width: {
        type: 'number',
        description: 'Viewport width in pixels (default: 1280)',
      },
      viewport_height: {
        type: 'number',
        description: 'Viewport height in pixels (default: 720)',
      },
    },
  },
};

export const BROWSER_GOTO: ToolDefinition = {
  name: 'browser_goto',
  description:
    'Navigate the browser to a URL. Requires an active browser session (call browser_open first).',
  category: 'browser',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to navigate to',
      },
      wait_until: {
        type: 'string',
        description: 'When to consider navigation complete: "load", "domcontentloaded", "networkidle", or "commit"',
        enum: ['load', 'domcontentloaded', 'networkidle', 'commit'],
      },
    },
    required: ['url'],
  },
};

export const BROWSER_ACTION: ToolDefinition = {
  name: 'browser_action',
  description:
    'Perform an action on the current page (click, type, scroll, select, hover, press, etc.). ' +
    'Requires an active browser session.',
  category: 'browser',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action type: click, type, scroll, select, hover, press, check, uncheck, focus, clear',
        enum: ['click', 'type', 'scroll', 'select', 'hover', 'press', 'check', 'uncheck', 'focus', 'clear'],
      },
      selector: {
        type: 'string',
        description: 'CSS selector for the target element',
      },
      text: {
        type: 'string',
        description: 'Text to type (for "type" action)',
      },
      key: {
        type: 'string',
        description: 'Key to press (for "press" action, e.g. "Enter", "Tab", "ArrowDown")',
      },
      value: {
        type: 'string',
        description: 'Value to select (for "select" action)',
      },
      direction: {
        type: 'string',
        description: 'Scroll direction (for "scroll" action): up, down, left, right',
        enum: ['up', 'down', 'left', 'right'],
      },
      amount: {
        type: 'number',
        description: 'Scroll amount in pixels (for "scroll" action, default: 500)',
      },
    },
    required: ['action'],
  },
};

export const BROWSER_SCREENSHOT: ToolDefinition = {
  name: 'browser_screenshot',
  description:
    'Take a screenshot of the current page. Returns the screenshot as a base64-encoded PNG. ' +
    'Requires an active browser session.',
  category: 'browser',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export const BROWSER_EXTRACT: ToolDefinition = {
  name: 'browser_extract',
  description:
    'Extract data from the current page using a CSS selector or JavaScript expression. ' +
    'Useful for extracting search results from DuckDuckGo (selector: ".result__body" for text results, "img.tile--img__img" for image results). ' +
    'Requires an active browser session.',
  category: 'browser',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector to extract elements from',
      },
      evaluate: {
        type: 'string',
        description: 'JavaScript expression to evaluate in the page context',
      },
    },
  },
};

export const BROWSER_HTML: ToolDefinition = {
  name: 'browser_html',
  description:
    'Get the HTML content of the current page. The output may be truncated for large pages. ' +
    'Requires an active browser session.',
  category: 'browser',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export const BROWSER_CLOSE: ToolDefinition = {
  name: 'browser_close',
  description:
    'Close the current browser session and release resources. ' +
    'Call this when done with browser operations.',
  category: 'browser',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export const BROWSER_TOOL_DEFINITIONS: ToolDefinition[] = [
  BROWSER_OPEN,
  BROWSER_GOTO,
  BROWSER_ACTION,
  BROWSER_SCREENSHOT,
  BROWSER_EXTRACT,
  BROWSER_HTML,
  BROWSER_CLOSE,
];
