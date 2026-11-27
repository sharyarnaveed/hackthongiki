/** Fake network latency for the mock API. */
export function sleep(min = 200, max = 600): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise((r) => setTimeout(r, ms));
}

/** Throw occasionally so error states can be exercised. Off by default. */
export function maybeFail(rate = 0, message = "Mock request failed") {
  if (rate > 0 && Math.random() < rate) throw new Error(message);
}

/** Deep clone so callers can never mutate the mock "database". */
export function clone<T>(v: T): T {
  return structuredClone(v);
}

let seq = 0;
export function uid(prefix = "id"): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq}`;
}

export const iso = (daysAgo = 0, hours = 0, minutes = 0) => {
  const d = new Date("2026-11-27T10:00:00Z");
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(d.getUTCHours() - hours, d.getUTCMinutes() - minutes);
  return d.toISOString();
};
