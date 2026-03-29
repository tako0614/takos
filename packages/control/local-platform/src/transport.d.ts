import type { LocalFetch } from '../../src/local-platform/runtime.ts';
export declare function startCanonicalLocalServer(options: {
    service: string;
    defaultPort: number;
    createFetch: () => Promise<LocalFetch>;
}): Promise<void>;
//# sourceMappingURL=transport.d.ts.map