export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(
  promiseOrFactory: Promise<T> | ((signal: AbortSignal) => Promise<T>),
  timeoutMs: number,
  errorMessage: string,
): Promise<T> {
  const abortController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const timeoutError = new TimeoutError(errorMessage);
      // Settle the public contract before aborting the underlying request.
      // Native fetch rejects immediately when its signal is aborted, so doing
      // this in the opposite order can leak a browser-specific AbortError
      // instead of the localized timeout message.
      reject(timeoutError);
      abortController.abort(timeoutError);
    }, timeoutMs);
  });

  try {
    const actualPromise = typeof promiseOrFactory === "function"
      ? promiseOrFactory(abortController.signal)
      : promiseOrFactory;
    return await Promise.race([actualPromise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
