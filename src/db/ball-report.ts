import { pool } from "./pool";
import { insertAudit, recordAudit } from "./donations";
import { getCapacityState } from "./ball";
import { availability } from "../ball/capacity";
import { countAwaitingTransfers, countSales, recipientsSchema, type Recipient, type SalesInputs } from "../ball/sales-report";

// TASK-464: the Festive Ball ticket report's settings, its numbers, and the record of what went out.
// The decisions (is it due, what does it say) are in the pure src/ball/sales-report.ts; this file
// only reads and writes. Every change staff make writes its audit_log row in the same transaction.

export interface ReportSend {
  sentOn: string;
  recipients: string[];
  sentAt: string;
  sentBy: string;
}

export interface ReportSettings {
  reportOn: boolean;
  recipients: Recipient[];
  lastScheduled: ReportSend | null;
  lastTest: ReportSend | null;
  /** TASK-471: a scheduled report that could not be sent, since the last one that went. */
  lastFailure: { sentOn: string; at: string } | null;
}

interface SendRow {
  kind: string;
  sent_on: string;
  recipients: string[];
  sent_at: Date;
  sent_by: string;
}

const toSend = (r: SendRow): ReportSend => ({
  sentOn: r.sent_on,
  recipients: r.recipients,
  sentAt: r.sent_at.toISOString(),
  sentBy: r.sent_by,
});

export async function getReportSettings(): Promise<ReportSettings> {
  const s = await pool.query<{ report_on: boolean; report_recipients: unknown }>(
    "SELECT report_on, report_recipients FROM ball_settings WHERE id = 1",
  );
  const row = s.rows[0];
  // Re-read through the same rules it was saved by, so the list is always tidy and in order.
  const recipients = recipientsSchema.safeParse(row?.report_recipients ?? []);
  const sends = await pool.query<SendRow>(
    `SELECT DISTINCT ON (kind) kind, to_char(sent_on, 'YYYY-MM-DD') AS sent_on, recipients, sent_at, sent_by
       FROM ball_report_sends WHERE status = 'sent' ORDER BY kind, sent_at DESC`,
  );
  const last = (kind: string) => {
    const r = sends.rows.find((x) => x.kind === kind);
    return r ? toSend(r) : null;
  };
  const failed = await pool.query<{ sent_on: string | null; created_at: Date }>(
    `SELECT data->>'sentOn' AS sent_on, created_at FROM audit_log
      WHERE action = 'ball_report.send_failed' ORDER BY id DESC LIMIT 1`,
  );
  const lastScheduled = last("scheduled");
  const f = failed.rows[0];
  // A failure counts until a scheduled report goes after it.
  const lastFailure =
    f && f.sent_on && (!lastScheduled || f.created_at.getTime() > new Date(lastScheduled.sentAt).getTime())
      ? { sentOn: f.sent_on, at: f.created_at.toISOString() }
      : null;
  return {
    reportOn: Boolean(row?.report_on),
    recipients: recipients.success ? recipients.data : [],
    lastScheduled,
    lastTest: last("test"),
    lastFailure,
  };
}

/**
 * TASK-471: a scheduled report that could not be sent. The day only: the error itself goes to the
 * server log, since it can quote an address.
 */
export async function recordSendFailure(sentOn: string): Promise<void> {
  await recordAudit({
    actor: "system:schedule",
    action: "ball_report.send_failed",
    entity: "ball_report",
    entityId: null,
    data: { sentOn },
  });
}

