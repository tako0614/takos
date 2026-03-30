/** Runtime type guard that checks whether the page object exposes a `pdf` method. */
function hasPdfMethod(
  page: object,
): page is { pdf: (opts?: { format?: string; printBackground?: boolean }) => Promise<ArrayBuffer> } {
  return 'pdf' in page && typeof (page as Record<string, unknown>).pdf === 'function';
}

export async function renderPdfWithCloudflareBrowser(
  browserBinding: unknown,
  html: string,
): Promise<ArrayBuffer> {
  const { default: puppeteer } = await import('@cloudflare/puppeteer');
  // The binding is cast to satisfy @cloudflare/puppeteer's BrowserWorker
  // type which is only available inside the Workers runtime.
  const browser = await puppeteer.launch(browserBinding as Parameters<typeof puppeteer.launch>[0]);
  try {
    const page = await browser.newPage();
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 });

    if (!hasPdfMethod(page)) {
      throw new Error('PDF export not supported by browser runtime');
    }
    const result = await page.pdf({ format: 'A4', printBackground: true });
    // Normalise to ArrayBuffer — Cloudflare puppeteer may return a Buffer.
    if (result instanceof ArrayBuffer) {
      return result;
    }
    const bytes = result as unknown as Uint8Array;
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } finally {
    await browser.close();
  }
}
