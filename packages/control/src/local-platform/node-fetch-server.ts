import http from "node:http";
import { Readable } from "node:stream";
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
    : Readable.toWeb(request) as ReadableStream<Uint8Array>;
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

  response.headers.forEach((value, key) => {
    nodeResponse.setHeader(key, value);
  });

  if (!response.body) {
    nodeResponse.end();
    return;
  }

  const body = Readable.fromWeb(
    response.body as NodeReadableStream<Uint8Array>,
  );
  await new Promise<void>((resolve, reject) => {
    body.on("error", reject);
    nodeResponse.on("error", reject);
    nodeResponse.on("finish", resolve);
    body.pipe(nodeResponse);
  });
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
      response.statusCode = 500;
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end(message);
    }
  });

  server.listen(options.port, options.onListen);
  return server;
}
