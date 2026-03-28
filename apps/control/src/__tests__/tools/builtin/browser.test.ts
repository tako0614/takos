import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockBrowserHostFetch = vi.fn();
const mockGetBrowserSessionId = vi.fn();
const mockSetBrowserSessionId = vi.fn();
const mockClearBrowserSessionId = vi.fn();
const mockRequireBrowserSessionId = vi.fn();

vi.mock('@/tools/builtin/browser/session', () => ({
  getBrowserSessionId: (...args: unknown[]) => mockGetBrowserSessionId(...args),
  setBrowserSessionId: (...args: unknown[]) => mockSetBrowserSessionId(...args),
  clearBrowserSessionId: (...args: unknown[]) => mockClearBrowserSessionId(...args),
  requireBrowserSessionId: (...args: unknown[]) => mockRequireBrowserSessionId(...args),
  browserHostFetch: (...args: unknown[]) => mockBrowserHostFetch(...args),
}));

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
      BROWSER_HOST: { fetch: vi.fn() },
    } as unknown as Env,
    db: {} as D1Database,
    setSessionId: vi.fn(),
    getLastContainerStartFailure: vi.fn(() => undefined),
    setLastContainerStartFailure: vi.fn(),
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

describe('browser tool definitions', () => {
  it('defines all seven browser tools', () => {
    expect(BROWSER_TOOL_DEFINITIONS).toHaveLength(7);
    const names = BROWSER_TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toEqual([
      'browser_open',
      'browser_goto',
      'browser_action',
      'browser_screenshot',
      'browser_extract',
      'browser_html',
      'browser_close',
    ]);
  });

  it('all tools have browser category', () => {
    for (const def of BROWSER_TOOL_DEFINITIONS) {
      expect(def.category).toBe('browser');
    }
  });

  it('browser_goto requires url parameter', () => {
    expect(BROWSER_GOTO.parameters.required).toEqual(['url']);
  });

  it('browser_action requires action parameter', () => {
    expect(BROWSER_ACTION.parameters.required).toEqual(['action']);
  });

  it('BROWSER_TOOLS and BROWSER_HANDLERS are consistent', () => {
    expect(BROWSER_TOOLS).toHaveLength(7);
    const handlerKeys = Object.keys(BROWSER_HANDLERS);
    expect(handlerKeys).toHaveLength(7);
    for (const def of BROWSER_TOOLS) {
      expect(BROWSER_HANDLERS).toHaveProperty(def.name);
    }
  });
});

// ---------------------------------------------------------------------------
// Session module
// ---------------------------------------------------------------------------

describe('browser session helpers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getBrowserSessionId returns value from mock', () => {
    mockGetBrowserSessionId.mockReturnValue('session-abc');
    const ctx = makeContext();
    const result = getBrowserSessionId(ctx);
    expect(result).toBe('session-abc');
  });

  it('setBrowserSessionId calls mock', () => {
    const ctx = makeContext();
    setBrowserSessionId(ctx, 'session-xyz');
    expect(mockSetBrowserSessionId).toHaveBeenCalledWith(ctx, 'session-xyz');
  });

  it('clearBrowserSessionId calls mock', () => {
    const ctx = makeContext();
    clearBrowserSessionId(ctx);
    expect(mockClearBrowserSessionId).toHaveBeenCalledWith(ctx);
  });

  it('requireBrowserSessionId throws when no session exists', () => {
    mockRequireBrowserSessionId.mockImplementation(() => {
      throw new Error('No active browser session. Call browser_open first.');
    });
    expect(() => requireBrowserSessionId(makeContext())).toThrow('No active browser session');
  });
});

// ---------------------------------------------------------------------------
// browser_open handler
// ---------------------------------------------------------------------------

