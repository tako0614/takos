type BrowserBinding = {
  connect(): Promise<{ webSocketDebuggerUrl: string }>;
};

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

    const pdfCapable = page as unknown as { pdf?: (opts?: unknown) => Promise<ArrayBuffer> };
    const pdfFn = pdfCapable.pdf;
    if (typeof pdfFn !== 'function') {
      throw new Error('PDF export not supported by browser runtime');
    }
    return pdfFn.call(page, { format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }
}
