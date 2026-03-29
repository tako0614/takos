import type { AppService, AppMcpServer, AppFileHandler } from '../app-manifest-types';
export declare function parseServices(specRecord: Record<string, unknown>): Record<string, AppService>;
export declare function parseMcpServers(specRecord: Record<string, unknown>): AppMcpServer[] | undefined;
export declare function parseFileHandlers(specRecord: Record<string, unknown>): AppFileHandler[] | undefined;
//# sourceMappingURL=parse-services.d.ts.map