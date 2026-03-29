/**
 * Node.js PDF renderer using puppeteer-core or puppeteer.
 * Connects to a Chrome instance via one of:
 *   1. CHROME_CDP_URL   -- remote Chrome DevTools Protocol endpoint
 *   2. PUPPETEER_EXECUTABLE_PATH -- local Chromium binary
 */
export type NodePdfRenderConfig = {
    /** WebSocket endpoint for a remote Chrome instance (e.g. ws://127.0.0.1:9222/...). */
    cdpUrl?: string;
    /** Path to a local Chromium / Chrome binary. */
    executablePath?: string;
};
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
export declare function createNodePdfRenderer(config: NodePdfRenderConfig): (html: string) => Promise<ArrayBuffer>;
//# sourceMappingURL=pdf-render.d.ts.map