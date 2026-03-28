/**
 * Browser lifecycle manager.
 * Manages a Playwright persistent context (Chromium) with tab tracking.
 */

import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { createLogger } from 'takos-common/logger';

const logger = createLogger({ service: 'browserd' });

const PROFILE_DIR = '/tmp/browser-profile';
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const PAGE_LOAD_TIMEOUT_MS = 30_000;
const DEFAULT_ACTION_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export type BrowserAction =
  | { type: 'click'; selector: string; button?: 'left' | 'right' | 'middle'; clickCount?: number }
  | { type: 'type'; selector: string; text: string; delay?: number }
  | { type: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; amount?: number; selector?: string }
  | { type: 'select'; selector: string; value: string }
  | { type: 'hover'; selector: string }
  | { type: 'press'; key: string; modifiers?: Array<'Alt' | 'Control' | 'Meta' | 'Shift'> }
  | { type: 'check'; selector: string }
  | { type: 'uncheck'; selector: string }
  | { type: 'focus'; selector: string }
  | { type: 'clear'; selector: string };

export interface BootstrapPayload {
  url?: string;
  viewport?: { width: number; height: number };
}

export interface GotoPayload {
  url: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  timeout?: number;
}

export interface ExtractPayload {
  selector?: string;
  evaluate?: string;
}

interface TabInfo {
  index: number;
  url: string;
  title: string;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

type ActionOf<T extends BrowserAction['type']> = Extract<BrowserAction, { type: T }>;

type ActionHandlerMap = {
  [K in BrowserAction['type']]: (page: Page, action: ActionOf<K>) => Promise<string>;
};

const actionHandlers: ActionHandlerMap = {
  click: async (page, a) => {
    await page.click(a.selector, { button: a.button, clickCount: a.clickCount });
    return `Clicked ${a.selector}`;
  },
  type: async (page, a) => {
    await page.fill(a.selector, a.text);
    return `Typed into ${a.selector}`;
  },
  scroll: async (page, a) => {
    const amount = a.amount ?? 500;
    if (a.selector) {
      const element = await page.$(a.selector);
      if (!element) throw new Error(`Element not found: ${a.selector}`);
      await element.scrollIntoViewIfNeeded();
    } else {
      const dx = a.direction === 'right' ? amount : a.direction === 'left' ? -amount : 0;
      const dy = a.direction === 'down' ? amount : a.direction === 'up' ? -amount : 0;
      await page.mouse.wheel(dx, dy);
    }
    return `Scrolled ${a.direction} by ${amount}px`;
  },
  select: async (page, a) => {
    await page.selectOption(a.selector, a.value);
    return `Selected "${a.value}" in ${a.selector}`;
  },
  hover: async (page, a) => {
    await page.hover(a.selector);
    return `Hovered over ${a.selector}`;
  },
  press: async (page, a) => {
    const keyCombo = a.modifiers?.length
      ? [...a.modifiers, a.key].join('+')
      : a.key;
    await page.keyboard.press(keyCombo);
    return `Pressed ${keyCombo}`;
  },
  check: async (page, a) => {
    await page.check(a.selector);
    return `Checked ${a.selector}`;
  },
  uncheck: async (page, a) => {
    await page.uncheck(a.selector);
    return `Unchecked ${a.selector}`;
  },
  focus: async (page, a) => {
    await page.focus(a.selector);
    return `Focused ${a.selector}`;
  },
  clear: async (page, a) => {
    await page.fill(a.selector, '');
    return `Cleared ${a.selector}`;
  },
};

/** Type-safe dispatch: narrows `action` to the handler's expected variant. */
function dispatchAction(page: Page, action: BrowserAction): Promise<string> {
  const handler = actionHandlers[action.type] as (
    page: Page,
    action: BrowserAction,
  ) => Promise<string>;
  if (!handler) throw new Error(`Unknown action type: ${(action as any).type}`);
  return handler(page, action);
}

// ---------------------------------------------------------------------------
// BrowserManager
// ---------------------------------------------------------------------------

export class BrowserManager {
  private context: BrowserContext | null = null;
  private activePage: Page | null = null;

