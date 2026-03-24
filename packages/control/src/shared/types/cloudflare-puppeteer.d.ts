declare module '@cloudflare/puppeteer' {
  interface Page {
    goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<void>;
    url(): string;
    evaluate<T>(fn: () => T): Promise<T>;
    close(): Promise<void>;
  }

  interface Browser {
    newPage(): Promise<Page>;
    close(): Promise<void>;
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type
  interface PuppeteerLaunchOptions {
    // Cloudflare Browser binding
  }

  const puppeteer: {
    launch(browserBinding: unknown): Promise<Browser>;
  };

  export default puppeteer;
}
