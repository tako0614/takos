import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock playwright-core before importing
vi.mock('playwright-core', () => ({
  chromium: {
    launchPersistentContext: vi.fn(),
  },
}));

vi.mock('@takos/common/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

import { BrowserManager } from '../browser-manager.js';
import { chromium } from 'playwright-core';

describe('BrowserManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isAlive', () => {
    it('returns false when context is not started', () => {
      const mgr = new BrowserManager();
      expect(mgr.isAlive()).toBe(false);
    });
  });

  describe('tabs', () => {
    it('returns empty array when context is not started', async () => {
      const mgr = new BrowserManager();
      const tabs = await mgr.tabs();
      expect(tabs).toEqual([]);
    });
  });

  describe('action', () => {
    it('throws when no active page', async () => {
      const mgr = new BrowserManager();
      await expect(
        mgr.action({ type: 'click', selector: '#btn' }),
      ).rejects.toThrow('No active page');
    });
  });

  describe('goto', () => {
    it('throws when no active page', async () => {
      const mgr = new BrowserManager();
      await expect(
        mgr.goto({ url: 'https://example.com' }),
      ).rejects.toThrow('No active page');
    });
  });

  describe('html', () => {
    it('throws when no active page', async () => {
      const mgr = new BrowserManager();
      await expect(mgr.html()).rejects.toThrow('No active page');
    });
  });

  describe('screenshot', () => {
    it('throws when no active page', async () => {
      const mgr = new BrowserManager();
      await expect(mgr.screenshot()).rejects.toThrow('No active page');
    });
  });

  describe('pdf', () => {
    it('throws when no active page', async () => {
      const mgr = new BrowserManager();
      await expect(mgr.pdf()).rejects.toThrow('No active page');
    });
  });

  describe('extract', () => {
    it('throws when no active page', async () => {
      const mgr = new BrowserManager();
      await expect(
        mgr.extract({ selector: 'div' }),
      ).rejects.toThrow('No active page');
    });

    it('throws when neither selector nor evaluate provided (after bootstrap)', async () => {
      // Setup mock context and page
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('about:blank'),
        title: vi.fn().mockResolvedValue(''),
        content: vi.fn(),
        screenshot: vi.fn(),
        pdf: vi.fn(),
        evaluate: vi.fn(),
        $$: vi.fn(),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([mockPage]),
        newPage: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      await expect(mgr.extract({})).rejects.toThrow(
        'Either selector or evaluate must be provided',
      );
    });

    it('extracts data using selector — queries elements and returns tag/text/attributes', async () => {
      const mockElement = {
        evaluate: vi.fn()
          .mockResolvedValueOnce('div')   // tagName
          .mockResolvedValueOnce({ class: 'item', id: 'el1' }), // attributes
        textContent: vi.fn().mockResolvedValue('  Hello World  '),
      };
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('about:blank'),
        title: vi.fn().mockResolvedValue(''),
        $$: vi.fn().mockResolvedValue([mockElement]),
        evaluate: vi.fn(),
        content: vi.fn(),
        screenshot: vi.fn(),
        pdf: vi.fn(),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([mockPage]),
        newPage: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.extract({ selector: '.item' });
      expect(mockPage.$$).toHaveBeenCalledWith('.item');
      expect(result.data).toEqual([
        { tag: 'div', text: 'Hello World', attributes: { class: 'item', id: 'el1' } },
      ]);
    });

    it('extracts data using evaluate — calls page.evaluate with the expression', async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('about:blank'),
        title: vi.fn().mockResolvedValue(''),
        evaluate: vi.fn().mockResolvedValue({ count: 42 }),
        $$: vi.fn(),
        content: vi.fn(),
        screenshot: vi.fn(),
        pdf: vi.fn(),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([mockPage]),
        newPage: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const evalExpr = 'document.querySelectorAll("a").length';
      const result = await mgr.extract({ evaluate: evalExpr });
      expect(mockPage.evaluate).toHaveBeenCalledWith(evalExpr);
      expect(result.data).toEqual({ count: 42 });
    });
  });

  describe('newTab', () => {
    it('throws when context is not started', async () => {
      const mgr = new BrowserManager();
      await expect(mgr.newTab()).rejects.toThrow('Browser not started');
    });
  });

  describe('closeTab', () => {
    it('throws when context is not started', async () => {
      const mgr = new BrowserManager();
      await expect(mgr.closeTab(0)).rejects.toThrow('Browser not started');
    });
  });

  describe('switchTab', () => {
    it('throws when context is not started', async () => {
      const mgr = new BrowserManager();
      await expect(mgr.switchTab(0)).rejects.toThrow('Browser not started');
    });
  });

  describe('close', () => {
    it('does nothing when context is null', async () => {
      const mgr = new BrowserManager();
      // Should not throw
      await mgr.close();
      expect(mgr.isAlive()).toBe(false);
    });
  });

  describe('bootstrap', () => {
    it('launches persistent context and returns page info', async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('about:blank'),
        title: vi.fn().mockResolvedValue('New Tab'),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([mockPage]),
        newPage: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      const result = await mgr.bootstrap({});

      expect(result.ok).toBe(true);
      expect(result.url).toBe('about:blank');
      expect(result.title).toBe('New Tab');
      expect(mgr.isAlive()).toBe(true);
    });

    it('navigates to URL when provided', async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('https://example.com'),
        title: vi.fn().mockResolvedValue('Example'),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([mockPage]),
        newPage: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      const result = await mgr.bootstrap({ url: 'https://example.com' });

      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', {
        waitUntil: 'load',
        timeout: 30000,
      });
      expect(result.url).toBe('https://example.com');
    });

    it('uses custom viewport', async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('about:blank'),
        title: vi.fn().mockResolvedValue(''),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([mockPage]),
        newPage: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      await mgr.bootstrap({ viewport: { width: 1920, height: 1080 } });

      expect(chromium.launchPersistentContext).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          viewport: { width: 1920, height: 1080 },
        }),
      );
    });

    it('creates new page when no default pages exist', async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('about:blank'),
        title: vi.fn().mockResolvedValue(''),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([]),
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      const result = await mgr.bootstrap({});

      expect(mockContext.newPage).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it('closes existing context when re-bootstrapping', async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('about:blank'),
        title: vi.fn().mockResolvedValue(''),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([mockPage]),
        newPage: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      await mgr.bootstrap({});
      await mgr.bootstrap({});

      expect(mockContext.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('goto with mocked context', () => {
    it('returns url, title and status', async () => {
      const mockResponse = { status: vi.fn().mockReturnValue(200) };
      const mockPage = {
        goto: vi.fn().mockResolvedValue(mockResponse),
        url: vi.fn().mockReturnValue('https://example.com/page'),
        title: vi.fn().mockResolvedValue('Page Title'),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([mockPage]),
        newPage: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.goto({ url: 'https://example.com/page' });
      expect(result.url).toBe('https://example.com/page');
      expect(result.title).toBe('Page Title');
      expect(result.status).toBe(200);
    });

    it('returns null status when response is null', async () => {
      const mockPage = {
        goto: vi.fn().mockResolvedValue(null),
        url: vi.fn().mockReturnValue('about:blank'),
        title: vi.fn().mockResolvedValue(''),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([mockPage]),
        newPage: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.goto({ url: 'https://example.com' });
      expect(result.status).toBeNull();
    });
  });

  describe('action with mocked context', () => {
    function setupBrowserWithPage() {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('about:blank'),
        title: vi.fn().mockResolvedValue(''),
        click: vi.fn(),
        fill: vi.fn(),
        selectOption: vi.fn(),
        hover: vi.fn(),
        check: vi.fn(),
        uncheck: vi.fn(),
        focus: vi.fn(),
        $: vi.fn(),
        keyboard: { press: vi.fn() },
        mouse: { wheel: vi.fn() },
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([mockPage]),
        newPage: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);
      return { mockPage, mockContext };
    }

    it('handles click action', async () => {
      const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'click', selector: '#btn' });
      expect(result.ok).toBe(true);
      expect(result.message).toContain('Clicked #btn');
      expect(mockPage.click).toHaveBeenCalledWith('#btn', { button: undefined, clickCount: undefined });
    });

    it('handles type action', async () => {
      const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'type', selector: '#input', text: 'hello' });
      expect(result.ok).toBe(true);
      expect(result.message).toContain('Typed into #input');
      expect(mockPage.fill).toHaveBeenCalledWith('#input', 'hello');
    });

    it('handles select action', async () => {
      const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'select', selector: '#dropdown', value: 'opt1' });
      expect(result.ok).toBe(true);
      expect(result.message).toContain('Selected "opt1"');
    });

    it('handles hover action', async () => {
      const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'hover', selector: '#link' });
      expect(result.ok).toBe(true);
      expect(result.message).toContain('Hovered over #link');
    });

    it('handles press action', async () => {
      const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'press', key: 'Enter' });
      expect(result.ok).toBe(true);
      expect(result.message).toContain('Pressed Enter');
    });

    it('handles press action with modifiers', async () => {
      const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({
        type: 'press',
        key: 'c',
        modifiers: ['Control'],
      });
      expect(result.ok).toBe(true);
      expect(result.message).toContain('Pressed Control+c');
      expect(mockPage.keyboard.press).toHaveBeenCalledWith('Control+c');
    });

    it('handles check action', async () => {
      const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'check', selector: '#checkbox' });
      expect(result.ok).toBe(true);
      expect(result.message).toContain('Checked #checkbox');
    });

    it('handles uncheck action', async () => {
      const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'uncheck', selector: '#checkbox' });
      expect(result.ok).toBe(true);
      expect(result.message).toContain('Unchecked #checkbox');
    });

    it('handles focus action', async () => {
      const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'focus', selector: '#input' });
      expect(result.ok).toBe(true);
      expect(result.message).toContain('Focused #input');
    });

    it('handles clear action', async () => {
      const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'clear', selector: '#input' });
      expect(result.ok).toBe(true);
      expect(result.message).toContain('Cleared #input');
      expect(mockPage.fill).toHaveBeenCalledWith('#input', '');
    });

    it('handles scroll down without selector', async () => {
      const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'scroll', direction: 'down' });
      expect(result.ok).toBe(true);
      expect(result.message).toContain('Scrolled down by 500px');
      expect(mockPage.mouse.wheel).toHaveBeenCalledWith(0, 500);
    });

    it('handles scroll up with custom amount', async () => {
      const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'scroll', direction: 'up', amount: 200 });
      expect(result.ok).toBe(true);
      expect(result.message).toContain('Scrolled up by 200px');
      expect(mockPage.mouse.wheel).toHaveBeenCalledWith(0, -200);
    });

    it('handles scroll right', async () => {
      const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'scroll', direction: 'right', amount: 300 });
      expect(mockPage.mouse.wheel).toHaveBeenCalledWith(300, 0);
    });

    it('handles scroll left', async () => {
      const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.action({ type: 'scroll', direction: 'left', amount: 100 });
      expect(mockPage.mouse.wheel).toHaveBeenCalledWith(-100, 0);
    });

    it('throws for unknown action type', async () => {
      const { mockPage } = setupBrowserWithPage();
      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      await expect(
        mgr.action({ type: 'unknown-action' } as any),
      ).rejects.toThrow('Unknown action type: unknown-action');
    });
  });

  describe('html with mocked context', () => {
    it('returns page content and url', async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('https://example.com'),
        title: vi.fn().mockResolvedValue('Example'),
        content: vi.fn().mockResolvedValue('<html><body><h1>Hello</h1></body></html>'),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([mockPage]),
        newPage: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.html();
      expect(mockPage.content).toHaveBeenCalled();
      expect(result.html).toBe('<html><body><h1>Hello</h1></body></html>');
      expect(result.url).toBe('https://example.com');
    });
  });

  describe('screenshot with mocked context', () => {
    it('calls page.screenshot with fullPage=false and type=png and returns buffer', async () => {
      const screenshotBuffer = Buffer.from('fake-png-data');
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('about:blank'),
        title: vi.fn().mockResolvedValue(''),
        screenshot: vi.fn().mockResolvedValue(screenshotBuffer),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([mockPage]),
        newPage: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.screenshot();
      expect(mockPage.screenshot).toHaveBeenCalledWith({ type: 'png', fullPage: false });
      expect(result).toBe(screenshotBuffer);
      expect(Buffer.isBuffer(result)).toBe(true);
    });
  });

  describe('pdf with mocked context', () => {
    it('calls page.pdf with A4 format and returns buffer', async () => {
      const pdfBuffer = Buffer.from('fake-pdf-data');
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('about:blank'),
        title: vi.fn().mockResolvedValue(''),
        pdf: vi.fn().mockResolvedValue(pdfBuffer),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([mockPage]),
        newPage: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.pdf();
      expect(mockPage.pdf).toHaveBeenCalledWith({ format: 'A4' });
      expect(result).toBe(pdfBuffer);
      expect(Buffer.isBuffer(result)).toBe(true);
    });
  });

  describe('close with mocked context', () => {
    it('closes the context and resets state', async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('about:blank'),
        title: vi.fn().mockResolvedValue(''),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([mockPage]),
        newPage: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      await mgr.bootstrap({});
      expect(mgr.isAlive()).toBe(true);

      await mgr.close();

      expect(mockContext.close).toHaveBeenCalled();
      expect(mgr.isAlive()).toBe(false);
      // After close, methods requiring a page should throw
      await expect(mgr.html()).rejects.toThrow('No active page');
      await expect(mgr.screenshot()).rejects.toThrow('No active page');
    });

    it('handles error during context.close gracefully', async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('about:blank'),
        title: vi.fn().mockResolvedValue(''),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([mockPage]),
        newPage: vi.fn(),
        close: vi.fn().mockRejectedValue(new Error('Browser crashed')),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      // Should not throw even when context.close fails
      await mgr.close();
      expect(mgr.isAlive()).toBe(false);
    });
  });

  describe('tab management with mocked context', () => {
    it('closeTab throws for out-of-range index', async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('about:blank'),
        title: vi.fn().mockResolvedValue(''),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([mockPage]),
        newPage: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      await expect(mgr.closeTab(5)).rejects.toThrow('Tab index 5 out of range');
      await expect(mgr.closeTab(-1)).rejects.toThrow('Tab index -1 out of range');
    });

    it('switchTab throws for out-of-range index', async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('about:blank'),
        title: vi.fn().mockResolvedValue(''),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([mockPage]),
        newPage: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      await expect(mgr.switchTab(3)).rejects.toThrow('Tab index 3 out of range');
    });

    it('newTab creates page and sets it as active', async () => {
      const newMockPage = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('about:blank'),
        title: vi.fn().mockResolvedValue(''),
      };
      const origPage = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('about:blank'),
        title: vi.fn().mockResolvedValue(''),
      };
      const mockContext = {
        pages: vi.fn()
          .mockReturnValueOnce([origPage]) // bootstrap
          .mockReturnValue([origPage, newMockPage]), // after newTab
        newPage: vi.fn().mockResolvedValue(newMockPage),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const result = await mgr.newTab();
      expect(result.index).toBe(1);
      expect(result.url).toBe('about:blank');
    });

    it('tabs returns info for each page', async () => {
      const page1 = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('https://a.com'),
        title: vi.fn().mockResolvedValue('Page A'),
      };
      const page2 = {
        goto: vi.fn(),
        url: vi.fn().mockReturnValue('https://b.com'),
        title: vi.fn().mockResolvedValue('Page B'),
      };
      const mockContext = {
        pages: vi.fn().mockReturnValue([page1, page2]),
        newPage: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(mockContext as any);

      const mgr = new BrowserManager();
      await mgr.bootstrap({});

      const tabs = await mgr.tabs();
      expect(tabs).toHaveLength(2);
      expect(tabs[0].url).toBe('https://a.com');
      expect(tabs[0].active).toBe(true);
      expect(tabs[1].url).toBe('https://b.com');
      expect(tabs[1].active).toBe(false);
    });
  });
});
