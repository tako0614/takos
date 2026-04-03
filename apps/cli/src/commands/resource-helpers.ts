import { red } from "@std/fmt/colors";
import { cliExit } from "../lib/command-exit.ts";
import { api } from "../lib/api.ts";

type AsyncAction<TArgs extends unknown[]> = (...args: TArgs) => Promise<void>;
export type ApiRequestOptions = {
  method?: string;
  body?: FormData | Record<string, unknown>;
  headers?: Record<string, string>;
  timeout?: number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export function printJsonOrLog(data: unknown, json?: boolean): void {
  if (json) {
    printJson(data);
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

export async function requestApiOrThrow<T>(
  path: string,
  options?: ApiRequestOptions,
): Promise<T> {
  const result = await api<T>(path, options);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

export function fail(message: string): never {
  console.log(red(message));
  cliExit(1);
}

export function withCommandError<TArgs extends unknown[]>(
  message: string,
  action: AsyncAction<TArgs>,
): AsyncAction<TArgs> {
  return async (...args: TArgs): Promise<void> => {
    try {
      await action(...args);
    } catch (error) {
      fail(`${message}: ${errorMessage(error)}`);
    }
  };
}
