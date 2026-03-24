export class CliCommandExit extends Error {
  readonly code: number;

  constructor(code: number) {
    super(`CLI command requested exit with code ${code}`);
    this.name = 'CliCommandExit';
    this.code = code;
  }
}

export function cliExit(code: number): never {
  throw new CliCommandExit(code);
}

export function isCliCommandExit(error: unknown): error is CliCommandExit {
  return error instanceof CliCommandExit;
}
