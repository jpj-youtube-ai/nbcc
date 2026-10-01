import { describe, it, expect, vi } from "vitest";
import { runTransferReminderPass } from "../../src/ball/transfer-reminders";

// TASK-485: the daily pass that reminds a bank transfer buyer two days before their pay-by date.
// It runs in the 8am job (src/scripts/send-reminders.ts). Invented bookings.

const booking = (over: Record<string, unknown> = {}) => ({
  id: 1, reference: "BALL-7KQ2MZ", kind: "table" as const, quantity: 1, seats: 10, buyerName: "Ada Test",
  buyerEmail: "ada@example.com", ticketsPence: 100_000, donationPence: 0, totalPence: 100_000, giftAid: false,
  payBy: "2026-10-08", createdDay: "2026-10-01", remindedAt: null, ...over,
});

describe("the daily transfer reminder pass", () => {
  it("reminds only the bookings due today, and marks each one sent", async () => {
    const send = vi.fn(async () => {});
    const markSent = vi.fn(async () => {});
    const result = await runTransferReminderPass({
      list: async () => [booking(), booking({ id: 2, reference: "BALL-2PQRST", payBy: "2026-10-20" })],
      send,
      markSent,
      today: "2026-10-06",
    });
    expect(result).toEqual({ considered: 2, sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(markSent).toHaveBeenCalledWith(1);
  });

  // A failed send is not marked, so tomorrow's run tries again; one failure does not stop the rest.
  it("does not mark a failed send, and carries on", async () => {
    const markSent = vi.fn(async () => {});
    const send = vi.fn(async (b: { id: number }) => {
      if (b.id === 1) throw new Error("mail relay down");
    });
    const result = await runTransferReminderPass({
      list: async () => [booking(), booking({ id: 2, reference: "BALL-2PQRST" })],
      send,
      markSent,
      today: "2026-10-06",
    });
    expect(result).toEqual({ considered: 2, sent: 1, failed: 1 });
    expect(markSent).toHaveBeenCalledTimes(1);
    expect(markSent).toHaveBeenCalledWith(2);
  });

  it("sends nothing once the date has passed: an overdue booking is for staff", async () => {
    const send = vi.fn(async () => {});
    await runTransferReminderPass({ list: async () => [booking()], send, markSent: vi.fn(), today: "2026-10-09" });
    expect(send).not.toHaveBeenCalled();
  });
});