describe('browserOpenHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error JSON when a session already exists', async () => {
    mockGetBrowserSessionId.mockReturnValue('existing-session');

    const result = JSON.parse(await browserOpenHandler({}, makeContext()));

    expect(result.error).toContain('already active');
    expect(result.session_id).toBe('existing-session');
  });

  it('creates a new session and returns status', async () => {
    mockGetBrowserSessionId.mockReturnValue(undefined);
    mockBrowserHostFetch.mockResolvedValue(makeJsonResponse({ ok: true }));

    const result = JSON.parse(
      await browserOpenHandler({ url: 'https://example.com' }, makeContext()),
    );

    expect(result.status).toBe('active');
    expect(result.url).toBe('https://example.com');
    expect(result.viewport).toEqual({ width: 1280, height: 720 });
    expect(mockSetBrowserSessionId).toHaveBeenCalled();
  });

  it('uses custom viewport dimensions', async () => {
    mockGetBrowserSessionId.mockReturnValue(undefined);
    mockBrowserHostFetch.mockResolvedValue(makeJsonResponse({ ok: true }));

    const result = JSON.parse(
      await browserOpenHandler(
        { viewport_width: 800, viewport_height: 600 },
        makeContext(),
      ),
    );

    expect(result.viewport).toEqual({ width: 800, height: 600 });
    expect(result.message).toContain('Use browser_goto');
  });

  it('throws when browser host returns error', async () => {
    mockGetBrowserSessionId.mockReturnValue(undefined);
    mockBrowserHostFetch.mockResolvedValue(makeTextResponse('Service unavailable', 503));

    await expect(browserOpenHandler({}, makeContext())).rejects.toThrow(
      'Failed to open browser session',
    );
  });
});

// ---------------------------------------------------------------------------
// browser_goto handler
// ---------------------------------------------------------------------------

describe('browserGotoHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('navigates to url and returns result', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    mockBrowserHostFetch.mockResolvedValue(
      makeJsonResponse({ url: 'https://example.com', title: 'Example', status: 200 }),
    );

    const result = JSON.parse(
      await browserGotoHandler({ url: 'https://example.com' }, makeContext()),
    );

    expect(result.url).toBe('https://example.com');
    expect(result.title).toBe('Example');
    expect(result.message).toContain('Navigated to');
  });

  it('throws when url is missing', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');

    await expect(browserGotoHandler({}, makeContext())).rejects.toThrow('url is required');
  });

  it('throws when navigation fails', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    mockBrowserHostFetch.mockResolvedValue(makeTextResponse('timeout', 500));

    await expect(
      browserGotoHandler({ url: 'https://example.com' }, makeContext()),
    ).rejects.toThrow('Navigation failed');
  });
});

// ---------------------------------------------------------------------------
// browser_action handler
// ---------------------------------------------------------------------------

describe('browserActionHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when action is missing', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    await expect(browserActionHandler({}, makeContext())).rejects.toThrow('action is required');
  });

  it('throws when click has no selector', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    await expect(
      browserActionHandler({ action: 'click' }, makeContext()),
    ).rejects.toThrow('selector is required for "click" action');
  });

  it('throws when type has no text', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    await expect(
      browserActionHandler({ action: 'type', selector: '#input' }, makeContext()),
    ).rejects.toThrow('text is required for "type" action');
  });

  it('throws when press has no key', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    await expect(
      browserActionHandler({ action: 'press' }, makeContext()),
    ).rejects.toThrow('key is required for "press" action');
  });

  it('throws when select has no value', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    await expect(
      browserActionHandler({ action: 'select', selector: '#sel' }, makeContext()),
    ).rejects.toThrow('value is required for "select" action');
  });

  it('throws for unknown action type', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    await expect(
      browserActionHandler({ action: 'zap' }, makeContext()),
    ).rejects.toThrow('Unknown action type: zap');
  });

  it('performs click action successfully', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    mockBrowserHostFetch.mockResolvedValue(
      makeJsonResponse({ ok: true, message: 'Clicked element' }),
    );

    const result = await browserActionHandler(
      { action: 'click', selector: '#btn' },
      makeContext(),
    );
    expect(result).toBe('Clicked element');
  });

  it('performs scroll action with defaults', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    mockBrowserHostFetch.mockResolvedValue(
      makeJsonResponse({ ok: true, message: 'Scrolled down' }),
    );

    const result = await browserActionHandler({ action: 'scroll' }, makeContext());
    expect(result).toBe('Scrolled down');
  });

  it('throws when action response is not ok', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    mockBrowserHostFetch.mockResolvedValue(makeTextResponse('Element not found', 400));

    await expect(
      browserActionHandler({ action: 'click', selector: '#missing' }, makeContext()),
    ).rejects.toThrow('Action failed');
  });

  it('validates selector required for hover, check, uncheck, focus, clear', async () => {
    for (const action of ['hover', 'check', 'uncheck', 'focus', 'clear']) {
      mockRequireBrowserSessionId.mockReturnValue('sess-1');
      await expect(
        browserActionHandler({ action }, makeContext()),
      ).rejects.toThrow(`selector is required for "${action}" action`);
    }
  });
});

// ---------------------------------------------------------------------------
// browser_screenshot handler
// ---------------------------------------------------------------------------

