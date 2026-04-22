import type { GoogleAuth } from "google-auth-library";
import { Buffer } from "node:buffer";

export type GcpSecretStoreConfig = {
  projectId?: string;
  keyFilePath?: string;
};

type GoogleAccessToken = {
  token?: string | null;
};

function encodeSecretPayload(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64");
}

async function buildAuth(config: GcpSecretStoreConfig): Promise<GoogleAuth> {
  const { GoogleAuth } = await import("google-auth-library");
  return new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    ...(config.keyFilePath ? { keyFilename: config.keyFilePath } : {}),
    ...(config.projectId ? { projectId: config.projectId } : {}),
  });
}

async function requestJson<T>(
  auth: GoogleAuth,
  url: string,
  init?: RequestInit,
  allowNotFound = false,
): Promise<T | null> {
  const accessToken = await auth.getAccessToken() as
    | GoogleAccessToken
    | string
    | null;
  const token = typeof accessToken === "string"
    ? accessToken
    : accessToken?.token ?? null;
  if (!token) {
    throw new Error(
      "Unable to acquire Google Cloud access token for Secret Manager",
    );
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (allowNotFound && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Secret Manager request failed (${response.status}): ${
        text || response.statusText
      }`,
    );
  }

  if (response.status === 204) {
    return null;
  }

  return response.json() as Promise<T>;
}

export function createGcpSecretStore(config: GcpSecretStoreConfig) {
  let authPromise: Promise<GoogleAuth> | null = null;

  async function getAuth(): Promise<GoogleAuth> {
    if (!authPromise) {
      authPromise = buildAuth(config);
    }
    return authPromise;
  }

  async function getProjectId(): Promise<string> {
    if (config.projectId) {
      return config.projectId;
    }
    const auth = await getAuth();
    const projectId = await auth.getProjectId();
    if (!projectId) {
      throw new Error("Unable to resolve GCP project id for Secret Manager");
    }
    return projectId;
  }

  return {
    async ensureSecret(name: string, value: string): Promise<string> {
      const [auth, projectId] = await Promise.all([getAuth(), getProjectId()]);
      const baseUrl = `https://secretmanager.googleapis.com/v1/projects/${
        encodeURIComponent(projectId)
      }`;
      const secretPath = `${baseUrl}/secrets/${encodeURIComponent(name)}`;

      const existing = await requestJson<Record<string, unknown>>(
        auth,
        secretPath,
        undefined,
        true,
      );
      if (!existing) {
        await requestJson(
          auth,
          `${baseUrl}/secrets?secretId=${encodeURIComponent(name)}`,
          {
            method: "POST",
            body: JSON.stringify({
              replication: { automatic: {} },
            }),
          },
        );
      }

      await requestJson(
        auth,
        `${secretPath}:addVersion`,
        {
          method: "POST",
          body: JSON.stringify({
            payload: {
              data: encodeSecretPayload(value),
            },
          }),
        },
      );

      return name;
    },

    async getSecretValue(name: string): Promise<string> {
      const [auth, projectId] = await Promise.all([getAuth(), getProjectId()]);
      const response = await requestJson<{ payload?: { data?: string } }>(
        auth,
        `https://secretmanager.googleapis.com/v1/projects/${
          encodeURIComponent(projectId)
        }/secrets/${encodeURIComponent(name)}/versions/latest:access`,
      );
      const encoded = response?.payload?.data;
      if (!encoded) {
        throw new Error(
          `GCP Secret Manager secret "${name}" does not contain a readable value`,
        );
      }
      return Buffer.from(encoded, "base64").toString("utf-8");
    },

    async deleteSecret(name: string): Promise<void> {
      const [auth, projectId] = await Promise.all([getAuth(), getProjectId()]);
      await requestJson(
        auth,
        `https://secretmanager.googleapis.com/v1/projects/${
          encodeURIComponent(projectId)
        }/secrets/${encodeURIComponent(name)}`,
        { method: "DELETE" },
        true,
      );
    },
  };
}
