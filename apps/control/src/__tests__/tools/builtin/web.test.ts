import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

// Mock the isPrivateIP validation
vi.mock('takos-common/validation', () => ({
  isPrivateIP: vi.fn((ip: string) => {
    // Simplified private IP check for testing
    if (ip === '127.0.0.1' || ip === '10.0.0.1' || ip === '192.168.1.1') return true;
    if (ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
    if (ip === '::1' || ip === 'fe80::1') return true;
    return false;
  }),
}));

import { webFetchHandler, WEB_FETCH, WEB_TOOLS } from '@/tools/builtin/web';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  const mockFetch = vi.fn();
  return {
    spaceId: 'ws-test',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: ['egress.http'],
    env: {
      TAKOS_EGRESS: { fetch: mockFetch },
    } as unknown as Env,
    db: {} as D1Database,
    setSessionId: vi.fn(),
    getLastContainerStartFailure: vi.fn(() => undefined),
    setLastContainerStartFailure: vi.fn(),
    ...overrides,
  };
}

function getEgressMock(ctx: ToolContext): ReturnType<typeof vi.fn> {
  return (ctx.env as unknown as { TAKOS_EGRESS: { fetch: ReturnType<typeof vi.fn> } }).TAKOS_EGRESS.fetch;
}

function makeReadableStream(text: string): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
}

