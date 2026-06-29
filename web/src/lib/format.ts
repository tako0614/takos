import { currentLocale } from "./locale.ts";

function relativeFormatter(): Intl.RelativeTimeFormat {
  return new Intl.RelativeTimeFormat(currentLocale(), { numeric: "auto" });
}

function formatDaysAgo(diffDays: number, date: Date): string {
  const formatter = relativeFormatter();
  if (diffDays < 7) return formatter.format(-diffDays, "day");
  if (diffDays < 30) {
    return formatter.format(-Math.floor(diffDays / 7), "week");
  }
  if (diffDays < 365) {
    return formatter.format(-Math.floor(diffDays / 30), "month");
  }
  return date.toLocaleDateString(currentLocale());
}

export function formatDetailedRelativeDate(dateString: string): string {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) {
    return currentLocale().startsWith("ja") ? "たった今" : "Just now";
  }
  const formatter = relativeFormatter();
  if (diffMins < 60) return formatter.format(-diffMins, "minute");
  if (diffHours < 24) return formatter.format(-diffHours, "hour");
  return formatDaysAgo(days, new Date(dateString));
}

export function formatShortDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString(currentLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(dateString: string | undefined): string {
  if (!dateString) return "";
  return new Date(dateString).toLocaleDateString(currentLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return String(num);
}

export function truncateByCodepoint(text: string, max: number): string {
  const codepoints = Array.from(text);
  if (codepoints.length <= max) return text;
  return codepoints.slice(0, max).join("") + "...";
}

const DECIMAL_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const BINARY_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

type SizeUnit = (typeof DECIMAL_UNITS)[number] | (typeof BINARY_UNITS)[number];

export interface FormatFileSizeOptions {
  /** Use IEC binary-unit labels (KiB/MiB) instead of KB/MB. Default false. */
  binary?: boolean;
  /** Fraction digits for scaled units. Default 1. */
  digits?: number;
  /** Strip trailing zeros from the scaled value (e.g. "1.5 MB" not "1.50 MB"). Default false. */
  trimZeros?: boolean;
  /** Largest unit to scale to. Default "MB" (values above stay expressed in MB). */
  maxUnit?: SizeUnit;
}

export function formatFileSize(
  bytes: number,
  options: FormatFileSizeOptions = {},
): string {
  const { binary = false, digits = 1, trimZeros = false, maxUnit = "MB" } =
    options;
  const units = binary ? BINARY_UNITS : DECIMAL_UNITS;
  const cap = Math.max(0, units.indexOf(maxUnit as never));
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < cap) {
    value /= 1024;
    unit += 1;
  }
  const fixed = value.toFixed(digits);
  const text = trimZeros ? String(parseFloat(fixed)) : fixed;
  return `${text} ${units[unit]}`;
}
