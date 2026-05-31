import { deleteEnv, envObject, getEnv, setEnv } from "@takos/worker-platform-utils/runtime-env";
import type { ContainerBackend } from "./container-backend.ts";
import {
  createDefaultOciOrchestratorBackendResolver,
  startLocalOciOrchestratorServer,
} from "./oci-orchestrator.ts";

async function resolveBackend(): Promise<ContainerBackend> {
  const backendEnv = (getEnv("OCI_BACKEND") ?? "docker").trim()
    .toLowerCase();

  switch (backendEnv) {
    case "k8s":
    case "kubernetes": {
      const { K8sContainerBackend } = await import(
        "./k8s-container-backend.ts"
      );
      return new K8sContainerBackend();
    }

    case "docker":
    default: {
      const { DockerContainerBackend } = await import(
        "./docker-container-backend.ts"
      );
      return new DockerContainerBackend();
    }
  }
}

const fallbackBackend = await resolveBackend();
await startLocalOciOrchestratorServer({
  backendResolver: createDefaultOciOrchestratorBackendResolver({
    fallbackBackend,
  }),
});
