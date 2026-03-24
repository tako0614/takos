export async function withTimeout<T>(
  promiseOrFactory: Promise<T> | ((signal?: AbortSignal) => Promise<T>),
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  const abortController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      abortController.abort();
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  try {
    const actualPromise = typeof promiseOrFactory === 'function'
      ? promiseOrFactory(abortController.signal)
      : promiseOrFactory;

    return await Promise.race([actualPromise, timeoutPromise]);
  } catch (error) {
    if (!abortController.signal.aborted) {
      abortController.abort();
    }
    throw error;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
