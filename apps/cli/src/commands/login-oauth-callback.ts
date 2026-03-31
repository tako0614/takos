import { gray, green, red, yellow } from '@std/fmt/colors';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { getLoginTimeoutMs } from '../lib/config.ts';
import {
  type CallbackParams,
  type OAuthCallbackFailureCode,
  OAUTH_CALLBACK_FAILURE_CODES,
  resolveCallbackParams,
  sanitizeAuthMessageForHtml,
  sanitizeAuthMessageForLog,
  validateCallbackPayload,
} from './oauth-callback-validation.ts';

export type { OAuthCallbackFailureCode } from './oauth-callback-validation.ts';

const BIND_ADDRESS = '127.0.0.1';

const SUCCESS_CALLBACK_HTML = `
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="utf-8">
                <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">
                <meta http-equiv="Pragma" content="no-cache">
                <meta http-equiv="Expires" content="0">
                <title>Authentication Successful</title>
              </head>
              <body style="font-family: system-ui; text-align: center; padding-top: 50px;">
                <h1>Authentication successful!</h1>
                <p>You can close this window and return to the terminal.</p>
                <script>
                  (function() {
                    if (window.history && window.history.replaceState) {
                      window.history.replaceState({}, document.title, window.location.pathname);
                    }
                    try { window.history.pushState({}, document.title, '/auth-complete'); } catch(e) { /* history.pushState is not critical - may fail in sandboxed iframes */ }
                  })();
                </script>
              </body>
            </html>
          `;

interface CleanupResult {
  token: string | null;
  error?: unknown;
}

export interface RunOAuthCallbackServerOptions {
  apiUrl: string;
  oauthState: string;
  openAuthUrl: (authUrl: string) => Promise<void>;
  onFailure?: (code: OAuthCallbackFailureCode) => void;
}

interface CallbackFailureHandlingInput {
  code: OAuthCallbackFailureCode;
  pageMessage?: string;
  log: () => void;
  response?: ServerResponse;
}

function closeServerAsync(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function sendErrorPage(res: ServerResponse, message: string): void {
  const sanitizedMessage = sanitizeAuthMessageForHtml(message);
  res.writeHead(400, { 'Content-Type': 'text/html' });
  res.end(`<html><body style="font-family:system-ui;text-align:center;padding-top:50px"><h1>Authentication failed</h1><p>${sanitizedMessage}</p></body></html>`);
}

function sendSuccessPage(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/html',
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  res.end(SUCCESS_CALLBACK_HTML);
}

function logAuthFailure(message: string): void {
  console.log(red(`\nAuthentication failed: ${sanitizeAuthMessageForLog(message)}`));
}

function logAuthSuccess(): void {
  console.log(green('\nAuthentication successful!'));
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString();
    if (body.length > 16 * 1024) break;
  }
  return body;
}

async function parseCallbackParams(req: IncomingMessage): Promise<CallbackParams> {
  const body = req.method === 'POST' ? await readRequestBody(req) : null;
  const contentType = String(req.headers?.['content-type'] || '').toLowerCase();

  return resolveCallbackParams({
    method: req.method,
    contentType,
    body,
  });
}

interface CallbackServerState {
  timeoutId: ReturnType<typeof setTimeout> | null;
  settled: boolean;
  resolve: (token: string | null) => void;
  reject: (error: unknown) => void;
}

async function cleanupAndSettle(server: Server, state: CallbackServerState, { token, error }: CleanupResult): Promise<void> {
  if (state.timeoutId) {
    clearTimeout(state.timeoutId);
    state.timeoutId = null;
  }

  try {
    await closeServerAsync(server);
  } catch {
    // ignore close errors
  }

  if (state.settled) return;
  state.settled = true;

  if (error !== undefined) {
    state.reject(error);
    return;
  }

  state.resolve(token);
}

