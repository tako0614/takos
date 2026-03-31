import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

import { assertEquals, assert, assertThrows, assertRejects, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mockBrowserHostFetch = ((..._args: any[]) => undefined) as any;
const mockGetBrowserSessionId = ((..._args: any[]) => undefined) as any;
const mockSetBrowserSessionId = ((..._args: any[]) => undefined) as any;
const mockClearBrowserSessionId = ((..._args: any[]) => undefined) as any;
const mockRequireBrowserSessionId = ((..._args: any[]) => undefined) as any;

// [Deno] vi.mock removed - manually stub imports from '@/tools/builtin/browser/session'
import { BROWSER_TOOLS, BROWSER_HANDLERS } from '@/tools/builtin/browser';
import { browserOpenHandler } from '@/tools/builtin/browser/handlers/open';
import { browserGotoHandler } from '@/tools/builtin/browser/handlers/goto';
import { browserActionHandler } from '@/tools/builtin/browser/handlers/action';
import { browserScreenshotHandler } from '@/tools/builtin/browser/handlers/screenshot';
import { browserExtractHandler } from '@/tools/builtin/browser/handlers/extract';
import { browserHtmlHandler } from '@/tools/builtin/browser/handlers/html';
import { browserCloseHandler } from '@/tools/builtin/browser/handlers/close';
import {
  BROWSER_GOTO,
  BROWSER_ACTION,
  BROWSER_TOOL_DEFINITIONS,
} from '@/tools/builtin/browser/definitions';
import {
  getBrowserSessionId,
  setBrowserSessionId,
  clearBrowserSessionId,
  requireBrowserSessionId,
} from '@/tools/builtin/browser/session';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-test',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: [],
    env: {
      BROWSER_HOST: { fetch: ((..._args: any[]) => undefined) as any },
    } as unknown as Env,
    db: {} as D1Database,
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeTextResponse(text: string, status = 200): Response {
  return new Response(text, { status });
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------


  Deno.test('browser tool definitions - defines all seven browser tools', () => {
  assertEquals(BROWSER_TOOL_DEFINITIONS.length, 7);
    const names = BROWSER_TOOL_DEFINITIONS.map((t) => t.name);
    assertEquals(names, [
      'browser_open',
      'browser_goto',
      'browser_action',
      'browser_screenshot',
      'browser_extract',
      'browser_html',
      'browser_close',
    ]);
})
  Deno.test('browser tool definitions - all tools have browser category', () => {
  for (const def of BROWSER_TOOL_DEFINITIONS) {
      assertEquals(def.category, 'browser');
    }
})
  Deno.test('browser tool definitions - browser_goto requires url parameter', () => {
  assertEquals(BROWSER_GOTO.parameters.required, ['url']);
})
  Deno.test('browser tool definitions - browser_action requires action parameter', () => {
  assertEquals(BROWSER_ACTION.parameters.required, ['action']);
})
  Deno.test('browser tool definitions - BROWSER_TOOLS and BROWSER_HANDLERS are consistent', () => {
  assertEquals(BROWSER_TOOLS.length, 7);
    const handlerKeys = Object.keys(BROWSER_HANDLERS);
    assertEquals(handlerKeys.length, 7);
    for (const def of BROWSER_TOOLS) {
      assert(def.name in BROWSER_HANDLERS);
    }
})
// ---------------------------------------------------------------------------
// Session module
// ---------------------------------------------------------------------------


  
  Deno.test('browser session helpers - getBrowserSessionId returns value from mock', () => {
  mockGetBrowserSessionId = (() => 'session-abc') as any;
    const ctx = makeContext();
    const result = getBrowserSessionId(ctx);
    assertEquals(result, 'session-abc');
})
  Deno.test('browser session helpers - setBrowserSessionId calls mock', () => {
  const ctx = makeContext();
    setBrowserSessionId(ctx, 'session-xyz');
    assertSpyCallArgs(mockSetBrowserSessionId, 0, [ctx, 'session-xyz']);
})
  Deno.test('browser session helpers - clearBrowserSessionId calls mock', () => {
  const ctx = makeContext();
    clearBrowserSessionId(ctx);
    assertSpyCallArgs(mockClearBrowserSessionId, 0, [ctx]);
})
  Deno.test('browser session helpers - requireBrowserSessionId throws when no session exists', () => {
  mockRequireBrowserSessionId = () => {
      throw new Error('No active browser session. Call browser_open first.');
    } as any;
    assertThrows(() => { () => requireBrowserSessionId(makeContext()); }, 'No active browser session');
})
// ---------------------------------------------------------------------------
// browser_open handler
// ---------------------------------------------------------------------------


  
  Deno.test('browserOpenHandler - returns error JSON when a session already exists', async () => {
  mockGetBrowserSessionId = (() => 'existing-session') as any;

    const result = JSON.parse(await browserOpenHandler({}, makeContext()));

    assertStringIncludes(result.error, 'already active');
    assertEquals(result.session_id, 'existing-session');
})
  Deno.test('browserOpenHandler - creates a new session and returns status', async () => {
  mockGetBrowserSessionId = (() => undefined) as any;
    mockBrowserHostFetch = (async () => makeJsonResponse({ ok: true })) as any;

    const result = JSON.parse(
      await browserOpenHandler({ url: 'https://example.com' }, makeContext()),
    );

    assertEquals(result.status, 'active');
    assertEquals(result.url, 'https://example.com');
    assertEquals(result.viewport, { width: 1280, height: 720 });
    assert(mockSetBrowserSessionId.calls.length > 0);
})
  Deno.test('browserOpenHandler - uses custom viewport dimensions', async () => {
  mockGetBrowserSessionId = (() => undefined) as any;
    mockBrowserHostFetch = (async () => makeJsonResponse({ ok: true })) as any;

    const result = JSON.parse(
      await browserOpenHandler(
        { viewport_width: 800, viewport_height: 600 },
        makeContext(),
      ),
    );

    assertEquals(result.viewport, { width: 800, height: 600 });
    assertStringIncludes(result.message, 'Use browser_goto');
})
  Deno.test('browserOpenHandler - throws when browser host returns error', async () => {
  mockGetBrowserSessionId = (() => undefined) as any;
    mockBrowserHostFetch = (async () => makeTextResponse('Service unavailable', 503)) as any;

    await await assertRejects(async () => { await browserOpenHandler({}, makeContext()); }, 
      'Failed to open browser session',
    );
})
// ---------------------------------------------------------------------------
// browser_goto handler
// ---------------------------------------------------------------------------


  
  Deno.test('browserGotoHandler - navigates to url and returns result', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    mockBrowserHostFetch = (async () => makeJsonResponse({ url: 'https://example.com', title: 'Example', status: 200 }),) as any;

    const result = JSON.parse(
      await browserGotoHandler({ url: 'https://example.com' }, makeContext()),
    );

    assertEquals(result.url, 'https://example.com');
    assertEquals(result.title, 'Example');
    assertStringIncludes(result.message, 'Navigated to');
})
  Deno.test('browserGotoHandler - throws when url is missing', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;

    await await assertRejects(async () => { await browserGotoHandler({}, makeContext()); }, 'url is required');
})
  Deno.test('browserGotoHandler - throws when navigation fails', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    mockBrowserHostFetch = (async () => makeTextResponse('timeout', 500)) as any;

    await await assertRejects(async () => { await 
      browserGotoHandler({ url: 'https://example.com' }, makeContext()),
    ; }, 'Navigation failed');
})
// ---------------------------------------------------------------------------
// browser_action handler
// ---------------------------------------------------------------------------


  
  Deno.test('browserActionHandler - throws when action is missing', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    await await assertRejects(async () => { await browserActionHandler({}, makeContext()); }, 'action is required');
})
  Deno.test('browserActionHandler - throws when click has no selector', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    await await assertRejects(async () => { await 
      browserActionHandler({ action: 'click' }, makeContext()),
    ; }, 'selector is required for "click" action');
})
  Deno.test('browserActionHandler - throws when type has no text', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    await await assertRejects(async () => { await 
      browserActionHandler({ action: 'type', selector: '#input' }, makeContext()),
    ; }, 'text is required for "type" action');
})
  Deno.test('browserActionHandler - throws when press has no key', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    await await assertRejects(async () => { await 
      browserActionHandler({ action: 'press' }, makeContext()),
    ; }, 'key is required for "press" action');
})
  Deno.test('browserActionHandler - throws when select has no value', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    await await assertRejects(async () => { await 
      browserActionHandler({ action: 'select', selector: '#sel' }, makeContext()),
    ; }, 'value is required for "select" action');
})
  Deno.test('browserActionHandler - throws for unknown action type', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    await await assertRejects(async () => { await 
      browserActionHandler({ action: 'zap' }, makeContext()),
    ; }, 'Unknown action type: zap');
})
  Deno.test('browserActionHandler - performs click action successfully', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    mockBrowserHostFetch = (async () => makeJsonResponse({ ok: true, message: 'Clicked element' }),) as any;

    const result = await browserActionHandler(
      { action: 'click', selector: '#btn' },
      makeContext(),
    );
    assertEquals(result, 'Clicked element');
})
  Deno.test('browserActionHandler - performs scroll action with defaults', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    mockBrowserHostFetch = (async () => makeJsonResponse({ ok: true, message: 'Scrolled down' }),) as any;

    const result = await browserActionHandler({ action: 'scroll' }, makeContext());
    assertEquals(result, 'Scrolled down');
})
  Deno.test('browserActionHandler - throws when action response is not ok', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    mockBrowserHostFetch = (async () => makeTextResponse('Element not found', 400)) as any;

    await await assertRejects(async () => { await 
      browserActionHandler({ action: 'click', selector: '#missing' }, makeContext()),
    ; }, 'Action failed');
})
  Deno.test('browserActionHandler - validates selector required for hover, check, uncheck, focus, clear', async () => {
  for (const action of ['hover', 'check', 'uncheck', 'focus', 'clear']) {
      mockRequireBrowserSessionId = (() => 'sess-1') as any;
      await await assertRejects(async () => { await 
        browserActionHandler({ action }, makeContext()),
      ; }, `selector is required for "${action}" action`);
    }
})
// ---------------------------------------------------------------------------
// browser_screenshot handler
// ---------------------------------------------------------------------------


  
  Deno.test('browserScreenshotHandler - returns base64-encoded screenshot data', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    const fakeBytes = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
    mockBrowserHostFetch = (async () => new Response(fakeBytes, { status: 200 }),) as any;

    const result = JSON.parse(await browserScreenshotHandler({}, makeContext()));

    assertEquals(result.format, 'png');
    assertEquals(result.encoding, 'base64');
    assertEquals(result.size_bytes, 4);
    assert(result.data);
})
  Deno.test('browserScreenshotHandler - throws when screenshot fails', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    mockBrowserHostFetch = (async () => makeTextResponse('screenshot error', 500)) as any;

    await await assertRejects(async () => { await browserScreenshotHandler({}, makeContext()); }, 
      'Screenshot failed',
    );
})
// ---------------------------------------------------------------------------
// browser_extract handler
// ---------------------------------------------------------------------------


  
  Deno.test('browserExtractHandler - throws when neither selector nor evaluate is provided', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;

    await await assertRejects(async () => { await browserExtractHandler({}, makeContext()); }, 
      'Either selector or evaluate must be provided',
    );
})
  Deno.test('browserExtractHandler - extracts data using a selector', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    mockBrowserHostFetch = (async () => makeJsonResponse({ data: ['result1', 'result2'] }),) as any;

    const result = await browserExtractHandler(
      { selector: '.result__body' },
      makeContext(),
    );

    const parsed = JSON.parse(result);
    assertEquals(parsed, ['result1', 'result2']);
})
  Deno.test('browserExtractHandler - truncates very large outputs', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    const largeData = 'x'.repeat(60000);
    mockBrowserHostFetch = (async () => makeJsonResponse({ data: largeData }),) as any;

    const result = await browserExtractHandler(
      { evaluate: 'document.body.textContent' },
      makeContext(),
    );

    // Source truncates to 50000 chars and appends '\n\n... (truncated)' (17 chars)
    assert(result.length <= 50000 + 17);
    assertStringIncludes(result, '... (truncated)');
})
  Deno.test('browserExtractHandler - throws when extraction fails', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    mockBrowserHostFetch = (async () => makeTextResponse('extraction error', 500)) as any;

    await await assertRejects(async () => { await 
      browserExtractHandler({ selector: '.missing' }, makeContext()),
    ; }, 'Extraction failed');
})
// ---------------------------------------------------------------------------
// browser_html handler
// ---------------------------------------------------------------------------


  
  Deno.test('browserHtmlHandler - returns page html', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    mockBrowserHostFetch = (async () => makeJsonResponse({ html: '<html><body>test</body></html>', url: 'https://example.com' }),) as any;

    const result = JSON.parse(await browserHtmlHandler({}, makeContext()));

    assertEquals(result.url, 'https://example.com');
    assertStringIncludes(result.html, '<html>');
    assertEquals(result.truncated, false);
})
  Deno.test('browserHtmlHandler - truncates html exceeding max length', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    const largeHtml = '<div>' + 'a'.repeat(200000) + '</div>';
    mockBrowserHostFetch = (async () => makeJsonResponse({ html: largeHtml, url: 'https://example.com' }),) as any;

    const result = JSON.parse(await browserHtmlHandler({}, makeContext()));

    assertEquals(result.truncated, true);
    assertEquals(result.html.length, 100000);
})
  Deno.test('browserHtmlHandler - throws when getting html fails', async () => {
  mockRequireBrowserSessionId = (() => 'sess-1') as any;
    mockBrowserHostFetch = (async () => makeTextResponse('html error', 500)) as any;

    await await assertRejects(async () => { await browserHtmlHandler({}, makeContext()); }, 'Failed to get HTML');
})
// ---------------------------------------------------------------------------
// browser_close handler
// ---------------------------------------------------------------------------


  
  Deno.test('browserCloseHandler - returns message when no session is active', async () => {
  mockGetBrowserSessionId = (() => undefined) as any;

    const result = await browserCloseHandler({}, makeContext());
    assertEquals(result, 'No active browser session to close.');
})
  Deno.test('browserCloseHandler - closes active session', async () => {
  mockGetBrowserSessionId = (() => 'sess-1') as any;
    mockBrowserHostFetch = (async () => makeJsonResponse({ ok: true })) as any;

    const result = await browserCloseHandler({}, makeContext());

    assertEquals(result, 'Browser session closed successfully.');
    assert(mockClearBrowserSessionId.calls.length > 0);
})
  Deno.test('browserCloseHandler - still clears session when host deletion fails', async () => {
  mockGetBrowserSessionId = (() => 'sess-1') as any;
    mockBrowserHostFetch = (async () => { throw new Error('service down'); }) as any;

    const result = await browserCloseHandler({}, makeContext());

    assertEquals(result, 'Browser session closed successfully.');
    assert(mockClearBrowserSessionId.calls.length > 0);
})