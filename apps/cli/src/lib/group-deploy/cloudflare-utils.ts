/**
 * Group Deploy — helper functions.
 */
import { execFile } from 'node:child_process';

// ── Helpers ──────────────────────────────────────────────────────────────────

export const CF_API = 'https://api.cloudflare.com/client/v4';

const CF_API_TIMEOUT_MS = 30_000;

export async function cfApi<T>(
  accountId: string,
  apiToken: string,
  method: string,
  subpath: string,
  body?: unknown,
): Promise<T> {
  const url = `${CF_API}/accounts/${accountId}${subpath}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(CF_API_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`CF API ${method} ${subpath} failed (${res.status}): ${text}`);
  }
  const data = await res.json() as { success: boolean; result: T; errors?: Array<{ message: string }> };
  if (!data.success) {
    const msg = data.errors?.map(e => e.message).join(', ') || 'Unknown error';
    throw new Error(`CF API error: ${msg}`);
  }
  return data.result;
}

export function execCommand(
  command: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; stdin?: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = execFile(command, args, {
      cwd: opts?.cwd,
      env: { ...process.env, ...opts?.env },
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        exitCode: error ? (error as { code?: number }).code ?? 1 : 0,
      });
    });
    if (opts?.stdin && proc.stdin) {
      proc.stdin.write(opts.stdin);
      proc.stdin.end();
    }
  });
}

export function resourceCfName(groupName: string, env: string, resourceName: string): string {
  return `${groupName}-${env}-${resourceName}`;
}

export function toBinding(name: string): string {
  return name.toUpperCase().replace(/-/g, '_');
}
