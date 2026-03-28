import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import type { KVNamespace } from '../../shared/types/bindings.ts';

export type DynamoKvStoreConfig = {
  region: string;
  tableName: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export function createDynamoKvStore(config: DynamoKvStoreConfig): KVNamespace {
  let client: DynamoDBClient | undefined;

  function getClient(): DynamoDBClient {
    if (!client) {
      client = new DynamoDBClient({
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
    return client;
  }

  function nowEpoch(): number {
    return Math.floor(Date.now() / 1000);
  }

  function isExpired(expirationValue: string | undefined): boolean {
    if (expirationValue === undefined) return false;
    const exp = Number(expirationValue);
    return exp > 0 && exp <= nowEpoch();
  }

  return {
    async get(
      key: string,
      type?: 'text' | 'json' | 'arrayBuffer' | 'stream',
    ): Promise<string | null> {
      const command = new GetItemCommand({
        TableName: config.tableName,
        Key: { pk: { S: key } },
      });
      const result = await getClient().send(command);
      const item = result.Item;
      if (!item || !item.value?.S) return null;

      if (isExpired(item.expiration?.N)) return null;

      const raw = item.value.S;

      // Return type is declared as `string | null` to match the default
      // KVNamespace.get() overload.  When `type` is 'json', 'arrayBuffer',
      // or 'stream' the actual runtime value differs — this mirrors the
      // overloaded behaviour of the Cloudflare KVNamespace interface.
      switch (type) {
        case 'json':
          return JSON.parse(raw) as string;
        case 'arrayBuffer': {
          const encoder = new TextEncoder();
          return encoder.encode(raw).buffer as unknown as string;
        }
        case 'stream': {
          const encoder = new TextEncoder();
          const bytes = encoder.encode(raw);
          return new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }) as unknown as string;
        }
        case 'text':
        default:
          return raw;
      }
    },

    async getWithMetadata(
      key: string,
      type?: 'text' | 'json' | 'arrayBuffer' | 'stream',
    ): Promise<{ value: unknown; metadata: Record<string, string> | null; cacheStatus: null }> {
      const command = new GetItemCommand({
        TableName: config.tableName,
        Key: { pk: { S: key } },
      });
      const result = await getClient().send(command);
      const item = result.Item;

      if (!item || !item.value?.S || isExpired(item.expiration?.N)) {
        return { value: null, metadata: null, cacheStatus: null };
      }

      const raw = item.value.S;
      let value: unknown;

      switch (type) {
        case 'json':
          value = JSON.parse(raw);
          break;
        case 'arrayBuffer': {
          const encoder = new TextEncoder();
          value = encoder.encode(raw).buffer;
          break;
        }
        case 'stream': {
          const encoder = new TextEncoder();
          const bytes = encoder.encode(raw);
          value = new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          });
          break;
        }
        case 'text':
        default:
          value = raw;
          break;
      }

      const metadata: Record<string, string> | null = item.metadata?.S
        ? (JSON.parse(item.metadata.S) as Record<string, string>)
        : null;

      return { value, metadata, cacheStatus: null };
    },

    async put(
      key: string,
      value: string | ArrayBuffer | ReadableStream,
      options?: {
        expirationTtl?: number;
        expiration?: number;
        metadata?: Record<string, string>;
      },
    ): Promise<void> {
      let serialized: string;

      if (typeof value === 'string') {
        serialized = value;
      } else if (value instanceof ArrayBuffer) {
        const decoder = new TextDecoder();
        serialized = decoder.decode(value);
      } else {
        // ReadableStream
        const reader = (value as ReadableStream).getReader();
        const chunks: Uint8Array[] = [];
        for (;;) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          chunks.push(chunk);
        }
        const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        const decoder = new TextDecoder();
        serialized = decoder.decode(combined);
      }

      const item: Record<string, { S?: string; N?: string }> = {
        pk: { S: key },
        value: { S: serialized },
      };

      if (options?.metadata) {
        item.metadata = { S: JSON.stringify(options.metadata) };
      }

      if (options?.expiration !== undefined) {
        item.expiration = { N: String(options.expiration) };
      } else if (options?.expirationTtl !== undefined) {
        item.expiration = { N: String(nowEpoch() + options.expirationTtl) };
      }

      const command = new PutItemCommand({
        TableName: config.tableName,
        Item: item as Record<string, import('@aws-sdk/client-dynamodb').AttributeValue>,
      });
      await getClient().send(command);
    },

    async delete(key: string): Promise<void> {
      const command = new DeleteItemCommand({
        TableName: config.tableName,
        Key: { pk: { S: key } },
      });
      await getClient().send(command);
    },

    async list(
      options?: { prefix?: string; limit?: number; cursor?: string },
    ): Promise<{
      keys: Array<{ name: string; expiration?: number; metadata?: Record<string, string> }>;
      list_complete: boolean;
      cursor?: string;
    }> {
      const limit = options?.limit ?? 1000;

      const expressionAttributeValues: Record<string, import('@aws-sdk/client-dynamodb').AttributeValue> = {};
      let filterExpression: string | undefined;

      if (options?.prefix) {
        filterExpression = 'begins_with(pk, :prefix)';
        expressionAttributeValues[':prefix'] = { S: options.prefix };
      }

      let exclusiveStartKey: Record<string, import('@aws-sdk/client-dynamodb').AttributeValue> | undefined;
      if (options?.cursor) {
        exclusiveStartKey = JSON.parse(
          Buffer.from(options.cursor, 'base64').toString('utf-8'),
        );
      }

      const command = new ScanCommand({
        TableName: config.tableName,
        Limit: limit,
        ...(filterExpression ? { FilterExpression: filterExpression } : {}),
        ...(Object.keys(expressionAttributeValues).length > 0
          ? { ExpressionAttributeValues: expressionAttributeValues }
          : {}),
        ...(exclusiveStartKey
          ? { ExclusiveStartKey: exclusiveStartKey }
          : {}),
      });

      const result = await getClient().send(command);
      const now = nowEpoch();

      const keys = (result.Items ?? [])
        .filter((item) => {
          if (!item.pk?.S) return false;
          const exp = item.expiration?.N ? Number(item.expiration.N) : 0;
          return exp === 0 || exp > now;
        })
        .map((item) => {
          const entry: { name: string; expiration?: number; metadata?: Record<string, string> } = {
            name: item.pk!.S!,
          };
          if (item.expiration?.N) {
            entry.expiration = Number(item.expiration.N);
          }
          if (item.metadata?.S) {
            entry.metadata = JSON.parse(item.metadata.S) as Record<string, string>;
          }
          return entry;
        });

      const listComplete = !result.LastEvaluatedKey;
      let cursor: string | undefined;
      if (result.LastEvaluatedKey) {
        cursor = Buffer.from(
          JSON.stringify(result.LastEvaluatedKey),
        ).toString('base64');
      }

      return {
        keys,
        list_complete: listComplete,
        ...(cursor ? { cursor } : {}),
      };
    },
  // Cast required: this object structurally implements the KVNamespace
  // interface, but TypeScript cannot verify compatibility with the
  // Cloudflare Workers type definitions without the runtime environment.
  } as unknown as KVNamespace;
}
