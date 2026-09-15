/** Time helpers. All persisted timestamps are UTC ISO-8601 strings. */

export type IsoTimestamp = string;

export function nowIso(): IsoTimestamp {
  return new Date().toISOString();
}

export function isoDaysAgo(days: number): IsoTimestamp {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function isoHoursFromNow(hours: number): IsoTimestamp {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

/** "3h ago", "2d ago" — for dense dashboard panels where absolute times waste space. */
export function relativeFromNow(timestamp: IsoTimestamp, now: Date = new Date()): string {
  const deltaMs = now.getTime() - new Date(timestamp).getTime();
  const future = deltaMs < 0;
  const abs = Math.abs(deltaMs);

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  let text: string;
  if (abs < minute) text = "just now";
  else if (abs < hour) text = `${Math.floor(abs / minute)}m`;
  else if (abs < day) text = `${Math.floor(abs / hour)}h`;
  else text = `${Math.floor(abs / day)}d`;

  if (text === "just now") return text;
  return future ? `in ${text}` : `${text} ago`;
}
