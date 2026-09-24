// TASK-425: the two pure helpers behind the admin enquiry notice.
//
// contact_enquiries has stored replied_at and replied_by since it was built, and the admin has
// never displayed either. So "who dealt with this, and when" was already being recorded and then
// thrown away, which is the sort of thing you only notice when two people both reply to the same
// person. These format it for the status cell, and the waiting count that drives the notice bar.

export type RepliedFields = {
  status: string;
  replied_by: string | null;
  replied_at: string | Date | null;
};

/**
 * UK local time, deliberately. Everyone using this admin is in the UK, and formatting in UTC would
 * be an hour out for the whole of British Summer Time. Being quietly an hour wrong about when
 * somebody replied is worse than saying nothing.
 */
const UK_PARTS = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Europe/London",
});

// Our own month names rather than Intl's short-month output.
//
// Intl is used ONLY to move the instant into UK local time, which is the part that genuinely needs
// a timezone database. The month abbreviation is ours because Intl's differs between locales and
// ICU versions: en-GB renders September as "Sept", not "Sep", and that is a four-letter month in a
// list of three-letter ones. A test pinning the exact string would then pass on one Node version
// and fail on another, which this repo has already been bitten by once (see the donate.html
// line-ending budget failure). Deterministic output is worth three lines.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function format(when: Date): string {
  const parts = Object.fromEntries(
    UK_PARTS.formatToParts(when).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.hour}:${parts.minute}`;
}

/**
 * "by jaimie@nbcc.scot, 22 Sep 14:03", or null when there is nothing honest to say.
 *
 * Returns null rather than a partial string in every case where the answer would be a guess: an
 * unanswered enquiry, a missing timestamp, or a date that will not parse. An admin table showing
 * "Invalid Date" is worse than one showing nothing.
 */
export function repliedSummary(row: RepliedFields): string | null {
  if (row.status !== "replied") return null;
  if (!row.replied_at) return null;

  const when = row.replied_at instanceof Date ? row.replied_at : new Date(row.replied_at);
  if (Number.isNaN(when.getTime())) return null;

  const stamp = format(when);
  // Marked replied before replied_by existed, or by a path that did not record it. The WHEN is
  // still worth saying; omitting the whole line would make it look as though nobody ever replied.
  return row.replied_by ? `by ${row.replied_by}, ${stamp}` : stamp;
}

/**
 * "3 enquiries waiting for a reply", or null when there is nothing waiting.
 *
 * Null rather than "0 waiting" on purpose. A banner that is always present is furniture, and
 * people stop seeing furniture. This notice has to mean something every single time it appears.
 */
export function waitingLabel(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null;
  return count === 1 ? "1 enquiry waiting for a reply" : `${count} enquiries waiting for a reply`;
}
