export const CLIENT_OPERATION_ID_PATTERN = /^[a-f0-9]{32}$/;

export function createClientOperationId(
  cryptoApi: Pick<Crypto, "getRandomValues"> = globalThis.crypto,
): string {
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
