/**
 * Browser tools barrel file.
 *
 * Exports tool definitions and handlers for browser automation.
 */

import type { ToolDefinition, ToolHandler } from '../types';
import { BROWSER_TOOL_DEFINITIONS } from './browser/definitions';
import { browserOpenHandler } from './browser/handlers/open';
import { browserGotoHandler } from './browser/handlers/goto';
import { browserActionHandler } from './browser/handlers/action';
import { browserScreenshotHandler } from './browser/handlers/screenshot';
import { browserExtractHandler } from './browser/handlers/extract';
import { browserHtmlHandler } from './browser/handlers/html';
import { browserCloseHandler } from './browser/handlers/close';

export const BROWSER_TOOLS: ToolDefinition[] = BROWSER_TOOL_DEFINITIONS;

export const BROWSER_HANDLERS: Record<string, ToolHandler> = {
  browser_open: browserOpenHandler,
  browser_goto: browserGotoHandler,
  browser_action: browserActionHandler,
  browser_screenshot: browserScreenshotHandler,
  browser_extract: browserExtractHandler,
  browser_html: browserHtmlHandler,
  browser_close: browserCloseHandler,
};
