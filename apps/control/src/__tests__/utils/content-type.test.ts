import { getContentTypeFromPath, isProbablyBinaryContent } from '@/utils/content-type';


import { assertEquals } from 'jsr:@std/assert';

  Deno.test('getContentTypeFromPath - returns text/html for .html files', () => {
  assertEquals(getContentTypeFromPath('index.html'), 'text/html');
})
  Deno.test('getContentTypeFromPath - returns text/html for .htm files', () => {
  assertEquals(getContentTypeFromPath('page.htm'), 'text/html');
})
  Deno.test('getContentTypeFromPath - returns text/css for .css files', () => {
  assertEquals(getContentTypeFromPath('style.css'), 'text/css');
})
  Deno.test('getContentTypeFromPath - returns application/javascript for .js files', () => {
  assertEquals(getContentTypeFromPath('app.js'), 'application/javascript');
})
  Deno.test('getContentTypeFromPath - returns application/javascript for .mjs files', () => {
  assertEquals(getContentTypeFromPath('module.mjs'), 'application/javascript');
})
  Deno.test('getContentTypeFromPath - returns application/json for .json files', () => {
  assertEquals(getContentTypeFromPath('config.json'), 'application/json');
})
  Deno.test('getContentTypeFromPath - returns image/png for .png files', () => {
  assertEquals(getContentTypeFromPath('icon.png'), 'image/png');
})
  Deno.test('getContentTypeFromPath - returns image/jpeg for .jpg files', () => {
  assertEquals(getContentTypeFromPath('photo.jpg'), 'image/jpeg');
})
  Deno.test('getContentTypeFromPath - returns image/jpeg for .jpeg files', () => {
  assertEquals(getContentTypeFromPath('photo.jpeg'), 'image/jpeg');
})
  Deno.test('getContentTypeFromPath - returns image/svg+xml for .svg files', () => {
  assertEquals(getContentTypeFromPath('icon.svg'), 'image/svg+xml');
})
  Deno.test('getContentTypeFromPath - returns font/woff2 for .woff2 files', () => {
  assertEquals(getContentTypeFromPath('font.woff2'), 'font/woff2');
})
  Deno.test('getContentTypeFromPath - returns application/pdf for .pdf files', () => {
  assertEquals(getContentTypeFromPath('doc.pdf'), 'application/pdf');
})
  Deno.test('getContentTypeFromPath - returns application/wasm for .wasm files', () => {
  assertEquals(getContentTypeFromPath('module.wasm'), 'application/wasm');
})
  Deno.test('getContentTypeFromPath - returns text/plain for .txt files', () => {
  assertEquals(getContentTypeFromPath('readme.txt'), 'text/plain');
})
  Deno.test('getContentTypeFromPath - returns application/octet-stream for unknown extensions', () => {
  assertEquals(getContentTypeFromPath('data.bin'), 'application/octet-stream');
})
  Deno.test('getContentTypeFromPath - returns application/octet-stream for no extension', () => {
  assertEquals(getContentTypeFromPath('Makefile'), 'application/octet-stream');
})
  Deno.test('getContentTypeFromPath - handles uppercase extensions by lowercasing', () => {
  assertEquals(getContentTypeFromPath('IMAGE.PNG'), 'image/png');
})
  Deno.test('getContentTypeFromPath - handles paths with directories', () => {
  assertEquals(getContentTypeFromPath('src/assets/style.css'), 'text/css');
})
  Deno.test('getContentTypeFromPath - returns video/mp4 for .mp4 files', () => {
  assertEquals(getContentTypeFromPath('video.mp4'), 'video/mp4');
})
  Deno.test('getContentTypeFromPath - returns audio/mpeg for .mp3 files', () => {
  assertEquals(getContentTypeFromPath('song.mp3'), 'audio/mpeg');
})
  Deno.test('getContentTypeFromPath - returns image/webp for .webp files', () => {
  assertEquals(getContentTypeFromPath('image.webp'), 'image/webp');
})

  Deno.test('isProbablyBinaryContent - returns false for plain ASCII text', () => {
  const data = new TextEncoder().encode('Hello, world!');
    assertEquals(isProbablyBinaryContent(data), false);
})
  Deno.test('isProbablyBinaryContent - returns false for UTF-8 text', () => {
  const data = new TextEncoder().encode('こんにちは');
    assertEquals(isProbablyBinaryContent(data), false);
})
  Deno.test('isProbablyBinaryContent - returns true when data contains null byte', () => {
  const data = new Uint8Array([72, 101, 0, 108, 111]);
    assertEquals(isProbablyBinaryContent(data), true);
})
  Deno.test('isProbablyBinaryContent - returns false for empty data', () => {
  const data = new Uint8Array([]);
    assertEquals(isProbablyBinaryContent(data), false);
})
  Deno.test('isProbablyBinaryContent - returns true for binary-like data (null bytes)', () => {
  const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]);
    assertEquals(isProbablyBinaryContent(data), true);
})
  Deno.test('isProbablyBinaryContent - returns false for data with high bytes but no null', () => {
  const data = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc]);
    assertEquals(isProbablyBinaryContent(data), false);
})