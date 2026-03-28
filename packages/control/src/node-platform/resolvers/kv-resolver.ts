/**
 * KV resolver — selects DynamoDB/Firestore/persistent/in-memory.
 */
import path from 'node:path';
import { optionalEnv } from './env-helpers.ts';
import {
  createInMemoryKVNamespace,
} from '../../local-platform/in-memory-bindings.ts';
import {
  createPersistentKVNamespace,
} from '../../local-platform/persistent-bindings.ts';

export async function resolveKvStore(dataDir: string | null) {
  // AWS DynamoDB
  const dynamoTable = optionalEnv('AWS_DYNAMO_KV_TABLE') ?? optionalEnv('AWS_DYNAMO_HOSTNAME_ROUTING_TABLE');
  if (dynamoTable) {
    const { createDynamoKvStore } = await import('../../adapters/dynamo-kv-store.ts');
    return createDynamoKvStore({
      region: optionalEnv('AWS_REGION') ?? 'us-east-1',
      tableName: dynamoTable,
      accessKeyId: optionalEnv('AWS_ACCESS_KEY_ID'),
      secretAccessKey: optionalEnv('AWS_SECRET_ACCESS_KEY'),
    });
  }

  // GCP Firestore
  const firestoreCollection = optionalEnv('GCP_FIRESTORE_KV_COLLECTION');
  if (firestoreCollection) {
    const { createFirestoreKvStore } = await import('../../adapters/firestore-kv-store.ts');
    return createFirestoreKvStore({
      projectId: optionalEnv('GCP_PROJECT_ID'),
      keyFilePath: optionalEnv('GOOGLE_APPLICATION_CREDENTIALS'),
      collectionName: firestoreCollection,
    });
  }

  if (dataDir) return createPersistentKVNamespace(path.join(dataDir, 'kv', 'hostname-routing.json'));
  return createInMemoryKVNamespace();
}
