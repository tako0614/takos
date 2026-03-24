import { describe, expect, it } from 'vitest';
import { parseKeyValueFile, parsePathFile } from '../../runtime/actions/file-parsers.js';

// ---------------------------------------------------------------------------
// parseKeyValueFile
// ---------------------------------------------------------------------------

describe('parseKeyValueFile', () => {
  it('parses simple key=value pairs', () => {
    expect(parseKeyValueFile('KEY=value')).toEqual({ KEY: 'value' });
  });

  it('parses multiple key=value pairs', () => {
    const content = 'KEY1=value1\nKEY2=value2\nKEY3=value3';
    expect(parseKeyValueFile(content)).toEqual({
      KEY1: 'value1',
      KEY2: 'value2',
      KEY3: 'value3',
    });
  });

  it('handles empty value', () => {
    expect(parseKeyValueFile('KEY=')).toEqual({ KEY: '' });
  });

  it('handles value containing equals sign', () => {
    expect(parseKeyValueFile('KEY=a=b=c')).toEqual({ KEY: 'a=b=c' });
  });

  it('handles heredoc format', () => {
    const content = 'OUTPUT<<EOF\nline1\nline2\nEOF';
    expect(parseKeyValueFile(content)).toEqual({ OUTPUT: 'line1\nline2' });
  });

  it('handles heredoc with custom delimiter', () => {
    const content = 'DATA<<DELIM\ncontent here\nDELIM';
    expect(parseKeyValueFile(content)).toEqual({ DATA: 'content here' });
  });

  it('handles empty heredoc', () => {
    const content = 'EMPTY<<EOF\nEOF';
    expect(parseKeyValueFile(content)).toEqual({ EMPTY: '' });
  });

  it('handles CRLF line endings', () => {
    const content = 'KEY1=value1\r\nKEY2=value2';
    expect(parseKeyValueFile(content)).toEqual({
      KEY1: 'value1',
      KEY2: 'value2',
    });
  });

  it('skips empty lines', () => {
    const content = 'KEY1=value1\n\n\nKEY2=value2';
    expect(parseKeyValueFile(content)).toEqual({
      KEY1: 'value1',
      KEY2: 'value2',
    });
  });

  it('skips lines without equals sign', () => {
    const content = 'noequals\nKEY=value';
    expect(parseKeyValueFile(content)).toEqual({ KEY: 'value' });
  });

  it('handles mixed heredoc and regular entries', () => {
    const content = 'SIMPLE=val\nHERE<<EOF\nmulti\nline\nEOF\nAFTER=done';
    expect(parseKeyValueFile(content)).toEqual({
      SIMPLE: 'val',
      HERE: 'multi\nline',
      AFTER: 'done',
    });
  });

  it('handles empty input', () => {
    expect(parseKeyValueFile('')).toEqual({});
  });

  it('last value wins for duplicate keys', () => {
    const content = 'KEY=first\nKEY=second';
    expect(parseKeyValueFile(content)).toEqual({ KEY: 'second' });
  });
});

// ---------------------------------------------------------------------------
// parsePathFile
// ---------------------------------------------------------------------------

describe('parsePathFile', () => {
  it('parses path entries', () => {
    expect(parsePathFile('/usr/bin\n/home/user/.local/bin')).toEqual([
      '/usr/bin',
      '/home/user/.local/bin',
    ]);
  });

  it('trims whitespace', () => {
    expect(parsePathFile('  /usr/bin  \n  /home/bin  ')).toEqual([
      '/usr/bin',
      '/home/bin',
    ]);
  });

  it('filters empty lines', () => {
    expect(parsePathFile('/usr/bin\n\n\n/home/bin\n')).toEqual([
      '/usr/bin',
      '/home/bin',
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parsePathFile('/usr/bin\r\n/home/bin')).toEqual([
      '/usr/bin',
      '/home/bin',
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(parsePathFile('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(parsePathFile('   \n   \n   ')).toEqual([]);
  });

  it('handles single path entry', () => {
    expect(parsePathFile('/single/path')).toEqual(['/single/path']);
  });
});
