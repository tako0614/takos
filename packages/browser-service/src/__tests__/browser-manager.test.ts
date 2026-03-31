import { Buffer } from 'node:buffer';
// Mock playwright-core before importing
// [Deno] vi.mock removed - manually stub imports from 'playwright-core'
// [Deno] vi.mock removed - manually stub imports from 'takos-common/logger'
import { BrowserManager } from '../browser-manager.ts';
import { chromium } from 'playwright-core';


  
import { assertEquals, assert, assertRejects, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

    Deno.test('BrowserManager - isAlive - returns false when context is not started', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mgr = new BrowserManager();
      assertEquals(mgr.isAlive(), false);
})  
  
    Deno.test('BrowserManager - tabs - returns empty array when context is not started', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mgr = new BrowserManager();
      const tabs = await mgr.tabs();
      assertEquals(tabs, []);
})  
  
    Deno.test('BrowserManager - action - throws when no active page', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mgr = new BrowserManager();
      await await assertRejects(async () => { await 
        mgr.action({ type: 'click', selector: '#btn' }),
      ; }, 'No active page');
})  
  
    Deno.test('BrowserManager - goto - throws when no active page', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mgr = new BrowserManager();
      await await assertRejects(async () => { await 
        mgr.goto({ url: 'https://example.com' }),
      ; }, 'No active page');
})  
  
    Deno.test('BrowserManager - html - throws when no active page', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mgr = new BrowserManager();
      await await assertRejects(async () => { await mgr.html(); }, 'No active page');
})  
  
    Deno.test('BrowserManager - screenshot - throws when no active page', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mgr = new BrowserManager();
      await await assertRejects(async () => { await mgr.screenshot(); }, 'No active page');
})  
  
    Deno.test('BrowserManager - pdf - throws when no active page', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mgr = new BrowserManager();
      await await assertRejects(async () => { await mgr.pdf(); }, 'No active page');
})  
  
    Deno.test('BrowserManager - extract - throws when no active page', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mgr = new BrowserManager();
      await await assertRejects(async () => { await 
        mgr.extract({ selector: 'div' }),
      ; }, 'No active page');
})
    Deno.test('BrowserManager - extract - throws when neither selector nor evaluate provided (after bootstrap)', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Setup mock context and page
      const mockPage = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'about:blank'),
        title: (async () => ''),
        content: ((..._args: any[]) => undefined) as any,
        screenshot: ((..._args: any[]) => undefined) as any,
        pdf: ((..._args: any[]) => undefined) as any,
        evaluate: ((..._args: any[]) => undefined) as any,
        $$: ((..._args: any[]) => undefined) as any,
      };
      const mockContext = {
        pages: (() => [mockPage]),
        newPage: ((..._args: any[]) => undefined) as any,
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      await await assertRejects(async () => { await mgr.extract({}); }, 
        'Either selector or evaluate must be provided',
      );
})
    Deno.test('BrowserManager - extract - extracts data using selector — queries elements and returns tag/text/attributes', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockElement = {
        evaluate: ((..._args: any[]) => undefined) as any
           = (async () => 'div') as any   // tagName
           = (async () => ({ class: 'item', id: 'el1' })) as any, // attributes
        textContent: (async () => '  Hello World  '),
      };
      const mockPage = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'about:blank'),
        title: (async () => ''),
        $$: (async () => [mockElement]),
        evaluate: ((..._args: any[]) => undefined) as any,
        content: ((..._args: any[]) => undefined) as any,
        screenshot: ((..._args: any[]) => undefined) as any,
        pdf: ((..._args: any[]) => undefined) as any,
      };
      const mockContext = {
        pages: (() => [mockPage]),
        newPage: ((..._args: any[]) => undefined) as any,
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.extract({ selector: '.item' });
      assertSpyCallArgs(mockPage.$$, 0, ['.item']);
      assertEquals(result.data, [
        { tag: 'div', text: 'Hello World', attributes: { class: 'item', id: 'el1' } },
      ]);
})
    Deno.test('BrowserManager - extract - extracts data using evaluate — calls page.evaluate with the expression', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockPage = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'about:blank'),
        title: (async () => ''),
        evaluate: (async () => ({ count: 42 })),
        $$: ((..._args: any[]) => undefined) as any,
        content: ((..._args: any[]) => undefined) as any,
        screenshot: ((..._args: any[]) => undefined) as any,
        pdf: ((..._args: any[]) => undefined) as any,
      };
      const mockContext = {
        pages: (() => [mockPage]),
        newPage: ((..._args: any[]) => undefined) as any,
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const evalExpr = 'document.querySelectorAll("a").length';
      const result = await mgr.extract({ evaluate: evalExpr });
      assertSpyCallArgs(mockPage.evaluate, 0, [evalExpr]);
      assertEquals(result.data, { count: 42 });
})  
  
    Deno.test('BrowserManager - newTab - throws when context is not started', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mgr = new BrowserManager();
      await await assertRejects(async () => { await mgr.newTab(); }, 'Browser not started');
})  
  
    Deno.test('BrowserManager - closeTab - throws when context is not started', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mgr = new BrowserManager();
      await await assertRejects(async () => { await mgr.closeTab(0); }, 'Browser not started');
})  
  
    Deno.test('BrowserManager - switchTab - throws when context is not started', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mgr = new BrowserManager();
      await await assertRejects(async () => { await mgr.switchTab(0); }, 'Browser not started');
})  
  
    Deno.test('BrowserManager - close - does nothing when context is null', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mgr = new BrowserManager();
      // Should not throw
      await mgr.close();
      assertEquals(mgr.isAlive(), false);
})  
  
    Deno.test('BrowserManager - bootstrap - launches persistent context and returns page info', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockPage = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'about:blank'),
        title: (async () => 'New Tab'),
      };
      const mockContext = {
        pages: (() => [mockPage]),
        newPage: ((..._args: any[]) => undefined) as any,
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      const result = await mgr.bootstrap({});

      assertEquals(result.ok, true);
      assertEquals(result.url, 'about:blank');
      assertEquals(result.title, 'New Tab');
      assertEquals(mgr.isAlive(), true);
})
    Deno.test('BrowserManager - bootstrap - navigates to URL when provided', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockPage = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'https://example.com'),
        title: (async () => 'Example'),
      };
      const mockContext = {
        pages: (() => [mockPage]),
        newPage: ((..._args: any[]) => undefined) as any,
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      const result = await mgr.bootstrap({ url: 'https://example.com' });

      assertSpyCallArgs(mockPage.goto, 0, ['https://example.com', {
        waitUntil: 'load',
        timeout: 30000,
      }]);
      assertEquals(result.url, 'https://example.com');
})
    Deno.test('BrowserManager - bootstrap - uses custom viewport', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockPage = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'about:blank'),
        title: (async () => ''),
      };
      const mockContext = {
        pages: (() => [mockPage]),
        newPage: ((..._args: any[]) => undefined) as any,
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      await mgr.bootstrap({ viewport: { width: 1920, height: 1080 } });

      assertSpyCallArgs(chromium.launchPersistentContext, 0, [
        /* expect.any(String) */ {} as any,
        ({
          viewport: { width: 1920, height: 1080 },
        }),
      ]);
})
    Deno.test('BrowserManager - bootstrap - creates new page when no default pages exist', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockPage = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'about:blank'),
        title: (async () => ''),
      };
      const mockContext = {
        pages: (() => []),
        newPage: (async () => mockPage),
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      const result = await mgr.bootstrap({});

      assert(mockContext.newPage.calls.length > 0);
      assertEquals(result.ok, true);
})
    Deno.test('BrowserManager - bootstrap - closes existing context when re-bootstrapping', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockPage = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'about:blank'),
        title: (async () => ''),
      };
      const mockContext = {
        pages: (() => [mockPage]),
        newPage: ((..._args: any[]) => undefined) as any,
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      await mgr.bootstrap({});
      await mgr.bootstrap({});

      assertSpyCalls(mockContext.close, 1);
})  
  
    Deno.test('BrowserManager - goto with mocked context - returns url, title and status', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockResponse = { status: (() => 200) };
      const mockPage = {
        goto: (async () => mockResponse),
        url: (() => 'https://example.com/page'),
        title: (async () => 'Page Title'),
      };
      const mockContext = {
        pages: (() => [mockPage]),
        newPage: ((..._args: any[]) => undefined) as any,
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.goto({ url: 'https://example.com/page' });
      assertEquals(result.url, 'https://example.com/page');
      assertEquals(result.title, 'Page Title');
      assertEquals(result.status, 200);
})
    Deno.test('BrowserManager - goto with mocked context - returns null status when response is null', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockPage = {
        goto: (async () => null),
        url: (() => 'about:blank'),
        title: (async () => ''),
      };
      const mockContext = {
        pages: (() => [mockPage]),
        newPage: ((..._args: any[]) => undefined) as any,
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.goto({ url: 'https://example.com' });
      assertEquals(result.status, null);
})  
  
    function setupBrowserWithPage() {
      const mockPage = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'about:blank'),
        title: (async () => ''),
        click: ((..._args: any[]) => undefined) as any,
        fill: ((..._args: any[]) => undefined) as any,
        selectOption: ((..._args: any[]) => undefined) as any,
        hover: ((..._args: any[]) => undefined) as any,
        check: ((..._args: any[]) => undefined) as any,
        uncheck: ((..._args: any[]) => undefined) as any,
        focus: ((..._args: any[]) => undefined) as any,
        $: ((..._args: any[]) => undefined) as any,
        keyboard: { press: ((..._args: any[]) => undefined) as any },
        mouse: { wheel: ((..._args: any[]) => undefined) as any },
      };
      const mockContext = {
        pages: (() => [mockPage]),
        newPage: ((..._args: any[]) => undefined) as any,
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;
      return { mockPage, mockContext };
    }

    Deno.test('BrowserManager - action with mocked context - handles click action', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'click', selector: '#btn' });
      assertEquals(result.ok, true);
      assertStringIncludes(result.message, 'Clicked #btn');
      assertSpyCallArgs(mockPage.click, 0, ['#btn', { button: undefined, clickCount: undefined }]);
})
    Deno.test('BrowserManager - action with mocked context - handles type action', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'type', selector: '#input', text: 'hello' });
      assertEquals(result.ok, true);
      assertStringIncludes(result.message, 'Typed into #input');
      assertSpyCallArgs(mockPage.fill, 0, ['#input', 'hello']);
})
    Deno.test('BrowserManager - action with mocked context - handles select action', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'select', selector: '#dropdown', value: 'opt1' });
      assertEquals(result.ok, true);
      assertStringIncludes(result.message, 'Selected "opt1"');
})
    Deno.test('BrowserManager - action with mocked context - handles hover action', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'hover', selector: '#link' });
      assertEquals(result.ok, true);
      assertStringIncludes(result.message, 'Hovered over #link');
})
    Deno.test('BrowserManager - action with mocked context - handles press action', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'press', key: 'Enter' });
      assertEquals(result.ok, true);
      assertStringIncludes(result.message, 'Pressed Enter');
})
    Deno.test('BrowserManager - action with mocked context - handles press action with modifiers', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({
        type: 'press',
        key: 'c',
        modifiers: ['Control'],
      });
      assertEquals(result.ok, true);
      assertStringIncludes(result.message, 'Pressed Control+c');
      assertSpyCallArgs(mockPage.keyboard.press, 0, ['Control+c']);
})
    Deno.test('BrowserManager - action with mocked context - handles check action', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'check', selector: '#checkbox' });
      assertEquals(result.ok, true);
      assertStringIncludes(result.message, 'Checked #checkbox');
})
    Deno.test('BrowserManager - action with mocked context - handles uncheck action', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'uncheck', selector: '#checkbox' });
      assertEquals(result.ok, true);
      assertStringIncludes(result.message, 'Unchecked #checkbox');
})
    Deno.test('BrowserManager - action with mocked context - handles focus action', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'focus', selector: '#input' });
      assertEquals(result.ok, true);
      assertStringIncludes(result.message, 'Focused #input');
})
    Deno.test('BrowserManager - action with mocked context - handles clear action', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'clear', selector: '#input' });
      assertEquals(result.ok, true);
      assertStringIncludes(result.message, 'Cleared #input');
      assertSpyCallArgs(mockPage.fill, 0, ['#input', '']);
})
    Deno.test('BrowserManager - action with mocked context - handles scroll down without selector', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'scroll', direction: 'down' });
      assertEquals(result.ok, true);
      assertStringIncludes(result.message, 'Scrolled down by 500px');
      assertSpyCallArgs(mockPage.mouse.wheel, 0, [0, 500]);
})
    Deno.test('BrowserManager - action with mocked context - handles scroll up with custom amount', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'scroll', direction: 'up', amount: 200 });
      assertEquals(result.ok, true);
      assertStringIncludes(result.message, 'Scrolled up by 200px');
      assertSpyCallArgs(mockPage.mouse.wheel, 0, [0, -200]);
})
    Deno.test('BrowserManager - action with mocked context - handles scroll right', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'scroll', direction: 'right', amount: 300 });
      assertSpyCallArgs(mockPage.mouse.wheel, 0, [300, 0]);
})
    Deno.test('BrowserManager - action with mocked context - handles scroll left', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'scroll', direction: 'left', amount: 100 });
      assertSpyCallArgs(mockPage.mouse.wheel, 0, [-100, 0]);
})
    Deno.test('BrowserManager - action with mocked context - throws for unknown action type', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      await await assertRejects(async () => { await 
        mgr.action({ type: 'unknown-action' } as any),
      ; }, 'Unknown action type: unknown-action');
})  
  
    Deno.test('BrowserManager - html with mocked context - returns page content and url', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockPage = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'https://example.com'),
        title: (async () => 'Example'),
        content: (async () => '<html><body><h1>Hello</h1></body></html>'),
      };
      const mockContext = {
        pages: (() => [mockPage]),
        newPage: ((..._args: any[]) => undefined) as any,
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.html();
      assert(mockPage.content.calls.length > 0);
      assertEquals(result.html, '<html><body><h1>Hello</h1></body></html>');
      assertEquals(result.url, 'https://example.com');
})  
  
    Deno.test('BrowserManager - screenshot with mocked context - calls page.screenshot with fullPage=false and type=png and returns buffer', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const screenshotBuffer = Buffer.from('fake-png-data');
      const mockPage = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'about:blank'),
        title: (async () => ''),
        screenshot: (async () => screenshotBuffer),
      };
      const mockContext = {
        pages: (() => [mockPage]),
        newPage: ((..._args: any[]) => undefined) as any,
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.screenshot();
      assertSpyCallArgs(mockPage.screenshot, 0, [{ type: 'png', fullPage: false }]);
      assertEquals(result, screenshotBuffer);
      assertEquals(Buffer.isBuffer(result), true);
})  
  
    Deno.test('BrowserManager - pdf with mocked context - calls page.pdf with A4 format and returns buffer', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const pdfBuffer = Buffer.from('fake-pdf-data');
      const mockPage = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'about:blank'),
        title: (async () => ''),
        pdf: (async () => pdfBuffer),
      };
      const mockContext = {
        pages: (() => [mockPage]),
        newPage: ((..._args: any[]) => undefined) as any,
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.pdf();
      assertSpyCallArgs(mockPage.pdf, 0, [{ format: 'A4' }]);
      assertEquals(result, pdfBuffer);
      assertEquals(Buffer.isBuffer(result), true);
})  
  
    Deno.test('BrowserManager - close with mocked context - closes the context and resets state', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockPage = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'about:blank'),
        title: (async () => ''),
      };
      const mockContext = {
        pages: (() => [mockPage]),
        newPage: ((..._args: any[]) => undefined) as any,
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      await mgr.bootstrap({});
      assertEquals(mgr.isAlive(), true);

      await mgr.close();

      assert(mockContext.close.calls.length > 0);
      assertEquals(mgr.isAlive(), false);
      // After close, methods requiring a page should throw
      await await assertRejects(async () => { await mgr.html(); }, 'No active page');
      await await assertRejects(async () => { await mgr.screenshot(); }, 'No active page');
})
    Deno.test('BrowserManager - close with mocked context - handles error during context.close gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockPage = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'about:blank'),
        title: (async () => ''),
      };
      const mockContext = {
        pages: (() => [mockPage]),
        newPage: ((..._args: any[]) => undefined) as any,
        close: (async () => { throw new Error('Browser crashed'); }),
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      // Should not throw even when context.close fails
      await mgr.close();
      assertEquals(mgr.isAlive(), false);
})  
  
    Deno.test('BrowserManager - tab management with mocked context - closeTab throws for out-of-range index', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockPage = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'about:blank'),
        title: (async () => ''),
      };
      const mockContext = {
        pages: (() => [mockPage]),
        newPage: ((..._args: any[]) => undefined) as any,
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      await await assertRejects(async () => { await mgr.closeTab(5); }, 'Tab index 5 out of range');
      await await assertRejects(async () => { await mgr.closeTab(-1); }, 'Tab index -1 out of range');
})
    Deno.test('BrowserManager - tab management with mocked context - switchTab throws for out-of-range index', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockPage = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'about:blank'),
        title: (async () => ''),
      };
      const mockContext = {
        pages: (() => [mockPage]),
        newPage: ((..._args: any[]) => undefined) as any,
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      await await assertRejects(async () => { await mgr.switchTab(3); }, 'Tab index 3 out of range');
})
    Deno.test('BrowserManager - tab management with mocked context - newTab creates page and sets it as active', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const newMockPage = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'about:blank'),
        title: (async () => ''),
      };
      const origPage = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'about:blank'),
        title: (async () => ''),
      };
      const mockContext = {
        pages: ((..._args: any[]) => undefined) as any
           = (() => [origPage]) as any // bootstrap
           = (() => [origPage, newMockPage]) as any, // after newTab
        newPage: (async () => newMockPage),
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.newTab();
      assertEquals(result.index, 1);
      assertEquals(result.url, 'about:blank');
})
    Deno.test('BrowserManager - tab management with mocked context - tabs returns info for each page', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const page1 = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'https://a.com'),
        title: (async () => 'Page A'),
      };
      const page2 = {
        goto: ((..._args: any[]) => undefined) as any,
        url: (() => 'https://b.com'),
        title: (async () => 'Page B'),
      };
      const mockContext = {
        pages: (() => [page1, page2]),
        newPage: ((..._args: any[]) => undefined) as any,
        close: ((..._args: any[]) => undefined) as any,
      };
      chromium.launchPersistentContext = (async () => mockContext as any) as any;

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const tabs = await mgr.tabs();
      assertEquals(tabs.length, 2);
      assertEquals(tabs[0].url, 'https://a.com');
      assertEquals(tabs[0].active, true);
      assertEquals(tabs[1].url, 'https://b.com');
      assertEquals(tabs[1].active, false);
})  