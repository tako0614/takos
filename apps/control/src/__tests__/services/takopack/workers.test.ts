import { describe, expect, it, vi } from 'vitest';
import {
  buildWorkerSlug,
  buildWorkerEnvBindings,
} from '@/services/takopack/workers';

describe('buildWorkerSlug', () => {
  it('creates a valid slug from package and worker names', () => {
    const slug = buildWorkerSlug('my-package', 'api-worker', 'abcdef123456');
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug.length).toBeLessThanOrEqual(32);
    expect(slug.length).toBeGreaterThanOrEqual(3);
  });

  it('sanitizes special characters', () => {
    const slug = buildWorkerSlug('My Package!!', 'Worker_Name', 'abcdef123456');
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug).not.toContain('!');
    expect(slug).not.toContain('_');
  });

  it('lowercases the entire slug', () => {
    const slug = buildWorkerSlug('PackageName', 'WorkerName', 'ABCDEF123456');
    expect(slug).toBe(slug.toLowerCase());
  });

  it('truncates long names and appends workerId suffix', () => {
    const slug = buildWorkerSlug(
      'very-long-package-name-that-exceeds',
      'very-long-worker-name',
      'abcdef123456',
    );
    expect(slug.length).toBeLessThanOrEqual(32);
    // Should end with a suffix derived from workerId
    expect(slug).toContain('abcdef');
  });

  it('falls back to worker- prefix for empty base', () => {
    const slug = buildWorkerSlug('', '', 'abcdef123456');
    expect(slug).toMatch(/^worker-/);
    expect(slug.length).toBeGreaterThanOrEqual(3);
  });

  it('handles single-character names', () => {
    const slug = buildWorkerSlug('a', 'b', 'xyz789');
    expect(slug.length).toBeGreaterThanOrEqual(3);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('removes consecutive dashes', () => {
    const slug = buildWorkerSlug('my---package', 'api---worker', 'abc123');
    expect(slug).not.toMatch(/--/);
  });

  it('removes leading and trailing dashes', () => {
    const slug = buildWorkerSlug('-leading-', '-trailing-', 'abc123');
    expect(slug).not.toMatch(/^-/);
    expect(slug).not.toMatch(/-$/);
  });
});

describe('buildWorkerEnvBindings', () => {
  it('merges defaults and worker env', () => {
    const bindings = buildWorkerEnvBindings(
      { DEFAULT_KEY: 'default-val' },
      { WORKER_KEY: 'worker-val' },
    );

    expect(bindings).toEqual(expect.arrayContaining([
      { type: 'plain_text', name: 'DEFAULT_KEY', text: 'default-val' },
      { type: 'plain_text', name: 'WORKER_KEY', text: 'worker-val' },
    ]));
  });

  it('worker env overrides defaults', () => {
    const bindings = buildWorkerEnvBindings(
      { KEY: 'default' },
      { KEY: 'override' },
    );

    const keyBinding = bindings.find((b) => b.name === 'KEY');
    expect(keyBinding).toEqual({ type: 'plain_text', name: 'KEY', text: 'override' });
  });

  it('adds CLIENT_ID as plain_text', () => {
    const bindings = buildWorkerEnvBindings({}, {}, 'my-client-id');
    const clientId = bindings.find((b) => b.name === 'CLIENT_ID');
    expect(clientId).toEqual({ type: 'plain_text', name: 'CLIENT_ID', text: 'my-client-id' });
  });

  it('adds CLIENT_SECRET as secret_text', () => {
    const bindings = buildWorkerEnvBindings({}, {}, undefined, 'my-secret');
    const clientSecret = bindings.find((b) => b.name === 'CLIENT_SECRET');
    expect(clientSecret).toEqual({ type: 'secret_text', name: 'CLIENT_SECRET', text: 'my-secret' });
  });

  it('adds both CLIENT_ID and CLIENT_SECRET when provided', () => {
    const bindings = buildWorkerEnvBindings({}, {}, 'client-id', 'client-secret');
    expect(bindings).toEqual(expect.arrayContaining([
      { type: 'plain_text', name: 'CLIENT_ID', text: 'client-id' },
      { type: 'secret_text', name: 'CLIENT_SECRET', text: 'client-secret' },
    ]));
  });

  it('does not add CLIENT_ID/CLIENT_SECRET when undefined', () => {
    const bindings = buildWorkerEnvBindings({}, {});
    const names = bindings.map((b) => b.name);
    expect(names).not.toContain('CLIENT_ID');
    expect(names).not.toContain('CLIENT_SECRET');
  });

  it('returns empty array for empty inputs', () => {
    const bindings = buildWorkerEnvBindings({}, {});
    expect(bindings).toEqual([]);
  });

  it('trims whitespace from env key names', () => {
    const bindings = buildWorkerEnvBindings({}, { '  KEY  ': 'value' });
    const keyBinding = bindings.find((b) => b.name === 'KEY');
    expect(keyBinding).toBeDefined();
    expect(keyBinding?.text).toBe('value');
  });

  it('handles null/undefined env objects gracefully', () => {
    const bindings = buildWorkerEnvBindings(
      null as unknown as Record<string, string>,
      undefined as unknown as Record<string, string>,
    );
    expect(bindings).toEqual([]);
  });
});
