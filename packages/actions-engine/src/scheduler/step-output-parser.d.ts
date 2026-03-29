/**
 * Output parsing functions for step execution
 */
/**
 * Parse GitHub Actions output format from stdout
 * Format: ::set-output name=<name>::<value>
 * Or: echo "name=value" >> $GITHUB_OUTPUT
 */
export declare function parseOutputs(stdout: string): Record<string, string>;
export declare function iterateNormalizedLines(content: string, iterate: (line: string) => void): void;
export declare function parseLegacyOutputLine(line: string, outputs: Record<string, string>): void;
export declare function parseSimpleOutputLine(line: string, outputs: Record<string, string>): void;
export declare function parsePathFile(content: string): string[];
//# sourceMappingURL=step-output-parser.d.ts.map