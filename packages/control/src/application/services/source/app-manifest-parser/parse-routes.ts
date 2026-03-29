import type {
  AppContainer,
  AppService,
  AppWorker,
  AppRoute,
} from '../app-manifest-types';
import { asRecord, asString, asRequiredString, asStringArray } from '../app-manifest-utils';

// ============================================================
// Routes parser
// ============================================================

export function parseRoutes(
  specRecord: Record<string, unknown>,
  workers: Record<string, AppWorker>,
  containers: Record<string, AppContainer>,
  services: Record<string, AppService> = {},
): AppRoute[] | undefined {
  const routesRaw = specRecord.routes;
  if (routesRaw == null) return undefined;
  if (!Array.isArray(routesRaw)) throw new Error('spec.routes must be an array');
  return routesRaw.map((entry, index) => {
    const route = asRecord(entry);
    const target = asRequiredString(route.target, `spec.routes[${index}].target`);
    const name = asRequiredString(route.name, `spec.routes[${index}].name`);
    const ingress = asString(route.ingress, `spec.routes[${index}].ingress`);

    if (!workers[target] && !containers[target] && !services[target]) {
      throw new Error(`spec.routes[${index}].target references unknown worker, container, or service: ${target}`);
    }
    if (ingress && !workers[ingress]) {
      throw new Error(`spec.routes[${index}].ingress must reference a worker`);
    }

    const routePath = asString(route.path, `spec.routes[${index}].path`);

    // Parse route method constraints
    const methods = asStringArray(route.methods, `spec.routes[${index}].methods`);
    if (methods) {
      for (const method of methods) {
        if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
          throw new Error(`spec.routes[${index}].methods contains invalid method: ${method}`);
        }
      }
    }

    return {
      name,
      target,
      ...(routePath ? { path: routePath } : {}),
      ...(methods ? { methods } : {}),
      ...(ingress ? { ingress } : {}),
      ...(route.timeoutMs != null ? { timeoutMs: Number(route.timeoutMs) } : {}),
    };
  });
}
