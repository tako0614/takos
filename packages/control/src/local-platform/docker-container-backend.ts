/**
 * DockerContainerBackend — ContainerBackend implementation using the Docker
 * Engine API via Unix socket.
 *
 * This is the original backend extracted from the monolithic OCI orchestrator.
 */

import http from 'node:http';
import type {
  ContainerBackend,
  ContainerCreateOpts,
  ContainerCreateResult,
} from './container-backend.ts';

const DOCKER_SOCKET = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';

// ─── Docker Engine API helpers ───

function dockerRequest(
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      socketPath: DOCKER_SOCKET,
      path: apiPath,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed: unknown = raw;
        try { parsed = JSON.parse(raw); } catch { /* raw text */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on('error', reject);
    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function dockerRequestStream(
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      socketPath: DOCKER_SOCKET,
      path: apiPath,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0 });
      });
    });
    req.on('error', reject);
    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// ─── Backend implementation ───

export class DockerContainerBackend implements ContainerBackend {
  async pullImage(imageRef: string): Promise<void> {
    const parts = imageRef.split(':');
    const tag = parts.length > 1 ? parts[parts.length - 1] : 'latest';
    const fromImage = parts.length > 1 ? parts.slice(0, -1).join(':') : imageRef;
    const result = await dockerRequestStream(
      'POST',
      `/images/create?fromImage=${encodeURIComponent(fromImage)}&tag=${encodeURIComponent(tag)}`,
    );
    if (result.status !== 200) {
      throw new Error(`Docker pull failed with status ${result.status}`);
    }
  }

  async createAndStart(opts: ContainerCreateOpts): Promise<ContainerCreateResult> {
    // Build env array from Record
    const envArray: string[] = [];
    if (opts.envVars) {
      for (const [k, v] of Object.entries(opts.envVars)) {
        envArray.push(`${k}=${v}`);
      }
    }

    // Build labels object
    const labels: Record<string, string> = {
      'takos.managed': 'true',
      ...opts.labels,
    };

    const createResult = await dockerRequest(
      'POST',
      `/containers/create?name=${encodeURIComponent(opts.name)}`,
      {
        Image: opts.imageRef,
        Env: envArray,
        ExposedPorts: { [`${opts.exposedPort}/tcp`]: {} },
        Labels: labels,
        HostConfig: {
          NetworkMode: opts.network ?? 'bridge',
        },
      },
    );
    if (createResult.status !== 201) {
      throw new Error(
        `Docker create failed with status ${createResult.status}: ${JSON.stringify(createResult.body)}`,
      );
    }
    const containerId = (createResult.body as { Id: string }).Id;

    const startResult = await dockerRequest('POST', `/containers/${containerId}/start`);
    if (startResult.status !== 204 && startResult.status !== 304) {
      throw new Error(`Docker start failed with status ${startResult.status}`);
    }

    return { containerId };
  }

  async stop(containerId: string): Promise<void> {
    const result = await dockerRequest('POST', `/containers/${containerId}/stop?t=10`);
    if (result.status !== 204 && result.status !== 304) {
      if (result.status === 404) return; // already gone
      throw new Error(`Docker stop failed with status ${result.status}`);
    }
  }

  async remove(containerId: string): Promise<void> {
    const result = await dockerRequest('DELETE', `/containers/${containerId}?force=true`);
    if (result.status !== 204 && result.status !== 404) {
      throw new Error(`Docker remove failed with status ${result.status}`);
    }
  }

  async getLogs(containerId: string, tail = 100): Promise<string> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        socketPath: DOCKER_SOCKET,
        path: `/containers/${containerId}/logs?stdout=1&stderr=1&tail=${tail}&timestamps=1`,
        method: 'GET',
      };
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          // Docker multiplexed stream: 8-byte header per frame
          const lines: string[] = [];
          let offset = 0;
          while (offset < raw.length) {
            if (offset + 8 > raw.length) break;
            const size = raw.readUInt32BE(offset + 4);
            offset += 8;
            if (offset + size > raw.length) break;
            lines.push(raw.subarray(offset, offset + size).toString('utf8'));
            offset += size;
          }
          resolve(lines.join(''));
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  async getContainerIp(containerId: string): Promise<string | null> {
    const result = await dockerRequest('GET', `/containers/${containerId}/json`);
    if (result.status !== 200) return null;
    const info = result.body as {
      NetworkSettings?: { Networks?: Record<string, { IPAddress?: string }> };
    };
    const networks = info?.NetworkSettings?.Networks;
    if (!networks) return null;
    for (const net of Object.values(networks)) {
      if (net.IPAddress) return net.IPAddress;
    }
    return null;
  }

  /**
   * Inspect a container by name (useful for deduplication before create).
   * Returns the container id if found, or null.
   */
  async inspectByName(name: string): Promise<string | null> {
    const result = await dockerRequest('GET', `/containers/${encodeURIComponent(name)}/json`);
    if (result.status === 200) {
      return (result.body as { Id: string }).Id;
    }
    return null;
  }
}
