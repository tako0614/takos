import { spawn, type ChildProcess } from 'child_process';
import { filterSafeEnv } from '../utils/sandbox-env.js';
import { createLogger } from 'takos-common/logger';
import { gracefulKill } from '../utils/process-kill.js';

const logger = createLogger({ service: 'takos-runtime' });

export interface GitHttpBackendRequest {
  projectRoot: string;
  gitPath: string;
  service: string;
  requestBody: Buffer | null;
  contentType: string | undefined;
}

export interface GitHttpBackendResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

// Timeout for git http-backend process (30 minutes)
const GIT_HTTP_BACKEND_TIMEOUT_MS = 30 * 60 * 1000;

// Maximum buffer size for git http-backend output (100 MB)
const MAX_GIT_BACKEND_OUTPUT_BYTES = 100 * 1024 * 1024;

function parseBackendOutput(output: Buffer): GitHttpBackendResponse {
  const outputStr = output.toString();

  let headerEnd = outputStr.indexOf('\r\n\r\n');
  let separator = '\r\n\r\n';
  if (headerEnd === -1) {
    headerEnd = outputStr.indexOf('\n\n');
    separator = '\n\n';
  }

  if (headerEnd === -1) {
    return { status: 200, headers: {}, body: output };
  }

  const headers: Record<string, string> = {};
  let status = 200;
  const headerSection = outputStr.slice(0, headerEnd);

  for (const line of headerSection.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      continue;
    }

    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (key === 'status') {
      status = parseInt(value.split(' ')[0], 10) || 200;
    } else {
      headers[key] = value;
    }
  }

  return {
    status,
    headers,
    body: output.slice(headerEnd + separator.length),
  };
}

export async function runGitHttpBackend(
  request: GitHttpBackendRequest
): Promise<GitHttpBackendResponse> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...filterSafeEnv(process.env),
      GIT_PROJECT_ROOT: request.projectRoot,
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: request.gitPath,
      REQUEST_METHOD: request.requestBody ? 'POST' : 'GET',
      QUERY_STRING: `service=${request.service}`,
      CONTENT_TYPE: request.contentType || '',
      GIT_TERMINAL_PROMPT: '0',
    };

    const child = spawn('git', ['http-backend'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let isTimedOut = false;
    let forceKillHandle: NodeJS.Timeout | undefined;

    const timeoutHandle = setTimeout(() => {
      isTimedOut = true;
      forceKillHandle = gracefulKill(child);
    }, GIT_HTTP_BACKEND_TIMEOUT_MS);

    const chunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let totalOutputBytes = 0;

    child.stdout.on('data', (chunk: Buffer) => {
      totalOutputBytes += chunk.length;
      if (totalOutputBytes > MAX_GIT_BACKEND_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        reject(new Error(`git http-backend output exceeded ${MAX_GIT_BACKEND_OUTPUT_BYTES} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    if (request.requestBody) {
      child.stdin.write(request.requestBody);
    }
    child.stdin.end();

    function clearTimers(): void {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (forceKillHandle) clearTimeout(forceKillHandle);
    }

    child.on('error', (err) => {
      clearTimers();
      reject(err);
    });

    child.on('close', (code) => {
      clearTimers();

      if (isTimedOut) {
        reject(new Error(`git http-backend timed out after ${GIT_HTTP_BACKEND_TIMEOUT_MS}ms`));
        return;
      }

      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString();
        logger.error(`[git-http] Process failed with code ${code}`, { stderr });
        reject(new Error('Git operation failed'));
        return;
      }

      resolve(parseBackendOutput(Buffer.concat(chunks)));
    });
  });
}
