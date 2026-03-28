import type { ToolDefinition, ToolHandler } from '../tool-definitions';
function normalizeHostname(hostname: string): string {
  const stripped = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[([^\]]+)\]$/, '$1');
  return stripped.endsWith('.') ? stripped.slice(0, -1) : stripped;
}
import { isPrivateIP } from 'takos-common/validation';
import { DOH_ENDPOINT, DNS_RESOLVE_TIMEOUT_MS } from '../../../shared/constants/dns.ts';

export const WEB_FETCH: ToolDefinition = {
  name: 'web_fetch',
  description: 'Fetch content from a URL. Returns the page content as text.',
  category: 'web',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to fetch',
      },
      extract: {
        type: 'string',
        description: 'What to extract: "text" (all text), "main" (main content), "links" (all links)',
        enum: ['text', 'main', 'links'],
      },
      render: {
        type: 'boolean',
        description: 'Use browser rendering (Puppeteer) for JS-heavy pages',
      },
      timeout_ms: {
        type: 'number',
        description: 'Timeout for render mode in milliseconds (default: 30000)',
      },
    },
    required: ['url'],
  },
};

const MAX_RESPONSE_SIZE = 25 * 1024 * 1024;  // 25MB
const FETCH_TIMEOUT_MS = 300000;               // 5 minutes
const ALLOWED_PORTS = [80, 443];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',        // GCP metadata
  'metadata.google.internal.',
  'kubernetes.default.svc',          // Kubernetes
  'kubernetes.default.svc.cluster.local',
]);

const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^localhost\./i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^.*\.svc\.cluster\.local$/i,      // Kubernetes services
];

const SUSPICIOUS_HOST_PATTERNS = [
  /^0+127/,           // Octal representations of 127.x.x.x
  /^0x7f/i,           // Hex representations of 127.x.x.x
  /^2130706433$/,     // Decimal representation of 127.0.0.1
  /^0177\./,          // Octal 127
  /^017700000001$/,   // Octal 127.0.0.1
];


function isBlockedDomain(hostname: string): boolean {
  const lowerHostname = normalizeHostname(hostname);
  if (!lowerHostname) return true;

  if (BLOCKED_HOSTNAMES.has(lowerHostname)) return true;

  for (const pattern of BLOCKED_HOSTNAME_PATTERNS) {
    if (pattern.test(lowerHostname)) return true;
  }

  if (isPrivateIP(lowerHostname)) return true;

  return false;
}

interface DohAnswer {
  type?: number;
  data?: string;
}

interface DohResponse {
  Status?: number;
  Answer?: DohAnswer[];
}

interface EgressBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

