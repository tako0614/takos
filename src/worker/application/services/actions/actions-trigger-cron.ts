function parseCronNumber(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function cronFieldMatches(
  field: string,
  min: number,
  max: number,
  value: number,
): boolean {
  for (const rawPart of field.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;

    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : parseCronNumber(stepPart);
    if (!step || step <= 0) return false;

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [startRaw, endRaw] = rangePart.split("-", 2);
      const parsedStart = parseCronNumber(startRaw);
      const parsedEnd = parseCronNumber(endRaw);
      if (parsedStart === null || parsedEnd === null) return false;
      start = parsedStart;
      end = parsedEnd;
    } else {
      const single = parseCronNumber(rangePart);
      if (single === null) return false;
      start = single;
      end = single;
    }

    if (start < min || end > max || start > end) return false;
    if (value >= start && value <= end && (value - start) % step === 0) {
      return true;
    }
  }
  return false;
}

export function cronMatches(cron: string, now: Date): boolean | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const utcDay = now.getUTCDay();
  const dayOfMonthMatches = cronFieldMatches(
    dayOfMonth,
    1,
    31,
    now.getUTCDate(),
  );
  const dayOfWeekMatches = cronFieldMatches(dayOfWeek, 0, 7, utcDay) ||
    (utcDay === 0 && cronFieldMatches(dayOfWeek, 0, 7, 7));
  const dayMatches = dayOfMonth !== "*" && dayOfWeek !== "*"
    ? dayOfMonthMatches || dayOfWeekMatches
    : dayOfMonthMatches && dayOfWeekMatches;
  return cronFieldMatches(minute, 0, 59, now.getUTCMinutes()) &&
    cronFieldMatches(hour, 0, 23, now.getUTCHours()) &&
    cronFieldMatches(month, 1, 12, now.getUTCMonth() + 1) &&
    dayMatches;
}

export function startOfUtcMinute(now: Date): Date {
  const minute = new Date(now);
  minute.setUTCSeconds(0, 0);
  return minute;
}

export function cronMatchesWithinWindow(
  cron: string,
  now: Date,
  windowMinutes: number,
): string[] | null {
  const matchedMinutes: string[] = [];
  const windowSize = Math.max(1, Math.min(Math.floor(windowMinutes), 24 * 60));
  const cursor = startOfUtcMinute(now);

  for (let offset = windowSize - 1; offset >= 0; offset--) {
    const candidate = new Date(cursor.getTime() - offset * 60_000);
    const matches = cronMatches(cron, candidate);
    if (matches === null) return null;
    if (matches) matchedMinutes.push(candidate.toISOString());
  }

  return matchedMinutes;
}