/** Saves the switch and the list together, with an audit row saying what changed. */
export async function saveReportSettings(
  next: { reportOn: boolean; recipients: Recipient[] },
  actor: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query<{ report_on: boolean; report_recipients: Recipient[] }>(
      "SELECT report_on, report_recipients FROM ball_settings WHERE id = 1 FOR UPDATE",
    );
    await client.query("UPDATE ball_settings SET report_on = $1, report_recipients = $2::jsonb WHERE id = 1", [
      next.reportOn,
      JSON.stringify(next.recipients),
    ]);
    const was = before.rows[0]?.report_recipients ?? [];
    const wasEmails = new Set(was.map((r) => r.email));
    const nowEmails = new Set(next.recipients.map((r) => r.email));
    await insertAudit(client, {
      actor,
      action: "ball_report.settings_saved",
      entity: "ball_report",
      entityId: null,
      data: {
        reportOn: next.reportOn,
        wasOn: Boolean(before.rows[0]?.report_on),
        recipients: next.recipients.length,
        // Who the report newly goes to, and who it stopped going to: the numbers leave the charity,
        // so a record of who was added, and by whom, is the point of this row.
        added: [...nowEmails].filter((e) => !wasEmails.has(e)),
        removed: [...wasEmails].filter((e) => !nowEmails.has(e)),
      },
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Everything the report counts, as at `now`. `since` is the moment the last scheduled report
 * counted to, or null before the first. The counting rules (sold means paid, which sale falls in
 * which window) are the pure countSales, so they are tested without a database.
 */
export async function readSalesInputs(now: Date, since: Date | null): Promise<SalesInputs> {
  const bookings = await pool.query<{
    kind: string;
    status: string;
    quantity: number;
    seats: number;
    paid_at: Date | null;
    payment_method: string;
  }>("SELECT kind, status, quantity, seats, paid_at, payment_method FROM ball_bookings");
  // Still waiting: anyone already offered a released place is being looked after.
  const waiting = await pool.query<{ people: string; seats: string }>(
    `SELECT count(*) AS people, COALESCE(sum(seats_wanted), 0) AS seats
       FROM ball_waiting_list WHERE offered_at IS NULL`,
  );
  const state = await getCapacityState();
  const left = availability(state);
  const rows = bookings.rows.map((b) => ({
    kind: b.kind,
    status: b.status,
    quantity: Number(b.quantity),
    seats: Number(b.seats),
    paidAt: b.paid_at,
    paymentMethod: b.payment_method,
  }));
  const sold = countSales(rows, { now, since });
  return {
    totalSeats: left.totalSeats,
    ...sold,
    seatsRemaining: left.seatsRemaining,
    tablesRemaining: left.tablesRemaining,
    heldSeats: state.heldSeats,
    waitingList: Number(waiting.rows[0]?.people ?? 0),
    waitingSeats: Number(waiting.rows[0]?.seats ?? 0),
    ...countAwaitingTransfers(rows),
  };
}

/** The moment the last scheduled report counted its numbers to, or null before the first. */
export async function lastCountedTo(): Promise<Date | null> {
  const r = await pool.query<{ at: Date | null }>(
    "SELECT max(counted_to) AS at FROM ball_report_sends WHERE kind = 'scheduled' AND status = 'sent'",
  );
  return r.rows[0]?.at ?? null;
}

/** Whether today's scheduled report has gone, or is going. */
export async function scheduledSendExists(sentOn: string): Promise<boolean> {
  const r = await pool.query("SELECT 1 FROM ball_report_sends WHERE kind = 'scheduled' AND sent_on = $1", [sentOn]);
  return (r.rowCount ?? 0) > 0;
}

/**
 * Claims today for the scheduled report. The unique index means only one claim per day can exist,
 * so a second run of the daily job gets null and sends nothing.
 */
export async function claimScheduledSend(sentOn: string, by: string): Promise<number | null> {
  const r = await pool.query<{ id: number }>(
    `INSERT INTO ball_report_sends (sent_on, kind, sent_by) VALUES ($1, 'scheduled', $2)
     ON CONFLICT DO NOTHING RETURNING id`,
    [sentOn, by],
  );
  return r.rows[0]?.id ?? null;
}

/** Records the report as gone: to whom, the numbers it carried, and the moment they were counted to. */
export async function markSendSent(
  id: number,
  recipients: string[],
  figures: SalesInputs,
  countedTo: Date,
): Promise<void> {
  await pool.query(
    `UPDATE ball_report_sends
        SET status = 'sent', recipients = $2, figures = $3::jsonb, counted_to = $4, sent_at = now()
      WHERE id = $1`,
    [id, recipients, JSON.stringify(figures), countedTo],
  );
}

/** A failed send gives the day back, so the report is not marked as gone when it never went. */
export async function releaseClaim(id: number): Promise<void> {
  await pool.query("DELETE FROM ball_report_sends WHERE id = $1 AND status = 'claimed'", [id]);
}

/** A test send: recorded apart from the schedule, so it never counts as "the last update". */
export async function recordTestSend(
  sentOn: string,
  recipient: string,
  figures: SalesInputs,
  actor: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO ball_report_sends (sent_on, kind, status, recipients, figures, sent_by)
       VALUES ($1, 'test', 'sent', $2, $3::jsonb, $4)`,
      [sentOn, [recipient], JSON.stringify(figures), actor],
    );
    await insertAudit(client, {
      actor,
      action: "ball_report.test_sent",
      entity: "ball_report",
      entityId: null,
      data: { to: recipient },
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
