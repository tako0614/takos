import http from 'node:http';
export type NodeFetchHandler = (request: Request) => Response | Promise<Response>;
export type FetchServerOptions = {
    port: number;
    fetch: NodeFetchHandler;
    onListen?: () => void;
};
export type FetchServerInstance = http.Server;
export declare function startNodeFetchServer(options: FetchServerOptions): FetchServerInstance;
//# sourceMappingURL=node-fetch-server.d.ts.map