  async bootstrap(payload: BootstrapPayload): Promise<{ ok: true; url: string; title: string }> {
    if (this.context) {
      await this.close();
    }

    const viewport = payload.viewport ?? DEFAULT_VIEWPORT;

    logger.info('Launching persistent browser context', { profileDir: PROFILE_DIR, viewport });

    this.context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
      ],
      viewport,
      ignoreHTTPSErrors: false,
    });

    // Use the default page created by persistent context
    const pages = this.context.pages();
    this.activePage = pages[0] ?? await this.context.newPage();

    if (payload.url) {
      await this.activePage.goto(payload.url, { waitUntil: 'load', timeout: PAGE_LOAD_TIMEOUT_MS });
    }

    const url = this.activePage.url();
    const title = await this.activePage.title();

    logger.info('Browser bootstrapped', { url, title });
    return { ok: true, url, title };
  }

  async goto(payload: GotoPayload): Promise<{ url: string; title: string; status: number | null }> {
    const page = this.requirePage();
    const response = await page.goto(payload.url, {
      waitUntil: payload.waitUntil ?? 'load',
      timeout: payload.timeout ?? DEFAULT_ACTION_TIMEOUT_MS,
    });

    const url = page.url();
    const title = await page.title();
    const status = response?.status() ?? null;
    return { url, title, status };
  }

  async action(action: BrowserAction): Promise<{ ok: true; message: string }> {
    const page = this.requirePage();
    const message = await dispatchAction(page, action);
    return { ok: true, message };
  }

  async extract(payload: ExtractPayload): Promise<{ data: unknown }> {
    const page = this.requirePage();

    if (payload.evaluate) {
      const data = await page.evaluate(payload.evaluate);
      return { data };
    }

    if (payload.selector) {
      const elements = await page.$$(payload.selector);
      const data = await Promise.all(
        elements.map(async (el) => ({
          tag: await el.evaluate((node) => node.tagName.toLowerCase()),
          text: (await el.textContent())?.trim() ?? '',
          attributes: await el.evaluate((node) => {
            const attrs: Record<string, string> = {};
            for (const attr of node.attributes) {
              attrs[attr.name] = attr.value;
            }
            return attrs;
          }),
        }))
      );
      return { data };
    }

    throw new Error('Either selector or evaluate must be provided');
  }

  async html(): Promise<{ html: string; url: string }> {
    const page = this.requirePage();
    const content = await page.content();
    return { html: content, url: page.url() };
  }

  async screenshot(): Promise<Buffer> {
    const page = this.requirePage();
    return await page.screenshot({ type: 'png', fullPage: false });
  }

  async pdf(): Promise<Buffer> {
    const page = this.requirePage();
    return await page.pdf({ format: 'A4' });
  }

  async tabs(): Promise<TabInfo[]> {
    if (!this.context) return [];
    const pages = this.context.pages();
    return Promise.all(pages.map(async (page, index) => ({
      index,
      url: page.url(),
      title: await page.title().catch(() => ''),
      active: page === this.activePage,
    })));
  }

  async newTab(url?: string): Promise<{ index: number; url: string }> {
    const ctx = this.requireContext();
    const page = await ctx.newPage();
    if (url) {
      await page.goto(url, { waitUntil: 'load', timeout: PAGE_LOAD_TIMEOUT_MS });
    }
    this.activePage = page;
    const pages = ctx.pages();
    return { index: pages.indexOf(page), url: page.url() };
  }

  async closeTab(index: number): Promise<{ ok: true }> {
    const ctx = this.requireContext();
    const pages = ctx.pages();
    if (index < 0 || index >= pages.length) {
      throw new Error(`Tab index ${index} out of range (0-${pages.length - 1})`);
    }
    const page = pages[index];
    await page.close();

    // Switch to last remaining page
    const remaining = ctx.pages();
    this.activePage = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    return { ok: true };
  }

  async switchTab(index: number): Promise<{ url: string; title: string }> {
    const ctx = this.requireContext();
    const pages = ctx.pages();
    if (index < 0 || index >= pages.length) {
      throw new Error(`Tab index ${index} out of range (0-${pages.length - 1})`);
    }
    this.activePage = pages[index];
    await this.activePage.bringToFront();
    return { url: this.activePage.url(), title: await this.activePage.title() };
  }

  async close(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close();
      } catch (err) {
        logger.warn('Error closing browser context', { error: err });
      }
      this.context = null;
      this.activePage = null;
    }
  }

  isAlive(): boolean {
    return this.context !== null;
  }

  private requireContext(): BrowserContext {
    if (!this.context) {
      throw new Error('Browser not started. Call /internal/bootstrap first.');
    }
    return this.context;
  }

  private requirePage(): Page {
    if (!this.activePage) {
      throw new Error('No active page. Call /internal/bootstrap first.');
    }
    return this.activePage;
  }
}