async function dohResolve(hostname: string, type: 'A' | 'AAAA' | 'CNAME'): Promise<DohAnswer[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DNS_RESOLVE_TIMEOUT_MS);

  try {
    const response = await fetch(`${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=${type}`, {
      headers: { Accept: 'application/dns-json' },
      redirect: 'manual',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`DoH query failed: ${response.status}`);
    }

    const json = await response.json() as DohResponse;
    if ((json.Status ?? 2) !== 0) {
      return [];
    }

    return Array.isArray(json.Answer) ? json.Answer : [];
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('DNS resolution timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function resolveAllIPs(hostname: string): Promise<string[]> {
  const visited = new Set<string>();
  const resolvedIPs = new Set<string>();

  async function walk(name: string, depth: number): Promise<void> {
    if (depth > 10) {
      throw new Error('DNS resolution exceeded max depth');
    }

    const normalized = normalizeHostname(name);
    if (!normalized) {
      throw new Error('Invalid hostname');
    }

    if (visited.has(normalized)) {
      return;
    }
    visited.add(normalized);

    const [aAnswers, aaaaAnswers, cnameAnswers] = await Promise.all([
      dohResolve(normalized, 'A'),
      dohResolve(normalized, 'AAAA'),
      dohResolve(normalized, 'CNAME'),
    ]);

    for (const answer of aAnswers) {
      if (answer.type === 1 && typeof answer.data === 'string') {
        resolvedIPs.add(answer.data.trim());
      }
    }

    for (const answer of aaaaAnswers) {
      if (answer.type === 28 && typeof answer.data === 'string') {
        resolvedIPs.add(answer.data.trim());
      }
    }

    const cnameTargets = cnameAnswers
      .filter((answer) => answer.type === 5 && typeof answer.data === 'string')
      .map((answer) => normalizeHostname(String(answer.data)));

    for (const cnameTarget of cnameTargets) {
      if (!cnameTarget) continue;
      if (isBlockedDomain(cnameTarget)) {
        throw new Error('DNS CNAME points to internal/private domain');
      }
      await walk(cnameTarget, depth + 1);
    }
  }

  await walk(hostname, 0);
  return [...resolvedIPs];
}

function getUrlPort(url: URL): number {
  if (url.port) {
    const parsed = Number.parseInt(url.port, 10);
    return Number.isNaN(parsed) ? -1 : parsed;
  }
  return url.protocol === 'https:' ? 443 : 80;
}

async function resolveAndCheckIP(hostname: string): Promise<void> {
  const normalizedHostname = normalizeHostname(hostname);
  if (!normalizedHostname) {
    throw new Error('Invalid hostname');
  }

  for (const pattern of SUSPICIOUS_HOST_PATTERNS) {
    if (pattern.test(normalizedHostname)) {
      throw new Error('Suspicious IP format detected - access denied');
    }
  }

  if (isPrivateIP(normalizedHostname)) {
    throw new Error('Access to private/internal IP addresses is not allowed');
  }

  const looksLikeIPv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(normalizedHostname);
  const looksLikeIPv6 = normalizedHostname.includes(':');
  if (looksLikeIPv4 || looksLikeIPv6) {
    return;
  }

  const resolvedIPs = await resolveAllIPs(normalizedHostname);
  if (resolvedIPs.length === 0) {
    throw new Error('DNS resolution returned no addresses');
  }

  for (const ip of resolvedIPs) {
    if (isPrivateIP(ip)) {
      throw new Error('Resolved to private/internal IP address');
    }
  }
}

/** Validate a URL for SSRF safety: protocol, credentials, port, blocked domain, IP resolution. */
async function validateUrlSafety(parsed: URL): Promise<void> {
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP/HTTPS URLs are allowed');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URLs with credentials are not allowed');
  }

  const port = getUrlPort(parsed);
  if (!ALLOWED_PORTS.includes(port)) {
    throw new Error(`Port ${port} is not allowed. Allowed ports: ${ALLOWED_PORTS.join(', ')}`);
  }

  if (isBlockedDomain(parsed.hostname)) {
    throw new Error('Access to internal/private networks is not allowed');
  }

  await resolveAndCheckIP(parsed.hostname);
}

