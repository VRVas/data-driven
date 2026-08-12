/** Human-friendly relative time, e.g. "3 hours ago", "in 2 days". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = t - now; // negative = past
  const abs = Math.abs(diff);
  const MIN = 60_000, HR = 60 * MIN, DAY = 24 * HR;

  if (abs < MIN) return "just now";
  const plural = (n: number, u: string) => `${n} ${u}${n === 1 ? "" : "s"}`;
  let text: string;
  if (abs < HR) text = plural(Math.round(abs / MIN), "min");
  else if (abs < DAY) text = plural(Math.round(abs / HR), "hour");
  else if (abs < 30 * DAY) text = plural(Math.round(abs / DAY), "day");
  else return new Date(iso).toISOString().slice(0, 10);

  return diff < 0 ? `${text} ago` : `in ${text}`;
}

/**
 * Whole days from local "today" to a YYYY-MM-DD date.
 * Negative = overdue, 0 = today, positive = upcoming.
 */
export function daysUntil(dateYmd: string, now: Date = new Date()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateYmd);
  if (!m) return Number.NaN;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}

const MS_PER_MONTH = 30.44 * 86_400_000;

/**
 * Months between two dates, or null when that cannot be answered honestly.
 *
 * A backwards span is rejected rather than returned negative: the sheet has a
 * lead that closes eleven months before it opens, and feeding that through the
 * tempo formula clamps to a *perfect* score. A typo should not look like the
 * fastest deal we ever ran.
 */
export function monthsBetween(fromYmd: string | null, toYmd: string | null): number | null {
  if (!fromYmd || !toYmd) return null;
  const from = Date.parse(fromYmd);
  const to = Date.parse(toYmd);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  return (to - from) / MS_PER_MONTH;
}
