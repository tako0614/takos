import { describe, expect, it } from 'vitest';
import {
  resolveTemplates,
  validateTemplateReferences,
  type TemplateContext,
} from '../app-manifest-template';

describe('app-manifest-template', () => {
  const context: TemplateContext = {
    routes: {
      'browser-api': { url: 'https://browser-api.example.com', domain: 'browser-api.example.com', path: '/api' },
      api: { url: 'https://api.example.com', domain: 'api.example.com', path: '/' },
    },
    containers: {
      headless: { port: 9222 },
    },
    services: {
      executor: { ipv4: '10.0.0.1', port: 8080 },
    },
    workers: {
      'browser-host': { url: 'https://browser-host.workers.dev' },
      api: { url: 'https://api.workers.dev' },
    },
    resources: {
      'mcp-auth-secret': { id: 'secret-abc-123' },
      db: { id: 'db-xyz-456' },
    },
  };

  describe('resolveTemplates', () => {
    it('resolves routes.xxx.url', () => {
      const result = resolveTemplates(
        { API_URL: '{{routes.api.url}}' },
        context,
      );
      expect(result).toEqual({ API_URL: 'https://api.example.com' });
    });

    it('resolves services.xxx.ipv4', () => {
      const result = resolveTemplates(
        { EXECUTOR_IP: '{{services.executor.ipv4}}' },
        context,
      );
      expect(result).toEqual({ EXECUTOR_IP: '10.0.0.1' });
    });

    it('resolves containers.xxx.port', () => {
      const result = resolveTemplates(
        { HEADLESS_PORT: '{{containers.headless.port}}' },
        context,
      );
      expect(result).toEqual({ HEADLESS_PORT: '9222' });
    });

    it('resolves services.xxx.port', () => {
      const result = resolveTemplates(
        { EXECUTOR_PORT: '{{services.executor.port}}' },
        context,
      );
      expect(result).toEqual({ EXECUTOR_PORT: '8080' });
    });

    it('resolves workers.xxx.url', () => {
      const result = resolveTemplates(
        { BROWSER_HOST_URL: '{{workers.browser-host.url}}' },
        context,
      );
      expect(result).toEqual({ BROWSER_HOST_URL: 'https://browser-host.workers.dev' });
    });

    it('resolves resources.xxx.id', () => {
      const result = resolveTemplates(
        { AUTH_SECRET_ID: '{{resources.mcp-auth-secret.id}}' },
        context,
      );
      expect(result).toEqual({ AUTH_SECRET_ID: 'secret-abc-123' });
    });

    it('resolves multiple templates in one value', () => {
      const result = resolveTemplates(
        { CONNECTION: '{{services.executor.ipv4}}:{{services.executor.port}}' },
        context,
      );
      expect(result).toEqual({ CONNECTION: '10.0.0.1:8080' });
    });

    it('resolves multiple keys', () => {
      const result = resolveTemplates(
        {
          API_URL: '{{routes.api.url}}',
          BROWSER_URL: '{{workers.browser-host.url}}',
          DB_ID: '{{resources.db.id}}',
        },
        context,
      );
      expect(result).toEqual({
        API_URL: 'https://api.example.com',
        BROWSER_URL: 'https://browser-host.workers.dev',
        DB_ID: 'db-xyz-456',
      });
    });

    it('passes through plain strings without templates', () => {
      const result = resolveTemplates(
        { STATIC: 'hello-world' },
        context,
      );
      expect(result).toEqual({ STATIC: 'hello-world' });
    });

    it('throws on unknown template path', () => {
      expect(() =>
        resolveTemplates(
          { BAD: '{{routes.nonexistent.url}}' },
          context,
        ),
      ).toThrow('Template variable not found: {{routes.nonexistent.url}}');
    });

    it('throws on deeply unknown path', () => {
      expect(() =>
        resolveTemplates(
          { BAD: '{{services.executor.nonexistent}}' },
          context,
        ),
      ).toThrow('Template variable not found: {{services.executor.nonexistent}}');
    });

    it('throws on unknown top-level section', () => {
      expect(() =>
        resolveTemplates(
          { BAD: '{{databases.main.url}}' },
          context,
        ),
      ).toThrow('Template variable not found: {{databases.main.url}}');
    });
  });

  describe('validateTemplateReferences', () => {
    const manifest = {
      containers: { headless: {} },
      services: { executor: {} },
      workers: { 'browser-host': {}, api: {} },
      routes: [{ name: 'browser-api' }, { name: 'api' }],
      resources: { 'mcp-auth-secret': {}, db: {} },
    };

    it('returns no errors for valid references', () => {
      const errors = validateTemplateReferences(
        {
          API_URL: '{{routes.api.url}}',
          EXECUTOR_IP: '{{services.executor.ipv4}}',
          BROWSER_URL: '{{workers.browser-host.url}}',
          SECRET: '{{resources.mcp-auth-secret.id}}',
        },
        manifest,
      );
      expect(errors).toEqual([]);
    });

    it('reports unknown route reference', () => {
      const errors = validateTemplateReferences(
        { URL: '{{routes.missing.url}}' },
        manifest,
      );
      expect(errors).toEqual(['URL: route "missing" not found']);
    });

    it('reports unknown container reference', () => {
      const errors = validateTemplateReferences(
        { IP: '{{containers.missing.ipv4}}' },
        manifest,
      );
      expect(errors).toEqual(['IP: container "missing" not found']);
    });

    it('reports unknown worker reference', () => {
      const errors = validateTemplateReferences(
        { URL: '{{workers.missing.url}}' },
        manifest,
      );
      expect(errors).toEqual(['URL: worker "missing" not found']);
    });

    it('reports unknown resource reference', () => {
      const errors = validateTemplateReferences(
        { ID: '{{resources.missing.id}}' },
        manifest,
      );
      expect(errors).toEqual(['ID: resource "missing" not found']);
    });

    it('reports unknown section', () => {
      const errors = validateTemplateReferences(
        { BAD: '{{databases.main.url}}' },
        manifest,
      );
      expect(errors).toEqual(['BAD: unknown section "databases"']);
    });

    it('reports invalid short path', () => {
      const errors = validateTemplateReferences(
        { BAD: '{{routes}}' },
        manifest,
      );
      expect(errors).toEqual(['BAD: invalid template path "routes"']);
    });

    it('reports unknown service reference', () => {
      const errors = validateTemplateReferences(
        { IP: '{{services.missing.ipv4}}' },
        manifest,
      );
      expect(errors).toEqual(['IP: service "missing" not found']);
    });

    it('collects multiple errors', () => {
      const errors = validateTemplateReferences(
        {
          A: '{{routes.nope.url}}',
          B: '{{services.nope.port}}',
        },
        manifest,
      );
      expect(errors).toHaveLength(2);
      expect(errors[0]).toContain('route "nope" not found');
      expect(errors[1]).toContain('service "nope" not found');
    });
  });
});
