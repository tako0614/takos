/**
 * YAML document parsing, object-document validation, and checksum parsing.
 */

import YAML from 'yaml';
import type { TakopackObject } from './types';
import { asRecord, asStringMap, normalizePackagePath } from './manifest-utils';

const SUPPORTED_KINDS = new Set<string>([
  'Package',
  'Resource',
  'Workload',
  'Endpoint',
  'Binding',
  'McpServer',
  'Policy', // Reserved — parsed but not processed in v1alpha1
  'Rollout',
]);

export function parseObjectDocument(docValue: unknown, index: number): TakopackObject {
  const record = asRecord(docValue);
  const apiVersion = String(record.apiVersion || '').trim();
  const kind = String(record.kind || '').trim();
  const metadata = asRecord(record.metadata);
  const spec = asRecord(record.spec);

  if (apiVersion !== 'takos.dev/v1alpha1') {
    throw new Error(`manifest.yaml doc[${index}] has unsupported apiVersion: ${apiVersion || '<empty>'}`);
  }

  if (!SUPPORTED_KINDS.has(kind)) {
    throw new Error(`manifest.yaml doc[${index}] has unsupported kind: ${kind || '<empty>'}`);
  }

  const name = String(metadata.name || '').trim();
  if (!name) {
    throw new Error(`manifest.yaml doc[${index}] metadata.name is required`);
  }

  const labels = asStringMap(metadata.labels, `manifest.yaml doc[${index}] metadata.labels`);

  return {
    apiVersion: 'takos.dev/v1alpha1',
    kind: kind as TakopackObject['kind'],
    metadata: {
      name,
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
    },
    spec,
  } as TakopackObject;
}

export function parseChecksums(content: string): Map<string, string> {
  const checksums = new Map<string, string>();
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (line.startsWith('#')) continue;

    const match = /^([a-fA-F0-9]{64})\s+(.+)$/.exec(line);
    if (!match) {
      throw new Error(`Invalid checksums.txt line: ${line}`);
    }

    const digest = match[1].toLowerCase();
    const filePath = normalizePackagePath(match[2]);
    if (!filePath) {
      throw new Error(`Invalid checksums.txt entry path: ${line}`);
    }

    checksums.set(filePath, digest);
  }

  return checksums;
}

export function parseManifestObjects(content: string): TakopackObject[] {
  const docs = YAML.parseAllDocuments(content);
  if (docs.length === 0) {
    throw new Error('Invalid takopack: manifest.yaml is empty');
  }

  const objects = docs.map((doc, index) => {
    if (doc.errors.length > 0) {
      throw new Error(`Invalid takopack: manifest.yaml doc[${index}] parse error`);
    }
    return parseObjectDocument(doc.toJSON(), index);
  });

  const names = new Set<string>();
  for (const obj of objects) {
    const name = obj.metadata.name;
    if (names.has(name)) {
      throw new Error(`Invalid takopack: duplicate metadata.name in manifest.yaml (${name})`);
    }
    names.add(name);
  }

  return objects;
}
