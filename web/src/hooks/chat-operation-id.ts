import {
  CLIENT_OPERATION_ID_PATTERN,
  createClientOperationId,
} from "../lib/client-operation-id.ts";

export const CHAT_OPERATION_ID_PATTERN = CLIENT_OPERATION_ID_PATTERN;
export const createChatOperationId = createClientOperationId;

export function chatRunIdForOperation(operationId: string): string {
  if (!CHAT_OPERATION_ID_PATTERN.test(operationId)) {
    throw new TypeError("Invalid Chat operation id");
  }
  return `run_request_${operationId}`;
}

export function isSameChatDraft(
  left: { input: string; files: readonly File[] },
  right: { input: string; files: readonly File[] },
): boolean {
  return left.input === right.input && left.files.length === right.files.length &&
    left.files.every((file, index) => {
      const other = right.files[index];
      return file === other ||
        (file.name === other.name && file.size === other.size &&
          file.type === other.type && file.lastModified === other.lastModified);
    });
}

export function shouldRetryChatRun(status: string): boolean {
  return status === "failed" || status === "cancelled";
}

export function isActiveChatRun(status: string): boolean {
  return status === "pending" || status === "queued" || status === "running";
}
