/**
 * Node.js PDF renderer using puppeteer-core or puppeteer.
 * Connects to a Chrome instance via one of:
 *   1. CHROME_CDP_URL   -- remote Chrome DevTools Protocol endpoint
 *   2. PUPPETEER_EXECUTABLE_PATH -- local Chromium binary
 */

import { Buffer } from "node:buffer";

export type NodePdfRenderConfig = {
  /** WebSocket endpoint for a remote Chrome instance (e.g. ws://127.0.0.1:9222/...). */
  cdpUrl?: string;
  /** Path to a local Chromium / Chrome binary. */
  executablePath?: string;
};

type PuppeteerModule = {
  default?: {
    connect(opts: { browserWSEndpoint: string }): Promise<PuppeteerBrowser>;
    launch(opts: { executablePath: string; headless: boolean | 'new'; args: string[] }): Promise<PuppeteerBrowser>;
  };
  connect?(opts: { browserWSEndpoint: string }): Promise<PuppeteerBrowser>;
  launch?(opts: { executablePath: string; headless: boolean | 'new'; args: string[] }): Promise<PuppeteerBrowser>;
};

type PuppeteerBrowser = {
  newPage(): Promise<PuppeteerPage>;
  close(): Promise<void>;
};

type PuppeteerPage = {
  setContent(html: string, opts?: { waitUntil?: string | string[]; timeout?: number }): Promise<void>;
  pdf(opts?: { format?: string; printBackground?: boolean }): Promise<Buffer | Uint8Array>;
  close(): Promise<void>;
};

async function importPuppeteer(): Promise<PuppeteerModule> {
  // Prefer puppeteer-core (lighter, no bundled browser).
  // Fall back to puppeteer (includes a browser download).
  try {
    // @ts-expect-error puppeteer-core is an optional peer dependency
    return await import('puppeteer-core');
  } catch {
    // @ts-expect-error puppeteer is an optional peer dependency
    return await import('puppeteer');
  }
}

function getPuppeteerApi(mod: PuppeteerModule) {
  // Handle both ESM default exports and direct CJS-style exports.
  const api = mod.default ?? mod;
  if (!api || (typeof api.connect !== 'function' && typeof api.launch !== 'function')) {
    throw new Error('Unable to resolve puppeteer API — neither connect nor launch found');
  }
  return api as NonNullable<PuppeteerModule['default']>;
}

/**
 * Creates a reusable PDF render function for the Node.js platform.
 *
 * The returned function renders the given HTML string to a PDF (A4, with
 * background graphics) and returns the result as an `ArrayBuffer`.
 *
 * Browser connections are lazily established on first call and reused for
 * subsequent renders. Individual pages are closed after each render to
 * keep memory usage bounded.
 */
export function createNodePdfRenderer(
  config: NodePdfRenderConfig,
): (html: string) => Promise<ArrayBuffer> {
  let browserPromise: Promise<PuppeteerBrowser> | undefined;

  async function getBrowser(): Promise<PuppeteerBrowser> {
    const mod = await importPuppeteer();
    const puppeteer = getPuppeteerApi(mod);

    if (config.cdpUrl) {
      return puppeteer.connect({ browserWSEndpoint: config.cdpUrl });
    }

    if (config.executablePath) {
      return puppeteer.launch({
        executablePath: config.executablePath,
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }

    throw new Error(
      'Node PDF renderer requires either CHROME_CDP_URL or PUPPETEER_EXECUTABLE_PATH',
    );
  }

  async function ensureBrowser(): Promise<PuppeteerBrowser> {
    if (!browserPromise) {
      browserPromise = getBrowser().catch((err) => {
        // Reset so the next call will retry instead of caching the failure.
        browserPromise = undefined;
        throw err;
      });
    }
    return browserPromise;
  }

  return async function renderPdf(html: string): Promise<ArrayBuffer> {
    const browser = await ensureBrowser();
    const page = await browser.newPage();

    try {
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60_000 });

      const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });

      // Normalise to ArrayBuffer regardless of whether puppeteer returns
      // a Node Buffer or Uint8Array.
      if (pdfBuffer instanceof ArrayBuffer) {
        return pdfBuffer;
      }
      const bytes = pdfBuffer as Uint8Array;
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    } finally {
      await page.close();
    }
  };
}
