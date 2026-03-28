/**
 * Group Deploy -- Kubernetes provider.
 *
 * Implements ResourceProvider by applying Kubernetes manifests via kubectl.
 * Resources are provisioned as StatefulSets / Deployments (PostgreSQL, Redis,
 * MinIO) inside the target namespace.
 *
 * Requires: kubectl configured with a valid kubeconfig.
 */
import type { ResourceProvider, ProvisionResult } from '../resource-provider.js';
import { execCommand } from '../cloudflare-utils.js';

export class K8sProvider implements ResourceProvider {
  readonly name = 'k8s';

  private readonly namespace: string;

  constructor(opts?: { namespace?: string }) {
    this.namespace = opts?.namespace || process.env.K8S_NAMESPACE || 'default';
  }

  /** Apply a Kubernetes manifest provided as YAML string via stdin. */
  private async kubectlApply(yaml: string, resourceName: string, type: string): Promise<{ ok: boolean; stdout: string; error?: string }> {
    try {
      const { stdout, stderr, exitCode } = await execCommand(
        'kubectl', ['apply', '-f', '-', '-n', this.namespace],
        { stdin: yaml },
      );
      if (exitCode !== 0) {
        return { ok: false, stdout, error: stderr || `kubectl exited with code ${exitCode}` };
      }
      // kubectl apply reports "unchanged" when resource already exists
      const isUnchanged = stdout.includes('unchanged');
      return { ok: true, stdout, error: isUnchanged ? 'already exists' : undefined };
    } catch (error) {
      return { ok: false, stdout: '', error: `kubectl not available: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // ── PostgreSQL StatefulSet ───────────────────────────────────────────────

  async createDatabase(name: string, _opts?: { migrations?: string }): Promise<ProvisionResult> {
    const yaml = `
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: ${name}
  labels:
    app.kubernetes.io/name: ${name}
    app.kubernetes.io/component: database
spec:
  serviceName: ${name}
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ${name}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${name}
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_DB
              value: ${name}
            - name: POSTGRES_USER
              value: takos
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: ${name}-credentials
                  key: password
                  optional: true
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 1Gi
---
apiVersion: v1
kind: Service
metadata:
  name: ${name}
spec:
  selector:
    app.kubernetes.io/name: ${name}
  ports:
    - port: 5432
      targetPort: 5432
`.trim();

    const result = await this.kubectlApply(yaml, name, 'database');
    if (!result.ok) {
      return { name, type: 'database', status: 'failed', error: result.error };
    }
    if (result.error === 'already exists') {
      return { name, type: 'database', status: 'exists', id: `${this.namespace}/${name}` };
    }
    return { name, type: 'database', status: 'provisioned', id: `${this.namespace}/${name}` };
  }

  // ── MinIO Deployment (S3-compatible object storage) ──────────────────────

  async createObjectStorage(name: string): Promise<ProvisionResult> {
    const yaml = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  labels:
    app.kubernetes.io/name: ${name}
    app.kubernetes.io/component: object-storage
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ${name}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${name}
    spec:
      containers:
        - name: minio
          image: minio/minio:latest
          args: ["server", "/data", "--console-address", ":9001"]
          ports:
            - containerPort: 9000
            - containerPort: 9001
          volumeMounts:
            - name: data
              mountPath: /data
      volumes:
        - name: data
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: ${name}
spec:
  selector:
    app.kubernetes.io/name: ${name}
  ports:
    - name: api
      port: 9000
      targetPort: 9000
    - name: console
      port: 9001
      targetPort: 9001
`.trim();

    const result = await this.kubectlApply(yaml, name, 'object-storage');
    if (!result.ok) {
      return { name, type: 'object-storage', status: 'failed', error: result.error };
    }
    if (result.error === 'already exists') {
      return { name, type: 'object-storage', status: 'exists', id: `${this.namespace}/${name}` };
    }
    return { name, type: 'object-storage', status: 'provisioned', id: `${this.namespace}/${name}` };
  }

  // ── Redis Deployment (key-value store) ───────────────────────────────────

  async createKeyValueStore(name: string): Promise<ProvisionResult> {
    const yaml = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  labels:
    app.kubernetes.io/name: ${name}
    app.kubernetes.io/component: kv
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ${name}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${name}
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          ports:
            - containerPort: 6379
---
apiVersion: v1
kind: Service
metadata:
  name: ${name}
spec:
  selector:
    app.kubernetes.io/name: ${name}
  ports:
    - port: 6379
      targetPort: 6379
`.trim();

    const result = await this.kubectlApply(yaml, name, 'kv');
    if (!result.ok) {
      return { name, type: 'kv', status: 'failed', error: result.error };
    }
    if (result.error === 'already exists') {
      return { name, type: 'kv', status: 'exists', id: `${this.namespace}/${name}` };
    }
    return { name, type: 'kv', status: 'provisioned', id: `${this.namespace}/${name}` };
  }

  // ── Queue (Redis-based or RabbitMQ) ──────────────────────────────────────

  async createQueue(name: string, _opts?: { maxRetries?: number; deadLetterQueue?: string }): Promise<ProvisionResult> {
    const yaml = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  labels:
    app.kubernetes.io/name: ${name}
    app.kubernetes.io/component: queue
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: ${name}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${name}
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          ports:
            - containerPort: 6379
---
apiVersion: v1
kind: Service
metadata:
  name: ${name}
spec:
  selector:
    app.kubernetes.io/name: ${name}
  ports:
    - port: 6379
      targetPort: 6379
`.trim();

    const result = await this.kubectlApply(yaml, name, 'queue');
    if (!result.ok) {
      return { name, type: 'queue', status: 'failed', error: result.error };
    }
    if (result.error === 'already exists') {
      return { name, type: 'queue', status: 'exists', id: `${this.namespace}/${name}` };
    }
    return { name, type: 'queue', status: 'provisioned', id: `${this.namespace}/${name}` };
  }

  // ── Vector index -- not natively supported ──────────────────────────────

  async createVectorIndex(name: string, _opts: { dimensions: number; metric: string }): Promise<ProvisionResult> {
    return { name, type: 'vectorize', status: 'skipped', error: 'Vector index provisioning is not supported on K8s provider' };
  }

  // ── Kubernetes Secret ────────────────────────────────────────────────────

  async createSecret(name: string, _binding: string): Promise<ProvisionResult> {
    const { randomBytes } = await import('node:crypto');
    const secretValue = randomBytes(32).toString('hex');
    // Base64-encode for K8s Secret
    const b64Value = Buffer.from(secretValue).toString('base64');

    const yaml = `
apiVersion: v1
kind: Secret
metadata:
  name: ${name}
type: Opaque
data:
  value: ${b64Value}
`.trim();

    const result = await this.kubectlApply(yaml, name, 'secret');
    if (!result.ok) {
      return { name, type: 'secretRef', status: 'failed', error: result.error };
    }
    if (result.error === 'already exists') {
      return { name, type: 'secretRef', status: 'exists', id: '(existing)' };
    }
    return { name, type: 'secretRef', status: 'provisioned', id: secretValue };
  }

  // ── Auto-configured ──────────────────────────────────────────────────────

  skipAutoConfigured(name: string, type: string): ProvisionResult {
    return { name, type, status: 'skipped', error: `${type} is auto-configured at deploy time` };
  }
}
