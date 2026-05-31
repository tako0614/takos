export type UnsupportedOperationCapability = "dump";

export class UnsupportedOperationError extends Error {
  constructor(
    public readonly capability: UnsupportedOperationCapability,
    message: string,
  ) {
    super(message);
    this.name = "UnsupportedOperationError";
  }
}
