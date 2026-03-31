import type { Env } from '../types/index.ts';

/**
 * Serve the SPA index.html from the ASSETS binding.
 * Used when server-side routes want to hand off rendering to the React app.
 * Returns null if ASSETS is unavailable (fallback to server-rendered HTML).
 */
export async function serveSpaFallback(env: Env, requestUrl: string): Promise<Response | null> {
  if (!env.ASSETS) return null;

  try {
    const indexHtml = await env.ASSETS.fetch(new Request(new URL('/index.html', requestUrl)));
    if (indexHtml.ok) {
      return new Response(indexHtml.body, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    }
  } catch {
    // ASSETS unavailable, fall through
  }

  return null;
}
