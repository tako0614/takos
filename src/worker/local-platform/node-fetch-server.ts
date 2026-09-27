import http from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

export type NodeFetchHandler = (
  request: Request,
) => Response | Promise<Response>;
export type FetchServerOptions = {
  port: number;
  fetch: NodeFetchHandler;
  onListen?: () => void;
};
export type FetchServerInstance = http.Server;

function toRequest(request: http.IncomingMessage): Request {
  const protocol = request.headers["x-forwarded-proto"] ?? "http";
  const host = request.headers.host ?? "127.0.0.1";
  const url = new URL(request.url ?? "/", `${protocol}://${host}`);
  const method = request.method ?? "GET";
  const body = method === "GET" || method === "HEAD"
    ? undefined
    : Readable.toWeb(request) as unknown as ReadableStream<Uint8Array>;
  return new Request(
    url,
    {
      method,
      headers: request.headers as HeadersInit,
      body,
      duplex: body ? "half" : undefined,
    } as RequestInit & { duplex?: "half" },
  );
}

async function writeResponse(
  nodeResponse: http.ServerResponse,
  response: Response,
): Promise<void> {
  nodeResponse.statusCode = response.status;
  nodeResponse.statusMessage = response.statusText;

  // Set-Cookie is a multi-value header: ServerResponse.setHeader replaces the
  // previous value for the same key, so writing it inside the forEach loop
  // would silently drop all but the last cookie (local OIDC login dead-ends —
  // the callback emits the session cookie AND the state-cookie clear). Gather
  // them via getSetCookie (Bun/undici) and write once as an array.
  const setCookies =
    (response.headers as { getSetCookie?: () => string[] }).getSetCookie?.() ??
    [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    nodeResponse.setHeader(key, value);
  });
  if (setCookies.length > 0) {
    nodeResponse.setHeader("set-cookie", setCookies);
  }

  if (!response.body) {
    nodeResponse.end();
    return;
  }

  const body = Readable.fromWeb(
    response.body as unknown as NodeReadableStream<Uint8Array>,
  );
  // pipeline destroys both streams (and cancels the underlying Web
  // ReadableStream reader via the fromWeb adapter) on any error or early close
  // — e.g. a client disconnect mid-stream — so the source is never left being
  // pulled. It still rejects on error so the createServer catch runs.
  await pipeline(body, nodeResponse);
}

export function startNodeFetchServer(
  options: FetchServerOptions,
): FetchServerInstance {
  const server = http.createServer(async (request, response) => {
    try {
      const webRequest = toRequest(request);
      const webResponse = await options.fetch(webRequest);
      await writeResponse(response, webResponse);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Internal Server Error";
      // Only emit a 500 body when nothing has been flushed yet. If the failure
      // occurred after headers were sent (e.g. a mid-stream error/abort),
      // setHeader/end would throw ERR_HTTP_HEADERS_SENT / write-after-end, so
      // just destroy the socket instead of double-writing.
      if (!response.headersSent && !response.writableEnded) {
        response.statusCode = 500;
        response.setHeader("content-type", "text/plain; charset=utf-8");
        response.end(message);
      } else {
        response.destroy(error instanceof Error ? error : undefined);
      }
    }
  });

  server.listen(options.port, options.onListen);
  return server;
}
