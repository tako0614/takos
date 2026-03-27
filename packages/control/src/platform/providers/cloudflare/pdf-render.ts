type BrowserBinding = {
  connect(): Promise<{ webSocketDebuggerUrl: string }>;
};

/** Runtime type guard that checks whether the page object exposes a `pdf` method. */
function hasPdfMethod(
  page: object,
): page is { pdf: (opts?: { format?: string; printBackground?: boolean }) => Promise<ArrayBuffer> } {
  return 'pdf' in page && typeof (page as Record<string, unknown>).pdf === 'function';
}

export async function renderPdfWithCloudflareBrowser(
  browserBinding: BrowserBinding,
  html: string,
): Promise<ArrayBuffer> {
  const { default: puppeteer } = await import('@cloudflare/puppeteer');
  const browser = await puppeteer.launch(browserBinding);
  try {
    const page = await browser.newPage();
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 });

    if (!hasPdfMethod(page)) {
      throw new Error('PDF export not supported by browser runtime');
    }
    return page.pdf({ format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }
}
