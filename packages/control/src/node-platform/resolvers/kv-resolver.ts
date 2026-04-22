/**
 * KV resolver — selects DynamoDB/Firestore/persistent/in-memory.
 */
import path from "node:path";
import { optionalEnv } from "./env-utils.ts";
import { createResolver } from "./resolver-factory.ts";
import {
  createInMemoryKVNamespace,
} from "../../local-platform/in-memory-bindings.ts";
import {
  createPersistentKVNamespace,
} from "../../local-platform/persistent-bindings.ts";

export const resolveKvStore = createResolver({
  cloudAdapters: [
    // AWS DynamoDB
    {
      async tryCreate() {
        const dynamoTable = optionalEnv("AWS_DYNAMO_KV_TABLE") ??
          optionalEnv("AWS_DYNAMO_HOSTNAME_ROUTING_TABLE");
        if (!dynamoTable) return null;
        const { createDynamoKvStore } = await import(
          "../../adapters/dynamo-kv-store.ts"
        );
        return createDynamoKvStore({
          region: optionalEnv("AWS_REGION") ?? "us-east-1",
          tableName: dynamoTable,
          accessKeyId: optionalEnv("AWS_ACCESS_KEY_ID"),
          secretAccessKey: optionalEnv("AWS_SECRET_ACCESS_KEY"),
        });
      },
    },
    // GCP Firestore
    {
      async tryCreate() {
        const firestoreCollection = optionalEnv("GCP_FIRESTORE_KV_COLLECTION");
        if (!firestoreCollection) return null;
        const { createFirestoreKvStore } = await import(
          "../../adapters/firestore-kv-store.ts"
        );
        return createFirestoreKvStore({
          projectId: optionalEnv("GCP_PROJECT_ID"),
          keyFilePath: optionalEnv("GOOGLE_APPLICATION_CREDENTIALS"),
          collectionName: firestoreCollection,
        });
      },
    },
  ],
  createPersistent: (dataDir) =>
    createPersistentKVNamespace(
      path.join(dataDir, "kv", "hostname-routing.json"),
    ),
  createInMemory: () => createInMemoryKVNamespace(),
});