describe('browserScreenshotHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns base64-encoded screenshot data', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    const fakeBytes = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
    mockBrowserHostFetch.mockResolvedValue(
      new Response(fakeBytes, { status: 200 }),
    );

    const result = JSON.parse(await browserScreenshotHandler({}, makeContext()));

    expect(result.format).toBe('png');
    expect(result.encoding).toBe('base64');
    expect(result.size_bytes).toBe(4);
    expect(result.data).toBeTruthy();
  });

  it('throws when screenshot fails', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    mockBrowserHostFetch.mockResolvedValue(makeTextResponse('screenshot error', 500));

    await expect(browserScreenshotHandler({}, makeContext())).rejects.toThrow(
      'Screenshot failed',
    );
  });
});

// ---------------------------------------------------------------------------
// browser_extract handler
// ---------------------------------------------------------------------------

describe('browserExtractHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when neither selector nor evaluate is provided', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');

    await expect(browserExtractHandler({}, makeContext())).rejects.toThrow(
      'Either selector or evaluate must be provided',
    );
  });

  it('extracts data using a selector', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    mockBrowserHostFetch.mockResolvedValue(
      makeJsonResponse({ data: ['result1', 'result2'] }),
    );

    const result = await browserExtractHandler(
      { selector: '.result__body' },
      makeContext(),
    );

    const parsed = JSON.parse(result);
    expect(parsed).toEqual(['result1', 'result2']);
  });

  it('truncates very large outputs', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    const largeData = 'x'.repeat(60000);
    mockBrowserHostFetch.mockResolvedValue(
      makeJsonResponse({ data: largeData }),
    );

    const result = await browserExtractHandler(
      { evaluate: 'document.body.textContent' },
      makeContext(),
    );

    // Source truncates to 50000 chars and appends '\n\n... (truncated)' (17 chars)
    expect(result.length).toBeLessThanOrEqual(50000 + 17);
    expect(result).toContain('... (truncated)');
  });

  it('throws when extraction fails', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    mockBrowserHostFetch.mockResolvedValue(makeTextResponse('extraction error', 500));

    await expect(
      browserExtractHandler({ selector: '.missing' }, makeContext()),
    ).rejects.toThrow('Extraction failed');
  });
});

// ---------------------------------------------------------------------------
// browser_html handler
// ---------------------------------------------------------------------------

describe('browserHtmlHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns page html', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    mockBrowserHostFetch.mockResolvedValue(
      makeJsonResponse({ html: '<html><body>test</body></html>', url: 'https://example.com' }),
    );

    const result = JSON.parse(await browserHtmlHandler({}, makeContext()));

    expect(result.url).toBe('https://example.com');
    expect(result.html).toContain('<html>');
    expect(result.truncated).toBe(false);
  });

  it('truncates html exceeding max length', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    const largeHtml = '<div>' + 'a'.repeat(200000) + '</div>';
    mockBrowserHostFetch.mockResolvedValue(
      makeJsonResponse({ html: largeHtml, url: 'https://example.com' }),
    );

    const result = JSON.parse(await browserHtmlHandler({}, makeContext()));

    expect(result.truncated).toBe(true);
    expect(result.html.length).toBe(100000);
  });

  it('throws when getting html fails', async () => {
    mockRequireBrowserSessionId.mockReturnValue('sess-1');
    mockBrowserHostFetch.mockResolvedValue(makeTextResponse('html error', 500));

    await expect(browserHtmlHandler({}, makeContext())).rejects.toThrow('Failed to get HTML');
  });
});

// ---------------------------------------------------------------------------
// browser_close handler
// ---------------------------------------------------------------------------

describe('browserCloseHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns message when no session is active', async () => {
    mockGetBrowserSessionId.mockReturnValue(undefined);

    const result = await browserCloseHandler({}, makeContext());
    expect(result).toBe('No active browser session to close.');
  });

  it('closes active session', async () => {
    mockGetBrowserSessionId.mockReturnValue('sess-1');
    mockBrowserHostFetch.mockResolvedValue(makeJsonResponse({ ok: true }));

    const result = await browserCloseHandler({}, makeContext());

    expect(result).toBe('Browser session closed successfully.');
    expect(mockClearBrowserSessionId).toHaveBeenCalled();
  });

  it('still clears session when host deletion fails', async () => {
    mockGetBrowserSessionId.mockReturnValue('sess-1');
    mockBrowserHostFetch.mockRejectedValue(new Error('service down'));

    const result = await browserCloseHandler({}, makeContext());

    expect(result).toBe('Browser session closed successfully.');
    expect(mockClearBrowserSessionId).toHaveBeenCalled();
  });
});
