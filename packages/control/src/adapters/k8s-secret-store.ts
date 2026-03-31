import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { Buffer } from "node:buffer";

export type K8sSecretStoreConfig = {
  apiServer?: string;
  namespace?: string;
  bearerToken?: string;
  caFilePath?: string;
};

type K8sApiConfig = {
  apiServer: string;
  namespace: string;
  bearerToken: string;
  ca?: string;
};

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return (await readFile(filePath, 'utf-8')).trim();
  } catch {
    return null;
  }
}

async function resolveApiConfig(config: K8sSecretStoreConfig): Promise<K8sApiConfig> {
  const apiServer = config.apiServer
    ?? (Deno.env.get('K8S_API_SERVER')?.trim() || '')
    ?? '';
  const bearerToken = config.bearerToken
    ?? (Deno.env.get('K8S_BEARER_TOKEN')?.trim() || '')
    ?? '';
  const namespace = config.namespace
    ?? (Deno.env.get('K8S_NAMESPACE')?.trim() || '')
    ?? '';
  const caFilePath = config.caFilePath
    ?? Deno.env.get('K8S_CA_CERT_FILE')?.trim()
    ?? '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';

  const serviceHost = Deno.env.get('KUBERNETES_SERVICE_HOST')?.trim();
  const servicePort = Deno.env.get('KUBERNETES_SERVICE_PORT_HTTPS')?.trim() || '443';
  const resolvedApiServer = apiServer || (serviceHost ? `https://${serviceHost}:${servicePort}` : '');
  const resolvedToken = bearerToken || await readTextIfExists('/var/run/secrets/kubernetes.io/serviceaccount/token') || '';
  const resolvedNamespace = namespace || await readTextIfExists('/var/run/secrets/kubernetes.io/serviceaccount/namespace') || '';
  const ca = await readTextIfExists(caFilePath);

  if (!resolvedApiServer) {
    throw new Error('k8s secret requires K8S_API_SERVER or in-cluster Kubernetes service env');
  }
  if (!resolvedToken) {
    throw new Error('k8s secret requires K8S_BEARER_TOKEN or in-cluster service account token');
  }
  if (!resolvedNamespace) {
    throw new Error('k8s secret requires K8S_NAMESPACE or in-cluster service account namespace');
  }

  return {
    apiServer: resolvedApiServer.replace(/\/$/, ''),
    namespace: resolvedNamespace,
    bearerToken: resolvedToken,
    ...(ca ? { ca } : {}),
  };
}

function bufferBody(body?: unknown): Buffer | undefined {
  if (body === undefined) return undefined;
  return Buffer.from(JSON.stringify(body), 'utf-8');
}

async function requestJson<T>(
  config: K8sApiConfig,
  method: string,
  requestPath: string,
  body?: unknown,
  allowNotFound = false,
): Promise<T | null> {
  const url = new URL(requestPath, config.apiServer);
  const payload = bufferBody(body);
  const transport = url.protocol === 'http:' ? http : https;

  const responseText = await new Promise<string>((resolve, reject) => {
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        'Authorization': `Bearer ${config.bearerToken}`,
        'Accept': 'application/json',
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': String(payload.length),
        } : {}),
      },
      ...(url.protocol === 'https:' && config.ca ? { ca: config.ca } : {}),
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        const statusCode = response.statusCode ?? 500;
        if (allowNotFound && statusCode === 404) {
          resolve('__TAKOS_NOT_FOUND__');
          return;
        }
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`Kubernetes API request failed (${statusCode}): ${text || response.statusMessage || ''}`));
          return;
        }
        resolve(text);
      });
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });

  if (responseText === '__TAKOS_NOT_FOUND__') {
    return null;
  }
  if (!responseText) {
    return null;
  }
  return JSON.parse(responseText) as T;
}

function encodeSecretData(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64');
}

function decodeSecretData(value: string): string {
  return Buffer.from(value, 'base64').toString('utf-8');
}

export function createK8sSecretStore(config: K8sSecretStoreConfig = {}) {
  let apiConfigPromise: Promise<K8sApiConfig> | null = null;

  async function getApiConfig(): Promise<K8sApiConfig> {
    if (!apiConfigPromise) {
      apiConfigPromise = resolveApiConfig(config);
    }
    return apiConfigPromise;
  }

  return {
    async ensureSecret(name: string, value: string): Promise<string> {
      const apiConfig = await getApiConfig();
      const requestPath = `/api/v1/namespaces/${encodeURIComponent(apiConfig.namespace)}/secrets/${encodeURIComponent(name)}`;
      const existing = await requestJson<{ metadata?: { resourceVersion?: string } }>(
        apiConfig,
        'GET',
        requestPath,
        undefined,
        true,
      );

      const payload = {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: {
          name,
          ...(existing?.metadata?.resourceVersion ? { resourceVersion: existing.metadata.resourceVersion } : {}),
        },
        type: 'Opaque',
        data: {
          value: encodeSecretData(value),
        },
      };

      if (!existing) {
        await requestJson(
          apiConfig,
          'POST',
          `/api/v1/namespaces/${encodeURIComponent(apiConfig.namespace)}/secrets`,
          payload,
        );
      } else {
        await requestJson(apiConfig, 'PUT', requestPath, payload);
      }

      return name;
    },

    async getSecretValue(name: string): Promise<string> {
      const apiConfig = await getApiConfig();
      const result = await requestJson<{ data?: Record<string, string> }>(
        apiConfig,
        'GET',
        `/api/v1/namespaces/${encodeURIComponent(apiConfig.namespace)}/secrets/${encodeURIComponent(name)}`,
      );
      const encoded = result?.data?.value;
      if (!encoded) {
        throw new Error(`Kubernetes secret "${name}" does not contain key "value"`);
      }
      return decodeSecretData(encoded);
    },

    async deleteSecret(name: string): Promise<void> {
      const apiConfig = await getApiConfig();
      await requestJson(
        apiConfig,
        'DELETE',
        `/api/v1/namespaces/${encodeURIComponent(apiConfig.namespace)}/secrets/${encodeURIComponent(name)}`,
        undefined,
        true,
      );
    },
  };
}
