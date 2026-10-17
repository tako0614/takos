export type NativeContainerFixtureRun = {
  runId: string;
  containerId: string;
  newContainerId: string;
  serviceId: string;
  ownerId: string;
  workspaceId: string;
  threadId: string;
};

export function createNativeContainerWorkerFixture(options: {
  root: string;
  run: NativeContainerFixtureRun;
  controllerToken: string;
  observerNonce: string;
  diagnosticContainerTransport?: boolean;
  actualStaleWindow?: boolean;
}): string;
