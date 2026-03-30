import { basename } from 'path';
import { readFileSync } from 'fs';

export function parseKeyValue(value: string): { key: string; value: string } {
  const separatorIndex = value.indexOf('=');
  if (separatorIndex <= 0) {
    throw new Error(`Invalid key=value option: ${value}`);
  }

  const key = value.slice(0, separatorIndex).trim();
  const parsedValue = value.slice(separatorIndex + 1);
  if (!key) {
    throw new Error(`Invalid key=value option: ${value}`);
  }

  return { key, value: parsedValue };
}

export type BodyPreparation = {
  body: unknown;
  contentType: string | null;
};

type BodyOptions = {
  body?: string;
  bodyFile?: string;
  rawBody?: string;
  rawBodyFile?: string;
  form?: string[];
  formFile?: string[];
  contentType?: string;
};

function prepareJsonBody(options: BodyOptions): BodyPreparation {
  if (options.body === undefined && !options.bodyFile) {
    throw new Error('Either --body or --body-file is required for JSON mode');
  }
  const raw = options.body !== undefined ? options.body : readFileSync(options.bodyFile as string, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return {
      body: JSON.stringify(parsed),
      contentType: 'application/json',
    };
  } catch (error) {
    throw new Error(`Invalid JSON body: ${String(error)}`);
  }
}

function prepareRawBody(options: BodyOptions): BodyPreparation {
  if (options.rawBody !== undefined) {
    return {
      body: options.rawBody,
      contentType: options.contentType ?? 'text/plain; charset=utf-8',
    };
  }

  if (!options.rawBodyFile) {
    throw new Error('Either --raw-body or --raw-body-file is required for raw mode');
  }
  const buffer = readFileSync(options.rawBodyFile);
  return {
    body: buffer,
    contentType: options.contentType ?? 'application/octet-stream',
  };
}

function prepareFormBody(options: BodyOptions): BodyPreparation {
  const formData = new FormData();

  for (const pair of options.form ?? []) {
    const { key, value } = parseKeyValue(pair);
    formData.append(key, value);
  }

  for (const pair of options.formFile ?? []) {
    const { key, value } = parseKeyValue(pair);
    const fileContent = readFileSync(value);
    formData.append(key, new Blob([fileContent]), basename(value));
  }

  return {
    body: formData,
    contentType: null,
  };
}

export function prepareBody(options: BodyOptions): BodyPreparation {
  const hasJsonInline = options.body !== undefined;
  const hasJsonFile = options.bodyFile !== undefined;
  const hasRawInline = options.rawBody !== undefined;
  const hasRawFile = options.rawBodyFile !== undefined;
  const hasForm = (options.form?.length ?? 0) > 0 || (options.formFile?.length ?? 0) > 0;

  const jsonMode = hasJsonInline || hasJsonFile;
  const rawMode = hasRawInline || hasRawFile;

  const activeModes = [jsonMode, rawMode, hasForm].filter(Boolean).length;
  if (activeModes > 1) {
    throw new Error('Only one body mode can be used at a time (json, raw, or form)');
  }

  if (jsonMode) {
    return prepareJsonBody(options);
  }

  if (rawMode) {
    return prepareRawBody(options);
  }

  if (hasForm) {
    return prepareFormBody(options);
  }

  return {
    body: undefined,
    contentType: null,
  };
}
