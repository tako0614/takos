export const CLIENT_OPERATION_ID_PATTERN = /^[a-f0-9]{32}$/;

export class ClientOperationConflictError extends Error {
  constructor(message = "Idempotency key already used by another request") {
    super(message);
    this.name = "ClientOperationConflictError";
  }
}

export function isClientOperationId(value: string): boolean {
  return CLIENT_OPERATION_ID_PATTERN.test(value);
}

export function clientOperationRowId(
  kind: "workspace" | "thread" | "message" | "run",
  operationId: string,
): string {
  if (!isClientOperationId(operationId)) {
    throw new TypeError("Invalid client operation id");
  }
  const prefix = kind === "workspace" ? "workspace" : kind === "thread"
    ? "thread"
    : kind === "message"
    ? "msg"
    : "run";
  return `${prefix}_request_${operationId}`;
}

export async function deriveClientOperationId(
  namespace: string,
  ...parts: string[]
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([namespace, ...parts])),
  );
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