async function handleFailure(
  server: Server,
  state: CallbackServerState,
  onFailure: ((code: OAuthCallbackFailureCode) => void) | undefined,
  { code, pageMessage, log, response }: CallbackFailureHandlingInput,
): Promise<void> {
  if (state.settled) {
    return;
  }

  if (response && pageMessage) {
    sendErrorPage(response, pageMessage);
  }

  log();
  onFailure?.(code);
  await cleanupAndSettle(server, state, { token: null });
}

async function handleCallbackRequest(
  req: IncomingMessage,
  res: ServerResponse,
  server: Server,
  state: CallbackServerState,
  oauthState: string,
  onFailure: ((code: OAuthCallbackFailureCode) => void) | undefined,
): Promise<void> {
  const requestUrl = new URL(req.url || '/', 'http://localhost');

  if (requestUrl.pathname !== '/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const callbackParams = await parseCallbackParams(req);
  const result = validateCallbackPayload(callbackParams, oauthState);

  if (!result.ok) {
    await handleFailure(server, state, onFailure, {
      code: result.code,
      pageMessage: result.pageMessage,
      log: () => logAuthFailure(result.logMessage),
      response: res,
    });
    return;
  }

  sendSuccessPage(res);
  logAuthSuccess();
  await cleanupAndSettle(server, state, { token: result.token });
}

function setupLoginTimeout(
  server: Server,
  state: CallbackServerState,
  onFailure: ((code: OAuthCallbackFailureCode) => void) | undefined,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    void handleFailure(server, state, onFailure, {
      code: OAUTH_CALLBACK_FAILURE_CODES.TIMEOUT,
      log: () => {
        console.log(red('\nAuthentication timed out'));
      },
    });
  }, getLoginTimeoutMs());
}

function handleServerListening(
  server: Server,
  state: CallbackServerState,
  apiUrl: string,
  oauthState: string,
  openAuthUrl: (authUrl: string) => Promise<void>,
  onFailure: ((code: OAuthCallbackFailureCode) => void) | undefined,
): void {
  const address = server.address();
  if (typeof address !== 'object' || !address) {
    return;
  }

  if (address.address !== BIND_ADDRESS && address.address !== '::1') {
    void handleFailure(server, state, onFailure, {
      code: OAUTH_CALLBACK_FAILURE_CODES.UNEXPECTED_BIND_ADDRESS,
      log: () => {
        console.log(red(`\nSecurity error: Server bound to unexpected address: ${address.address}`));
      },
    });
    return;
  }

  const callbackUrl = `http://${BIND_ADDRESS}:${address.port}/callback`;
  const authUrl = `${apiUrl}/auth/cli?callback=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(oauthState)}`;

  console.log(gray(`Callback URL: ${callbackUrl}`));
  console.log(gray(`Auth URL: ${authUrl}`));

  void openAuthUrl(authUrl).catch(() => {
    console.log(yellow(`\nCould not open browser automatically.`));
    console.log(yellow(`Please open this URL manually:\n${authUrl}`));
  });
}

export async function runOAuthCallbackServer({
  apiUrl,
  oauthState,
  openAuthUrl,
  onFailure,
}: RunOAuthCallbackServerOptions): Promise<string | null> {
  return new Promise<string | null>((resolve, reject) => {
    const state: CallbackServerState = {
      timeoutId: null,
      settled: false,
      resolve,
      reject,
    };

    const server = createServer();

    server.on('request', (req, res) => {
      void handleCallbackRequest(req, res, server, state, oauthState, onFailure);
    });

    server.on('error', (err) => {
      void handleFailure(server, state, onFailure, {
        code: OAUTH_CALLBACK_FAILURE_CODES.SERVER_ERROR,
        log: () => {
          console.log(red(`\nServer error: ${err.message}`));
        },
      });
    });

    server.listen(0, BIND_ADDRESS, () => {
      handleServerListening(server, state, apiUrl, oauthState, openAuthUrl, onFailure);
    });

    state.timeoutId = setupLoginTimeout(server, state, onFailure);
  });
}
