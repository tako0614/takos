import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

export type AwsSecretsStoreConfig = {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

function createClient(config: AwsSecretsStoreConfig): SecretsManagerClient {
  return new SecretsManagerClient({
    region: config.region,
    ...(config.accessKeyId && config.secretAccessKey
      ? {
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        }
      : {}),
  });
}

export function createAwsSecretsStore(config: AwsSecretsStoreConfig) {
  const client = createClient(config);

  return {
    async ensureSecret(name: string, value: string): Promise<string> {
      try {
        await client.send(new CreateSecretCommand({
          Name: name,
          SecretString: value,
        }));
        return name;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/already exists/i.test(message) && !(error as { name?: string })?.name?.includes('ResourceExists')) {
          throw error;
        }
      }

      await client.send(new PutSecretValueCommand({
        SecretId: name,
        SecretString: value,
      }));
      return name;
    },

    async getSecretValue(name: string): Promise<string> {
      const result = await client.send(new GetSecretValueCommand({
        SecretId: name,
      }));
      if (typeof result.SecretString === 'string') {
        return result.SecretString;
      }
      if (result.SecretBinary) {
        return Buffer.from(result.SecretBinary as Uint8Array).toString('utf-8');
      }
      throw new Error(`AWS Secrets Manager secret "${name}" does not contain a readable value`);
    },

    async deleteSecret(name: string): Promise<void> {
      try {
        await client.send(new DeleteSecretCommand({
          SecretId: name,
          ForceDeleteWithoutRecovery: true,
        }));
      } catch (error) {
        if (error instanceof ResourceNotFoundException) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        if (/not found/i.test(message)) {
          return;
        }
        throw error;
      }
    },
  };
}
