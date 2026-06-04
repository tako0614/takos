import { env } from "node:process";

type IntOptions = {
  min?: number;
  max?: number;
};

function clampInt(
  value: number,
  fallback: number,
  options: IntOptions,
): number {
  if (!Number.isFinite(value)) return fallback;
  if (options.min !== undefined && value < options.min) return fallback;
  if (options.max !== undefined && value > options.max) return fallback;
  return value;
}

export function parseIntValue(
  _name: string,
  value: string | undefined,
  fallback: number,
  options: IntOptions = {},
): number {
  if (value === undefined || value.trim() === "") return fallback;
  return clampInt(Number.parseInt(value, 10), fallback, options);
}

export function parseIntEnv(
  name: string,
  fallback: number,
  options: IntOptions = {},
): number {
  return parseIntValue(name, env[name], fallback, options);
}
