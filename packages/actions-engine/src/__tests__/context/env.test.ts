import { parseGitHubEnvFile } from '../../context.ts';


import { assertEquals, assert } from 'jsr:@std/assert';

  Deno.test('parseGitHubEnvFile - parses simple NAME=value lines', () => {
  const content = ['FOO=bar', 'BAR=baz'].join('\n');

    assertEquals(parseGitHubEnvFile(content), {
      FOO: 'bar',
      BAR: 'baz',
    });
})
  Deno.test('parseGitHubEnvFile - parses heredoc NAME<<EOF blocks', () => {
  const content = ['MULTILINE<<EOF', 'line1', 'line2', 'EOF', 'AFTER=value'].join(
      '\n'
    );

    assertEquals(parseGitHubEnvFile(content), {
      MULTILINE: 'line1\nline2',
      AFTER: 'value',
    });
})
  Deno.test('parseGitHubEnvFile - parses CRLF heredoc blocks and strips carriage returns', () => {
  const content =
      'WINDOWS<<END\r\nfirst line\r\nsecond line\r\nEND\r\nNEXT=value\r\n';

    const env = parseGitHubEnvFile(content);

    assertEquals(env, {
      WINDOWS: 'first line\nsecond line',
      NEXT: 'value',
    });
    assert(!(env.WINDOWS).includes('\r'));
})