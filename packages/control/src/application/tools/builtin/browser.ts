/**
 * Browser tools barrel file.
 *
 * Exports tool definitions and handlers for browser automation.
 */

import type { ToolDefinition, ToolHandler } from '../tool-definitions';
import { BROWSER_TOOL_DEFINITIONS } from './browser/definitions';
import {
  browserOpenHandler,
  browserGotoHandler,
  browserCloseHandler,
} from './browser/navigation-handlers';
import {
  browserActionHandler,
  browserScreenshotHandler,
  browserExtractHandler,
  browserHtmlHandler,
} from './browser/interaction-handlers';

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
