/** Pure parts of the boards list (tested without a DOM). */

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "just now", "5 min ago", "2 h ago", "Yesterday", "3 days ago", then "Oct 12" (with the year when it is not this one) */
export function relTime(at: number, now: number): string {
  const d = now - at;
  if (d < MIN) return "just now";
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`;
  const a = new Date(at), n = new Date(now);
  const days = Math.round((Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY);
  if (days <= 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return `${MONTHS[a.getMonth()]} ${a.getDate()}${a.getFullYear() === n.getFullYear() ? "" : `, ${a.getFullYear()}`}`;
}

/** the search field only exists past this many boards */
export const SEARCH_AFTER = 8;

export function filterBoards<T extends { name: string }>(rows: readonly T[], q: string): T[] {
  const s = q.trim().toLowerCase();
  return s ? rows.filter((r) => r.name.toLowerCase().includes(s)) : [...rows];
}