function mockOkResponse(body: string, contentType = 'text/html'): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('web tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock global fetch for DNS resolution — must return a fresh Response each time
    // because Response.body can only be consumed once
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), {
        status: 200,
        headers: { 'content-type': 'application/dns-json' },
      })),
    ));
  });

  describe('WEB_FETCH definition', () => {
    it('has correct name and required params', () => {
      expect(WEB_FETCH.name).toBe('web_fetch');
      expect(WEB_FETCH.category).toBe('web');
      expect(WEB_FETCH.parameters.required).toEqual(['url']);
    });

    it('has extract enum options', () => {
      const extractParam = WEB_FETCH.parameters.properties.extract;
      expect(extractParam.enum).toEqual(['text', 'main', 'links']);
    });
  });

  describe('WEB_TOOLS', () => {
    it('exports web_fetch', () => {
      expect(WEB_TOOLS).toHaveLength(1);
      expect(WEB_TOOLS[0].name).toBe('web_fetch');
    });
  });

  describe('webFetchHandler', () => {
    it('throws on invalid URL', async () => {
      await expect(
        webFetchHandler({ url: 'not-a-url' }, makeContext()),
      ).rejects.toThrow('Invalid URL format');
    });

    it('throws on non-HTTP protocol', async () => {
      await expect(
        webFetchHandler({ url: 'ftp://example.com/file' }, makeContext()),
      ).rejects.toThrow('Only HTTP/HTTPS URLs are allowed');
    });

    it('throws on URLs with credentials', async () => {
      await expect(
        webFetchHandler({ url: 'https://user:pass@example.com/' }, makeContext()),
      ).rejects.toThrow('credentials are not allowed');
    });

    it('throws on non-standard ports', async () => {
      await expect(
        webFetchHandler({ url: 'https://example.com:8080/' }, makeContext()),
      ).rejects.toThrow('Port 8080 is not allowed');
    });

    it('throws when accessing localhost', async () => {
      await expect(
        webFetchHandler({ url: 'http://localhost/' }, makeContext()),
      ).rejects.toThrow('internal/private');
    });

    it('throws when accessing private IP addresses', async () => {
      await expect(
        webFetchHandler({ url: 'http://192.168.1.1/' }, makeContext()),
      ).rejects.toThrow('internal/private');
    });

    it('throws when egress proxy is not configured', async () => {
      const ctx = makeContext({ env: {} as Env });
      // Stub fetch to resolve DNS to a public IP
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        })),
      ));

      await expect(
        webFetchHandler({ url: 'https://example.com/' }, ctx),
      ).rejects.toThrow('Egress proxy not configured');
    });

    it('returns deprecation message for render mode', async () => {
      // Mock DNS to not block
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        })),
      ));

      const ctx = makeContext();
      const result = await webFetchHandler(
        { url: 'https://example.com/', render: true },
        ctx,
      );

      expect(result).toContain('no longer supported');
      expect(result).toContain('browser_open');
    });

    it('fetches and returns JSON content', async () => {
      const ctx = makeContext();
      const egressMock = getEgressMock(ctx);
      egressMock.mockResolvedValue(
        mockOkResponse('{"key": "value"}', 'application/json'),
      );

      vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        })),
      ));

      const result = await webFetchHandler(
        { url: 'https://api.example.com/data' },
        ctx,
      );

      expect(result).toContain('"key"');
      expect(result).toContain('"value"');
    });

    it('fetches and returns plain text content', async () => {
      const ctx = makeContext();
      const egressMock = getEgressMock(ctx);
      egressMock.mockResolvedValue(
        mockOkResponse('Hello world', 'text/plain'),
      );

      vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        })),
      ));

      const result = await webFetchHandler(
        { url: 'https://example.com/readme.txt' },
        ctx,
      );

      expect(result).toBe('Hello world');
    });

    it('extracts links from HTML', async () => {
      const html = `
        <html><body>
          <a href="https://example.com/page1">Page 1</a>
          <a href="/page2">Page 2</a>
          <a href="#anchor">Anchor</a>
          <a href="javascript:void(0)">JS</a>
        </body></html>
      `;

      const ctx = makeContext();
      const egressMock = getEgressMock(ctx);
      egressMock.mockResolvedValue(mockOkResponse(html, 'text/html'));

      vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        })),
      ));

      const result = await webFetchHandler(
        { url: 'https://example.com/', extract: 'links' },
        ctx,
      );

      expect(result).toContain('Found');
      expect(result).toContain('Page 1');
      expect(result).toContain('page2');
      // # and javascript: links should be excluded
      expect(result).not.toContain('Anchor');
    });

    it('handles redirect responses', async () => {
      const ctx = makeContext();
      const egressMock = getEgressMock(ctx);
      egressMock.mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/new-page' },
        }),
      );

      vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        })),
      ));

      const result = await webFetchHandler(
        { url: 'https://example.com/old' },
        ctx,
      );

      expect(result).toContain('redirects to');
      expect(result).toContain('https://example.com/new-page');
    });

    it('rejects when content-length exceeds limit', async () => {
      const ctx = makeContext();
      const egressMock = getEgressMock(ctx);
      egressMock.mockResolvedValue(
        new Response('', {
          status: 200,
          headers: {
            'content-type': 'text/html',
            'content-length': String(30 * 1024 * 1024), // 30MB
          },
        }),
      );

      vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        })),
      ));

      await expect(
        webFetchHandler({ url: 'https://example.com/large' }, ctx),
      ).rejects.toThrow('Response too large');
    });

    it('throws on non-ok HTTP responses with details', async () => {
      const ctx = makeContext();
      const egressMock = getEgressMock(ctx);
      egressMock.mockResolvedValue(
        new Response('Not Found', {
          status: 404,
          statusText: 'Not Found',
          headers: { 'content-type': 'text/plain' },
        }),
      );

      vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        })),
      ));

      await expect(
        webFetchHandler({ url: 'https://example.com/missing' }, ctx),
      ).rejects.toThrow('Failed to fetch: 404');
    });

    it('blocks access to metadata.google.internal', async () => {
      await expect(
        webFetchHandler(
          { url: 'http://metadata.google.internal/computeMetadata/v1/' },
          makeContext(),
        ),
      ).rejects.toThrow('internal/private');
    });

    it('extracts main content from HTML with <main> tag', async () => {
      const html = `
        <html>
          <head><title>Test</title></head>
          <body>
            <nav>Navigation bar</nav>
            <main><p>This is the main content of the page.</p></main>
            <footer>Footer info</footer>
          </body>
        </html>
      `;

      const ctx = makeContext();
      const egressMock = getEgressMock(ctx);
      egressMock.mockResolvedValue(mockOkResponse(html, 'text/html'));

      vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        })),
      ));

      const result = await webFetchHandler(
        { url: 'https://example.com/', extract: 'main' },
        ctx,
      );

      expect(result).toContain('main content of the page');
      // Navigation and footer should not be in the extracted main content
      // (though extractAllText removes tags, main content matching means only inner content)
    });

    it('extracts main content from HTML with <article> tag when no <main>', async () => {
      const html = `
        <html>
          <body>
            <div>Sidebar stuff</div>
            <article><h2>Article Title</h2><p>Article body text here.</p></article>
          </body>
        </html>
      `;

      const ctx = makeContext();
      const egressMock = getEgressMock(ctx);
      egressMock.mockResolvedValue(mockOkResponse(html, 'text/html'));

      vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        })),
      ));

      const result = await webFetchHandler(
        { url: 'https://example.com/', extract: 'main' },
        ctx,
      );

      expect(result).toContain('Article Title');
      expect(result).toContain('Article body text here');
    });

    it('falls back to body when no main/article/content div', async () => {
      const html = `
        <html>
          <body>
            <div><p>Just some body content here.</p></div>
          </body>
        </html>
      `;

      const ctx = makeContext();
      const egressMock = getEgressMock(ctx);
      egressMock.mockResolvedValue(mockOkResponse(html, 'text/html'));

      vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        })),
      ));

      const result = await webFetchHandler(
        { url: 'https://example.com/', extract: 'main' },
        ctx,
      );

      expect(result).toContain('body content here');
    });

    it('extracts all text from HTML via extract="text"', async () => {
      const html = `
        <html>
          <head><title>Title</title><style>body{color:red}</style></head>
          <body>
            <script>console.log('hidden');</script>
            <h1>Heading</h1>
            <p>Paragraph text.</p>
          </body>
        </html>
      `;

      const ctx = makeContext();
      const egressMock = getEgressMock(ctx);
      egressMock.mockResolvedValue(mockOkResponse(html, 'text/html'));

      vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        })),
      ));

      const result = await webFetchHandler(
        { url: 'https://example.com/', extract: 'text' },
        ctx,
      );

      expect(result).toContain('Heading');
      expect(result).toContain('Paragraph text');
      // Script and style content should be stripped
      expect(result).not.toContain('console.log');
      expect(result).not.toContain('color:red');
    });

    it('decodes HTML entities in extracted text', async () => {
      const html = `
        <html><body>
          <p>Tom &amp; Jerry &lt;3 each other. &quot;Hello&quot; said he&#39;s friend.</p>
          <p>Price:&nbsp;$10</p>
        </body></html>
      `;

      const ctx = makeContext();
      const egressMock = getEgressMock(ctx);
      egressMock.mockResolvedValue(mockOkResponse(html, 'text/html'));

      vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        })),
      ));

      const result = await webFetchHandler(
        { url: 'https://example.com/', extract: 'text' },
        ctx,
      );

      expect(result).toContain('Tom & Jerry');
      expect(result).toContain('<3');
      expect(result).toContain('"Hello"');
      expect(result).toContain("he's friend");
      expect(result).toContain('Price: $10');
    });

    it('follows CNAME records and blocks private CNAME targets', async () => {
      // DNS resolution returns a CNAME pointing to a blocked domain
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        const u = new URL(url);
        const name = u.searchParams.get('name');
        const type = u.searchParams.get('type');

        if (name === 'evil.example.com' && type === 'CNAME') {
          return Promise.resolve(new Response(JSON.stringify({
            Status: 0,
            Answer: [{ type: 5, data: 'localhost' }],
          }), {
            status: 200,
            headers: { 'content-type': 'application/dns-json' },
          }));
        }

        // A and AAAA queries return empty
        return Promise.resolve(new Response(JSON.stringify({
          Status: 0,
          Answer: [],
        }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        }));
      }));

      await expect(
        webFetchHandler({ url: 'https://evil.example.com/' }, makeContext()),
      ).rejects.toThrow('CNAME points to internal/private domain');
    });

    it('follows CNAME chain to resolve final IPs', async () => {
      // CNAME chain: target.example.com -> cdn.example.net -> 93.184.216.34
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        const u = new URL(url);
        const name = u.searchParams.get('name');
        const type = u.searchParams.get('type');

        if (name === 'target.example.com' && type === 'CNAME') {
          return Promise.resolve(new Response(JSON.stringify({
            Status: 0,
            Answer: [{ type: 5, data: 'cdn.example.net' }],
          }), {
            status: 200,
            headers: { 'content-type': 'application/dns-json' },
          }));
        }

        if (name === 'cdn.example.net' && type === 'A') {
          return Promise.resolve(new Response(JSON.stringify({
            Status: 0,
            Answer: [{ type: 1, data: '93.184.216.34' }],
          }), {
            status: 200,
            headers: { 'content-type': 'application/dns-json' },
          }));
        }

        return Promise.resolve(new Response(JSON.stringify({
          Status: 0,
          Answer: [],
        }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        }));
      }));

      const ctx = makeContext();
      const egressMock = getEgressMock(ctx);
      egressMock.mockResolvedValue(mockOkResponse('<html><body>OK</body></html>', 'text/html'));

      // Should not throw — CNAME chain resolves to a public IP
      const result = await webFetchHandler({ url: 'https://target.example.com/' }, ctx);
      expect(result).toBeDefined();
    });

    it('blocks CNAME that resolves to a private IP', async () => {
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        const u = new URL(url);
        const name = u.searchParams.get('name');
        const type = u.searchParams.get('type');

        if (name === 'sneaky.example.com' && type === 'CNAME') {
          return Promise.resolve(new Response(JSON.stringify({
            Status: 0,
            Answer: [{ type: 5, data: 'internal-host.example.com' }],
          }), {
            status: 200,
            headers: { 'content-type': 'application/dns-json' },
          }));
        }

        if (name === 'internal-host.example.com' && type === 'A') {
          return Promise.resolve(new Response(JSON.stringify({
            Status: 0,
            Answer: [{ type: 1, data: '10.0.0.1' }],
          }), {
            status: 200,
            headers: { 'content-type': 'application/dns-json' },
          }));
        }

        return Promise.resolve(new Response(JSON.stringify({
          Status: 0,
          Answer: [],
        }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        }));
      }));

      await expect(
        webFetchHandler({ url: 'https://sneaky.example.com/' }, makeContext()),
      ).rejects.toThrow('Resolved to private/internal IP address');
    });

    it('throws when streaming body exceeds size limit', async () => {
      const ctx = makeContext();
      const egressMock = getEgressMock(ctx);

      // Create a response that streams more than MAX_RESPONSE_SIZE (25MB)
      // We create chunks that add up to > 25MB
      const chunkSize = 1024 * 1024; // 1MB per chunk
      const totalChunks = 26; // 26MB total
      let chunkIndex = 0;

      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunkIndex < totalChunks) {
            controller.enqueue(new Uint8Array(chunkSize));
            chunkIndex++;
          } else {
            controller.close();
          }
        },
      });

      const response = new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });

      egressMock.mockResolvedValue(response);

      vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        })),
      ));

      await expect(
        webFetchHandler({ url: 'https://example.com/huge' }, ctx),
      ).rejects.toThrow(/Response too large.*exceeded.*25MB/);
    });
  });
});
