type RuntimeProcess = {
  env?: Record<string, string | undefined>;
  cwd?: () => string;
  argv?: string[];
  pid?: number;
  exit?: (code?: number) => never;
};

function runtimeProcess(): RuntimeProcess | undefined {
  return (globalThis as typeof globalThis & { process?: RuntimeProcess })
    .process;
}

export function getEnv(name: string): string | undefined {
  return runtimeProcess()?.env?.[name];
}

export function setEnv(name: string, value: string): void {
  const env = runtimeProcess()?.env;
  if (env) env[name] = value;
}

export function deleteEnv(name: string): void {
  const env = runtimeProcess()?.env;
  if (env) delete env[name];
}

export function envObject(): Record<string, string> {
  const env = runtimeProcess()?.env ?? {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

export function currentWorkingDirectory(): string {
  return runtimeProcess()?.cwd?.() ?? ".";
}

export function processArgs(): string[] {
  return runtimeProcess()?.argv?.slice(2) ?? [];
}

export function processId(): number {
  return runtimeProcess()?.pid ?? 0;
}

export function exitProcess(code = 0): never {
  const exit = runtimeProcess()?.exit;
  if (exit) return exit(code);
  throw new Error(`process.exit(${code}) requested outside a process runtime`);
}
