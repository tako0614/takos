/**
 * Output parsing functions for step execution
 */

const SIMPLE_OUTPUT_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parse GitHub Actions output format from stdout
 * Format: ::set-output name=<name>::<value>
 * Or: echo "name=value" >> $GITHUB_OUTPUT
 */
export function parseOutputs(stdout: string): Record<string, string> {
  const outputs: Record<string, string> = {};

  iterateNormalizedLines(stdout, (line) => {
    parseLegacyOutputLine(line, outputs);
    parseSimpleOutputLine(line, outputs);
  });

  return outputs;
}

export function iterateNormalizedLines(
  content: string,
  iterate: (line: string) => void
): void {
  if (content.length === 0) {
    return;
  }

  const lines = content.split('\n');
  for (let line of lines) {
    if (line.endsWith('\r')) {
      line = line.slice(0, -1);
    }
    iterate(line);
  }
}

export function parseLegacyOutputLine(
  line: string,
  outputs: Record<string, string>
): void {
  const prefix = '::set-output name=';
  if (!line.startsWith(prefix)) {
    return;
  }

  const separatorIndex = line.indexOf('::', prefix.length);
  if (separatorIndex === -1) {
    return;
  }

  const name = line.slice(prefix.length, separatorIndex);
  if (name.length === 0 || name.includes(':')) {
    return;
  }

  const value = line.slice(separatorIndex + 2);
  outputs[name] = value;
}

export function parseSimpleOutputLine(
  line: string,
  outputs: Record<string, string>
): void {
  const separatorIndex = line.indexOf('=');
  if (separatorIndex <= 0) {
    return;
  }

  const name = line.slice(0, separatorIndex);
  if (!SIMPLE_OUTPUT_NAME_REGEX.test(name)) {
    return;
  }

  const value = line.slice(separatorIndex + 1);
  if (!(name in outputs)) {
    outputs[name] = value;
  }
}

export function parsePathFile(content: string): string[] {
  const entries: string[] = [];

  iterateNormalizedLines(content, (line) => {
    if (line.trim().length === 0) {
      return;
    }
    entries.push(line);
  });

  return entries;
}
