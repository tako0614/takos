import { describe, expect, it } from 'vitest';

import { parseGitHubEnvFile } from '../../context.js';

describe('parseGitHubEnvFile', () => {
  it('parses simple NAME=value lines', () => {
    const content = ['FOO=bar', 'BAR=baz'].join('\n');

    expect(parseGitHubEnvFile(content)).toEqual({
      FOO: 'bar',
      BAR: 'baz',
    });
  });

  it('parses heredoc NAME<<EOF blocks', () => {
    const content = ['MULTILINE<<EOF', 'line1', 'line2', 'EOF', 'AFTER=value'].join(
      '\n'
    );

    expect(parseGitHubEnvFile(content)).toEqual({
      MULTILINE: 'line1\nline2',
      AFTER: 'value',
    });
  });

  it('parses CRLF heredoc blocks and strips carriage returns', () => {
    const content =
      'WINDOWS<<END\r\nfirst line\r\nsecond line\r\nEND\r\nNEXT=value\r\n';

    const env = parseGitHubEnvFile(content);

    expect(env).toEqual({
      WINDOWS: 'first line\nsecond line',
      NEXT: 'value',
    });
    expect(env.WINDOWS).not.toContain('\r');
  });
});
