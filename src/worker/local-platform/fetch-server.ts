import type {
  FetchServerInstance,
  FetchServerOptions,
} from "./node-fetch-server.ts";

export type { FetchServerInstance, FetchServerOptions };

export async function serveNodeFetch(
  options: FetchServerOptions,
): Promise<FetchServerInstance> {
  const { startNodeFetchServer } = await import("./node-fetch-server.ts");
  return startNodeFetchServer(options);
}
