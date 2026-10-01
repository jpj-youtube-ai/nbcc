// TASK-479: analytics numbers are kept for 13 months. This is the first day that is still kept.

/** The date 13 months before `today` (YYYY-MM-DD), clamped to the end of a shorter month. */
export function retentionCutoff(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  let year = y;
  let month = m - 13; // 1-based
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
