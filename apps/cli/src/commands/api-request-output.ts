import { green } from '@std/fmt/colors';
import { Buffer } from "node:buffer";

export function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function parseBodyByContentType(contentType: string | null, bodyBuffer: Buffer): unknown {
  if (bodyBuffer.length === 0) {
    return null;
  }

  if (contentType?.includes('application/json')) {
    try {
      return JSON.parse(bodyBuffer.toString('utf8'));
    } catch {
      return bodyBuffer.toString('utf8');
    }
  }

  if (contentType?.startsWith('text/') || contentType?.includes('application/xml')) {
    return bodyBuffer.toString('utf8');
  }

  return {
    encoding: 'base64',
    size: bodyBuffer.length,
    data: bodyBuffer.toString('base64'),
  };
}

export function printSuccess(parsedBody: unknown, jsonOutput: boolean): void {
  if (parsedBody === null || parsedBody === undefined) {
    console.log(green('OK'));
    return;
  }

  if (typeof parsedBody === 'string') {
    console.log(parsedBody);
    return;
  }

  if (jsonOutput) {
    console.log(JSON.stringify(parsedBody));
    return;
  }

  console.log(JSON.stringify(parsedBody, null, 2));
}
