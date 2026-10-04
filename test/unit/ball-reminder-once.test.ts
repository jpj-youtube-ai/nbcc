import { describe, it, expect, vi, beforeEach } from "vitest";

// Jaimie, 2026-10-04: the automatic "A week to go" reminder moved from 3 days before the Ball to 7.
// Moving the day must never send anyone the reminder twice, and the staff "Send the reminder" button
// must still work. Both ways of sending it share ONE stamp, ball_bookings.reminder_sent_at: each
// writes it after a send, and neither sends to a booking that has it. The database is mocked; the
// SQL, and what comes back from it, is what is checked here. Every name and address is invented.

const q = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: q.query, connect: vi.fn() } }));

import { listBookingsForRunUp, listBookingsNeedingReminder, markReminderSent, markRunUpSent } from "../../src/db/ball";
import { planRunUp, runRunUpPass, stageFor, type RunUpBooking } from "../../src/ball/run-up";

const EVENT = new Date("2026-11-07T19:00:00Z");
const row = (over: Record<string, unknown> = {}) => ({
  id: 1, reference: "BALL-EXAMPL", buyer_email: "alex@example.com", buyer_name: "Alex Example", buyer_first_name: "Alex", seats: 2,
  guest_token: "tok", table_name: null, guest_chase_sent_at: null, guest_final_call_sent_at: null, reminder_sent_at: null,
  guests_named: 2, ...over,
});
const sqlOf = (n = 0) => String(q.query.mock.calls[n][0]).replace(/\s+/g, " ");

beforeEach(() => {
  q.query.mockReset();
  q.query.mockResolvedValue({ rowCount: 0, rows: [] });
});

describe("one stamp for both ways of sending the reminder", () => {
  it("the automatic send and the staff button write the same column", async () => {
    await markRunUpSent(7, "practical");
    await markReminderSent(7);
    expect(sqlOf(0)).toBe("UPDATE ball_bookings SET reminder_sent_at = now() WHERE id = $1");
    expect(sqlOf(1)).toBe("UPDATE ball_bookings SET reminder_sent_at = now() WHERE id = $1");
  });

  it("the daily pass is told whether each booking has had it", async () => {
    q.query.mockResolvedValue({ rows: [row({ reminder_sent_at: "2026-10-20T09:00:00Z" }), row({ id: 2 })] });
    const bookings = await listBookingsForRunUp();
    expect(sqlOf()).toContain("b.reminder_sent_at");
    expect(sqlOf()).toContain("WHERE b.status = 'paid' AND b.buyer_email <> ''");
    expect(bookings[0]).toMatchObject({ reminderSentAt: "2026-10-20T09:00:00Z" });
    expect(bookings[1]).toMatchObject({ reminderSentAt: null });
  });
});

describe("nobody gets the reminder twice", () => {
  const had = (over: Partial<RunUpBooking> = {}): RunUpBooking => ({
    id: 1, reference: "BALL-EXAMPL", buyerEmail: "alex@example.com", buyerName: "Alex Example", buyerFirstName: "Alex", tableName: null,
    guestToken: "tok", seats: 2, guestsNamed: 2, guestChaseSentAt: null, guestFinalCallSentAt: null, reminderSentAt: "2026-10-20T09:00:00Z",
    ...over,
  });
  const days = ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];

  // Sent early with the staff button, sent by the old 3 days rule, or sent by the new one: all the same stamp.
  it("a booking that has had it is never due it again, on any day, whenever it was sent", () => {
    for (const reminderSentAt of ["2026-10-20T09:00:00Z", "2026-10-31T08:00:05Z", "2026-11-04T08:00:00Z"]) {
      for (const day of days) {
        const stage = stageFor(had({ reminderSentAt }), { now: new Date(`${day}T08:00:00Z`), eventDate: EVENT, lockAt: null });
        expect(stage, `${reminderSentAt} on ${day}`).toBeNull();
      }
    }
  });

  it("a pass each morning for the whole run-up sends it once", async () => {
    const booking = had({ reminderSentAt: null });
    const sent: string[] = [];
    for (const day of ["2026-10-29", ...days]) {
      await runRunUpPass({
        listBookings: async () => [booking],
        send: async () => {
          sent.push(day);
        },
        // As the database does: the stamp is written after the send.
        markSent: async () => {
          booking.reminderSentAt = `${day}T08:00:01Z`;
        },
        window: { now: new Date(`${day}T08:00:00Z`), eventDate: EVENT, lockAt: null },
      });
    }
    expect(sent).toEqual(["2026-10-31"]);
  });

  it("running the pass twice on the same morning sends it once", async () => {
    const booking = had({ reminderSentAt: null });
    let sends = 0;
    const pass = () =>
      runRunUpPass({
        listBookings: async () => [booking],
        send: async () => {
          sends += 1;
        },
        markSent: async () => {
          booking.reminderSentAt = "2026-10-31T08:00:01Z";
        },
        window: { now: new Date("2026-10-31T08:00:00Z"), eventDate: EVENT, lockAt: null },
      });
    await pass();
    await pass();
    expect(sends).toBe(1);
  });

  it("the old day, three days before, sends nothing new to anyone who had it on the new day", () => {
    const all = [had({ id: 1, reminderSentAt: "2026-10-31T08:00:01Z" }), had({ id: 2, reminderSentAt: "2026-10-31T08:00:02Z" })];
    expect(planRunUp(all, { now: new Date("2026-11-04T19:30:00Z"), eventDate: EVENT, lockAt: null })).toEqual([]);
    expect(planRunUp(all, { now: new Date("2026-11-05T08:00:00Z"), eventDate: EVENT, lockAt: null })).toEqual([]);
  });
});

describe("the staff Send the reminder button", () => {
  it("still finds every paid booking that has not had it, whenever it was booked", async () => {
    q.query
      .mockResolvedValueOnce({ rows: [row({ id: 5 })] })
      .mockResolvedValueOnce({ rows: [{ full_name: "Alex Example", dietary: null, access_needs: null, menu_choice: null }] });
    const targets = await listBookingsNeedingReminder();
    // No date in it at all: staff can send it early, late, or to someone who booked in the last week.
    expect(sqlOf()).toContain("WHERE status = 'paid' AND reminder_sent_at IS NULL AND buyer_email <> ''");
    expect(sqlOf()).not.toMatch(/paid_at|interval|now\(\)/);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ id: 5, reference: "BALL-EXAMPL", buyerEmail: "alex@example.com" });
  });

  it("never finds a booking the automatic send has already reached", async () => {
    await listBookingsNeedingReminder();
    expect(sqlOf()).toContain("reminder_sent_at IS NULL");
  });
});
