/**
 * Group Deploy — template resolution helpers.
 */
import type { GroupDeployOptions, GroupDeployResult, TemplateContext } from './deploy-models.ts';

export function buildTemplateContext(
  result: GroupDeployResult,
  manifest: GroupDeployOptions['manifest'],
  options: GroupDeployOptions,
): TemplateContext {
  const routes: Record<string, { url: string; domain: string; path: string }> = {};
  const baseDomain = options.baseDomain || `${manifest.metadata.name}.app.example.com`;
  for (const route of manifest.spec.routes || []) {
    const routeName = route.name;
    if (!routeName) continue;
    const domain = baseDomain;
    const routePath = route.path || '/';
    routes[routeName] = {
      url: `https://${domain}${routePath}`,
      domain,
      path: routePath,
    };
  }

  const containers: Record<string, { port?: number }> = {};
  for (const svc of result.services) {
    if (svc.type === 'container') {
      containers[svc.name] = {};
    }
  }

  const services: Record<string, { ipv4?: string; port?: number }> = {};
  for (const svc of result.services) {
    if (svc.type === 'service') {
      services[svc.name] = { ipv4: svc.url };
    }
  }

  const workers: Record<string, { url?: string }> = {};
  for (const svc of result.services) {
    if (svc.type === 'worker') {
      workers[svc.name] = { url: svc.url };
    }
  }

  const resources: Record<string, { id?: string }> = {};
  for (const res of result.resources) {
    resources[res.name] = { id: res.id };
  }

  return { routes, containers, services, workers, resources };
}

export function resolveTemplateString(template: string, context: TemplateContext): string {
  return template.replace(/\$\{\{\s*([\w.]+)\s*\}\}/g, (_match, expr: string) => {
    const parts = expr.split('.');
    let current: unknown = context;
    for (const part of parts) {
      if (current == null || typeof current !== 'object' || Array.isArray(current)) return _match;
      current = (current as Readonly<Record<string, unknown>>)[part];
    }
    return current != null ? String(current) : _match;
  });
}