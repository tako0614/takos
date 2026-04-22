/**
 * CLI output and argument-parsing helpers: print, fail, takeFlag, takeOption, parsePositiveInt.
 */

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

export function print(message: string, isJson: boolean): void {
  if (!isJson) {
    console.log(message);
  }
}

export function fail(message: string): never {
  throw new Error(message);
}

// ---------------------------------------------------------------------------
// Argument parsing helpers
// ---------------------------------------------------------------------------

export function takeFlag(args: string[], flag: string): boolean {
  const index = args.indexOf(flag);
  if (index === -1) {
    return false;
  }
  args.splice(index, 1);
  return true;
}

export function takeOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  const next = args[index + 1];
  if (!next || next.startsWith("--")) {
    fail(`Option ${flag} requires a value.`);
  }

  args.splice(index, 2);
  return next;
}

export function parsePositiveInt(
  raw: string | undefined,
  optionName: string,
  defaultValue: number,
  maxValue: number,
): number {
  if (!raw) {
    return defaultValue;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    fail(`${optionName} must be a positive integer.`);
  }

  return Math.min(value, maxValue);
}
