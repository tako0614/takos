type BrowserBinding = {
    connect(): Promise<{
        webSocketDebuggerUrl: string;
    }>;
};
export declare function renderPdfWithCloudflareBrowser(browserBinding: BrowserBinding, html: string): Promise<ArrayBuffer>;
export {};
//# sourceMappingURL=pdf-render.d.ts.map