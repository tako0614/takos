export interface ParsedSseEvent {
  event: string;
  id?: string;
  retry?: number;
  data: string | null;
}

export function parseSseEventBlock(block: string): ParsedSseEvent | null {
  if (!block.trim()) {
    return null;
  }

  const event: ParsedSseEvent = {
    event: 'message',
    data: null,
  };

  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) {
      continue;
    }

    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }

    const field = line.slice(0, separator);
    const value = line.slice(separator + 1).trimStart();

    if (field === 'event') {
      event.event = value || 'message';
      continue;
    }

    if (field === 'id') {
      event.id = value;
      continue;
    }

    if (field === 'retry') {
      const retryMs = Number(value);
      if (Number.isInteger(retryMs) && retryMs >= 0) {
        event.retry = retryMs;
      }
      continue;
    }

    if (field === 'data') {
      dataLines.push(value);
    }
  }

  if (dataLines.length > 0) {
    event.data = dataLines.join('\n');
  }

  return event;
}
