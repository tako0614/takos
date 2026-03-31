import { execFile } from 'node:child_process';

export type CommandRunnerOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
};

export type CommandRunnerResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandRunnerOptions,
) => Promise<CommandRunnerResult>;

export const execCommand: CommandRunner = (
  command,
  args,
  options,
) => new Promise((resolve) => {
  const proc = execFile(command, args, {
    cwd: options?.cwd,
    env: { ...process.env, ...options?.env },
    maxBuffer: 10 * 1024 * 1024,
  }, (error, stdout, stderr) => {
    const errorCode = error ? (error as { code?: number | string }).code : undefined;
    resolve({
      stdout: String(stdout || ''),
      stderr: String(stderr || ''),
      exitCode: typeof errorCode === 'number' ? errorCode : 1,
    });
  });

  if (options?.stdin && proc.stdin) {
    proc.stdin.write(options.stdin);
    proc.stdin.end();
  }
});
