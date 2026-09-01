export type McpPortableOperation = "export" | "import";

export interface McpOperationCoordinatorState {
  portableOperation: McpPortableOperation | null;
  activeMutations: number;
}

export interface McpOperationCoordinator {
  acquireMutation(): (() => void) | null;
  acquirePortable(operation: McpPortableOperation): (() => void) | null;
}

export function createMcpOperationCoordinator(
  onStateChange: (state: McpOperationCoordinatorState) => void,
): McpOperationCoordinator {
  let portableOperation: McpPortableOperation | null = null;
  let activeMutations = 0;

  const emit = () => {
    onStateChange({ portableOperation, activeMutations });
  };

  const releaseOnce = (release: () => void) => {
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      release();
      emit();
    };
  };

  const acquireMutation = (): (() => void) | null => {
    if (portableOperation !== null) return null;
    activeMutations += 1;
    emit();
    return releaseOnce(() => {
      activeMutations -= 1;
    });
  };

  const acquirePortable = (
    operation: McpPortableOperation,
  ): (() => void) | null => {
    if (portableOperation !== null || activeMutations > 0) return null;
    portableOperation = operation;
    emit();
    return releaseOnce(() => {
      portableOperation = null;
    });
  };

  emit();
  return { acquireMutation, acquirePortable };
}
