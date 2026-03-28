export interface TemplateContext {
  routes: Record<string, { url: string; domain: string; path: string }>;
  containers: Record<string, { ipv4?: string; port: number }>;
  workers: Record<string, { url: string }>;
  resources: Record<string, { id: string }>;
}

/**
 * Resolve all template strings in an inject map against the given context.
 * Template syntax: `{{section.name.field}}` e.g. `{{routes.api.url}}`
 */
export function resolveTemplates(
  inject: Record<string, string>,
  context: TemplateContext,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, template] of Object.entries(inject)) {
    resolved[key] = resolveTemplate(template, context);
  }
  return resolved;
}

function resolveTemplate(template: string, context: TemplateContext): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const value = resolvePath(path.trim(), context);
    if (value === undefined) {
      throw new Error(`Template variable not found: ${match}`);
    }
    return String(value);
  });
}

function resolvePath(path: string, context: TemplateContext): string | undefined {
  const parts = path.split('.');
  // routes.browser-api.url   -> context.routes['browser-api'].url
  // containers.executor.ipv4 -> context.containers['executor'].ipv4
  // workers.browser-host.url -> context.workers['browser-host'].url
  // resources.mcp-auth-secret.id -> context.resources['mcp-auth-secret'].id
  let current: unknown = context;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current != null ? String(current) : undefined;
}

/**
 * Validate that all template references in an inject map refer to known
 * sections and names in the manifest. Returns an array of error messages
 * (empty if everything is valid).
 */
export function validateTemplateReferences(
  inject: Record<string, string>,
  manifest: {
    containers?: Record<string, unknown>;
    workers?: Record<string, unknown>;
    routes?: Array<{ name: string }>;
    resources?: Record<string, unknown>;
  },
): string[] {
  const errors: string[] = [];
  for (const [key, template] of Object.entries(inject)) {
    const refs = [...template.matchAll(/\{\{([^}]+)\}\}/g)];
    for (const [, path] of refs) {
      const parts = path.trim().split('.');
      if (parts.length < 2) {
        errors.push(`${key}: invalid template path "${path}"`);
        continue;
      }
      const [section, name] = parts;
      if (section === 'routes') {
        if (!manifest.routes?.some((r) => r.name === name)) {
          errors.push(`${key}: route "${name}" not found`);
        }
      } else if (section === 'containers') {
        if (!manifest.containers?.[name]) {
          errors.push(`${key}: container "${name}" not found`);
        }
      } else if (section === 'workers') {
        if (!manifest.workers?.[name]) {
          errors.push(`${key}: worker "${name}" not found`);
        }
      } else if (section === 'resources') {
        if (!manifest.resources?.[name]) {
          errors.push(`${key}: resource "${name}" not found`);
        }
      } else {
        errors.push(`${key}: unknown section "${section}"`);
      }
    }
  }
  return errors;
}
