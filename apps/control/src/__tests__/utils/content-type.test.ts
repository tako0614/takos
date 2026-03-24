import { describe, expect, it } from 'vitest';
import { getContentTypeFromPath, isProbablyBinaryContent } from '@/utils/content-type';

describe('getContentTypeFromPath', () => {
  it('returns text/html for .html files', () => {
    expect(getContentTypeFromPath('index.html')).toBe('text/html');
  });

  it('returns text/html for .htm files', () => {
    expect(getContentTypeFromPath('page.htm')).toBe('text/html');
  });

  it('returns text/css for .css files', () => {
    expect(getContentTypeFromPath('style.css')).toBe('text/css');
  });

  it('returns application/javascript for .js files', () => {
    expect(getContentTypeFromPath('app.js')).toBe('application/javascript');
  });

  it('returns application/javascript for .mjs files', () => {
    expect(getContentTypeFromPath('module.mjs')).toBe('application/javascript');
  });

  it('returns application/json for .json files', () => {
    expect(getContentTypeFromPath('config.json')).toBe('application/json');
  });

  it('returns image/png for .png files', () => {
    expect(getContentTypeFromPath('icon.png')).toBe('image/png');
  });

  it('returns image/jpeg for .jpg files', () => {
    expect(getContentTypeFromPath('photo.jpg')).toBe('image/jpeg');
  });

  it('returns image/jpeg for .jpeg files', () => {
    expect(getContentTypeFromPath('photo.jpeg')).toBe('image/jpeg');
  });

  it('returns image/svg+xml for .svg files', () => {
    expect(getContentTypeFromPath('icon.svg')).toBe('image/svg+xml');
  });

  it('returns font/woff2 for .woff2 files', () => {
    expect(getContentTypeFromPath('font.woff2')).toBe('font/woff2');
  });

  it('returns application/pdf for .pdf files', () => {
    expect(getContentTypeFromPath('doc.pdf')).toBe('application/pdf');
  });

  it('returns application/wasm for .wasm files', () => {
    expect(getContentTypeFromPath('module.wasm')).toBe('application/wasm');
  });

  it('returns text/plain for .txt files', () => {
    expect(getContentTypeFromPath('readme.txt')).toBe('text/plain');
  });

  it('returns application/octet-stream for unknown extensions', () => {
    expect(getContentTypeFromPath('data.bin')).toBe('application/octet-stream');
  });

  it('returns application/octet-stream for no extension', () => {
    expect(getContentTypeFromPath('Makefile')).toBe('application/octet-stream');
  });

  it('handles uppercase extensions by lowercasing', () => {
    expect(getContentTypeFromPath('IMAGE.PNG')).toBe('image/png');
  });

  it('handles paths with directories', () => {
    expect(getContentTypeFromPath('src/assets/style.css')).toBe('text/css');
  });

  it('returns video/mp4 for .mp4 files', () => {
    expect(getContentTypeFromPath('video.mp4')).toBe('video/mp4');
  });

  it('returns audio/mpeg for .mp3 files', () => {
    expect(getContentTypeFromPath('song.mp3')).toBe('audio/mpeg');
  });

  it('returns image/webp for .webp files', () => {
    expect(getContentTypeFromPath('image.webp')).toBe('image/webp');
  });
});

describe('isProbablyBinaryContent', () => {
  it('returns false for plain ASCII text', () => {
    const data = new TextEncoder().encode('Hello, world!');
    expect(isProbablyBinaryContent(data)).toBe(false);
  });

  it('returns false for UTF-8 text', () => {
    const data = new TextEncoder().encode('こんにちは');
    expect(isProbablyBinaryContent(data)).toBe(false);
  });

  it('returns true when data contains null byte', () => {
    const data = new Uint8Array([72, 101, 0, 108, 111]);
    expect(isProbablyBinaryContent(data)).toBe(true);
  });

  it('returns false for empty data', () => {
    const data = new Uint8Array([]);
    expect(isProbablyBinaryContent(data)).toBe(false);
  });

  it('returns true for binary-like data (null bytes)', () => {
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]);
    expect(isProbablyBinaryContent(data)).toBe(true);
  });

  it('returns false for data with high bytes but no null', () => {
    const data = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc]);
    expect(isProbablyBinaryContent(data)).toBe(false);
  });
});