export const webFetchHandler: ToolHandler = async (args, context) => {
  const url = args.url as string;
  const extract = (args.extract as string) || 'main';
  const render = !!args.render;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  await validateUrlSafety(parsedUrl);

  if (render) {
    return 'Browser rendering via web_fetch is no longer supported. Use browser_open + browser_goto + browser_extract for JS-heavy pages instead.';
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  const egress = (context.env as typeof context.env & { TAKOS_EGRESS?: EgressBinding }).TAKOS_EGRESS;
  if (!egress) {
    throw new Error('Egress proxy not configured');
  }
  try {
    const egressHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (compatible; TakosBot/1.0)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'X-Takos-Internal': '1',
      'X-Takos-Space-Id': context.spaceId,
      'X-Takos-User-Id': context.userId,
      'X-Takos-Run-Id': context.runId,
      'X-Takos-Egress-Mode': 'web_fetch',
    };
    response = await egress.fetch(url, {
      headers: egressHeaders,
      redirect: 'manual', // Don't auto-follow redirects
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000} seconds`);
    }
    throw error;
  }
  clearTimeout(timeoutId);

  if (response.status >= 300 && response.status < 400) {
    const redirectUrl = response.headers.get('location');
    if (redirectUrl) {
      let redirectParsed: URL;
      try {
        redirectParsed = new URL(redirectUrl, url);
      } catch {
        throw new Error('Invalid redirect URL');
      }
      await validateUrlSafety(redirectParsed);
      return `Page redirects to: ${redirectParsed.toString()}\nUse web_fetch with this URL to follow the redirect.`;
    }
  }

  if (!response.ok) {
    const ct = response.headers.get('content-type') || '';
    let detail = response.statusText;

    try {
      if (ct.includes('application/json')) {
        const payload = await response.json() as { error?: unknown; message?: unknown };
        const err = payload?.error;
        const msg = payload?.message;
        if (typeof err === 'string' && typeof msg === 'string') detail = `${err}: ${msg}`;
        else if (typeof err === 'string') detail = err;
        else detail = JSON.stringify(payload);
      } else {
        const text = await response.text();
        if (text) detail = text.slice(0, 500);
      }
    } catch {
      // ignore parse errors
    }

    throw new Error(`Failed to fetch: ${response.status} ${detail}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (size > MAX_RESPONSE_SIZE) {
      throw new Error(`Response too large: ${(size / 1024 / 1024).toFixed(1)}MB exceeds limit of ${MAX_RESPONSE_SIZE / 1024 / 1024}MB`);
    }
  }

  const contentType = response.headers.get('content-type') || '';

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Unable to read response body');
  }

  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalSize += value.length;
      if (totalSize > MAX_RESPONSE_SIZE) {
        reader.cancel();
        throw new Error(`Response too large: exceeded ${MAX_RESPONSE_SIZE / 1024 / 1024}MB limit`);
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const decoder = new TextDecoder('utf-8');
  const textContent = chunks.map(chunk => decoder.decode(chunk, { stream: true })).join('') + decoder.decode();

  if (contentType.includes('application/json')) {
    try {
      const json = JSON.parse(textContent);
      return JSON.stringify(json, null, 2);
    } catch {
      throw new Error('Invalid JSON response');
    }
  }

  if (contentType.includes('text/plain')) {
    return textContent;
  }

  const html = textContent;

  switch (extract) {
    case 'text':
      return extractAllText(html);
    case 'links':
      return extractLinks(html, url);
    case 'main':
    default:
      return extractMainContent(html);
  }
};

function extractAllText(html: string): string {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');

  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeHtmlEntities(text);
  text = text
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > 10000) {
    text = text.substring(0, 10000) + '...\n\n(truncated)';
  }

  return text;
}

function extractMainContent(html: string): string {
  const mainPatterns = [
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id="content"[^>]*>([\s\S]*?)<\/div>/i,
  ];

  for (const pattern of mainPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return extractAllText(match[1]);
    }
  }

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch && bodyMatch[1]) {
    return extractAllText(bodyMatch[1]);
  }

  return extractAllText(html);
}

function extractLinks(html: string, baseUrl: string): string {
  const linkPattern = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const links: { url: string; text: string }[] = [];

  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    const href = match[1];
    const text = extractAllText(match[2]).substring(0, 100);

    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      try {
        const absoluteUrl = new URL(href, baseUrl).toString();
        links.push({ url: absoluteUrl, text: text || '(no text)' });
      } catch {
        // Skip invalid URLs
      }
    }
  }

  if (links.length === 0) {
    return 'No links found on page';
  }

  const limitedLinks = links.slice(0, 50);

  return `Found ${links.length} links:\n\n` +
    limitedLinks.map(l => `- [${l.text}](${l.url})`).join('\n');
}

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
  };

  return text.replace(/&[^;]+;/g, entity => entities[entity] || entity);
}

export const WEB_TOOLS: ToolDefinition[] = [
  WEB_FETCH,
];

export const WEB_HANDLERS: Record<string, ToolHandler> = {
  web_fetch: webFetchHandler,
};
