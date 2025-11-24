export function tryParseJson<T>(s: string | null | undefined): T | undefined {
  if (!s) return undefined;
  try {
    return JSON.parse(s) as T;
  } catch {
    return undefined;
  }
}

/** Serializes launch arguments ensuring an empty array is represented consistently. */
export function serializeArgs(args: string[] | undefined): string {
  return JSON.stringify(args ?? []);
}

/** Serializes optional JSON configs while preserving nullability semantics. */
export function serializeJson<T>(value: T | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}



