import {
  resolveTemplates,
  validateTemplateReferences,
  type TemplateContext,
} from '../app-manifest-template.ts';


import { assertEquals, assertThrows, assertStringIncludes } from 'jsr:@std/assert';

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

  
    Deno.test('app-manifest-template - resolveTemplates - resolves routes.xxx.url', () => {
  const result = resolveTemplates(
        { API_URL: '{{routes.api.url}}' },
        context,
      );
      assertEquals(result, { API_URL: 'https://api.example.com' });
})
    Deno.test('app-manifest-template - resolveTemplates - resolves services.xxx.ipv4', () => {
  const result = resolveTemplates(
        { EXECUTOR_IP: '{{services.executor.ipv4}}' },
        context,
      );
      assertEquals(result, { EXECUTOR_IP: '10.0.0.1' });
})
    Deno.test('app-manifest-template - resolveTemplates - resolves containers.xxx.port', () => {
  const result = resolveTemplates(
        { HEADLESS_PORT: '{{containers.headless.port}}' },
        context,
      );
      assertEquals(result, { HEADLESS_PORT: '9222' });
})
    Deno.test('app-manifest-template - resolveTemplates - resolves services.xxx.port', () => {
  const result = resolveTemplates(
        { EXECUTOR_PORT: '{{services.executor.port}}' },
        context,
      );
      assertEquals(result, { EXECUTOR_PORT: '8080' });
})
    Deno.test('app-manifest-template - resolveTemplates - resolves workers.xxx.url', () => {
  const result = resolveTemplates(
        { BROWSER_HOST_URL: '{{workers.browser-host.url}}' },
        context,
      );
      assertEquals(result, { BROWSER_HOST_URL: 'https://browser-host.workers.dev' });
})
    Deno.test('app-manifest-template - resolveTemplates - resolves resources.xxx.id', () => {
  const result = resolveTemplates(
        { AUTH_SECRET_ID: '{{resources.mcp-auth-secret.id}}' },
        context,
      );
      assertEquals(result, { AUTH_SECRET_ID: 'secret-abc-123' });
})
    Deno.test('app-manifest-template - resolveTemplates - resolves multiple templates in one value', () => {
  const result = resolveTemplates(
        { CONNECTION: '{{services.executor.ipv4}}:{{services.executor.port}}' },
        context,
      );
      assertEquals(result, { CONNECTION: '10.0.0.1:8080' });
})
    Deno.test('app-manifest-template - resolveTemplates - resolves multiple keys', () => {
  const result = resolveTemplates(
        {
          API_URL: '{{routes.api.url}}',
          BROWSER_URL: '{{workers.browser-host.url}}',
          DB_ID: '{{resources.db.id}}',
        },
        context,
      );
      assertEquals(result, {
        API_URL: 'https://api.example.com',
        BROWSER_URL: 'https://browser-host.workers.dev',
        DB_ID: 'db-xyz-456',
      });
})
    Deno.test('app-manifest-template - resolveTemplates - passes through plain strings without templates', () => {
  const result = resolveTemplates(
        { STATIC: 'hello-world' },
        context,
      );
      assertEquals(result, { STATIC: 'hello-world' });
})
    Deno.test('app-manifest-template - resolveTemplates - throws on unknown template path', () => {
  assertThrows(() => { () =>
        resolveTemplates(
          { BAD: '{{routes.nonexistent.url}}' },
          context,
        ),
      ; }, 'Template variable not found: {{routes.nonexistent.url}}');
})
    Deno.test('app-manifest-template - resolveTemplates - throws on deeply unknown path', () => {
  assertThrows(() => { () =>
        resolveTemplates(
          { BAD: '{{services.executor.nonexistent}}' },
          context,
        ),
      ; }, 'Template variable not found: {{services.executor.nonexistent}}');
})
    Deno.test('app-manifest-template - resolveTemplates - throws on unknown top-level section', () => {
  assertThrows(() => { () =>
        resolveTemplates(
          { BAD: '{{databases.main.url}}' },
          context,
        ),
      ; }, 'Template variable not found: {{databases.main.url}}');
})  
  
    const manifest = {
      containers: { headless: {} },
      services: { executor: {} },
      workers: { 'browser-host': {}, api: {} },
      routes: [{ name: 'browser-api' }, { name: 'api' }],
      resources: { 'mcp-auth-secret': {}, db: {} },
    };

    Deno.test('app-manifest-template - validateTemplateReferences - returns no errors for valid references', () => {
  const errors = validateTemplateReferences(
        {
          API_URL: '{{routes.api.url}}',
          EXECUTOR_IP: '{{services.executor.ipv4}}',
          BROWSER_URL: '{{workers.browser-host.url}}',
          SECRET: '{{resources.mcp-auth-secret.id}}',
        },
        manifest,
      );
      assertEquals(errors, []);
})
    Deno.test('app-manifest-template - validateTemplateReferences - reports unknown route reference', () => {
  const errors = validateTemplateReferences(
        { URL: '{{routes.missing.url}}' },
        manifest,
      );
      assertEquals(errors, ['URL: route "missing" not found']);
})
    Deno.test('app-manifest-template - validateTemplateReferences - reports unknown container reference', () => {
  const errors = validateTemplateReferences(
        { IP: '{{containers.missing.ipv4}}' },
        manifest,
      );
      assertEquals(errors, ['IP: container "missing" not found']);
})
    Deno.test('app-manifest-template - validateTemplateReferences - reports unknown worker reference', () => {
  const errors = validateTemplateReferences(
        { URL: '{{workers.missing.url}}' },
        manifest,
      );
      assertEquals(errors, ['URL: worker "missing" not found']);
})
    Deno.test('app-manifest-template - validateTemplateReferences - reports unknown resource reference', () => {
  const errors = validateTemplateReferences(
        { ID: '{{resources.missing.id}}' },
        manifest,
      );
      assertEquals(errors, ['ID: resource "missing" not found']);
})
    Deno.test('app-manifest-template - validateTemplateReferences - reports unknown section', () => {
  const errors = validateTemplateReferences(
        { BAD: '{{databases.main.url}}' },
        manifest,
      );
      assertEquals(errors, ['BAD: unknown section "databases"']);
})
    Deno.test('app-manifest-template - validateTemplateReferences - reports invalid short path', () => {
  const errors = validateTemplateReferences(
        { BAD: '{{routes}}' },
        manifest,
      );
      assertEquals(errors, ['BAD: invalid template path "routes"']);
})
    Deno.test('app-manifest-template - validateTemplateReferences - reports unknown service reference', () => {
  const errors = validateTemplateReferences(
        { IP: '{{services.missing.ipv4}}' },
        manifest,
      );
      assertEquals(errors, ['IP: service "missing" not found']);
})
    Deno.test('app-manifest-template - validateTemplateReferences - collects multiple errors', () => {
  const errors = validateTemplateReferences(
        {
          A: '{{routes.nope.url}}',
          B: '{{services.nope.port}}',
        },
        manifest,
      );
      assertEquals(errors.length, 2);
      assertStringIncludes(errors[0], 'route "nope" not found');
      assertStringIncludes(errors[1], 'service "nope" not found');
})  