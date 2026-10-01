import { describe, it, expect, vi } from "vitest";
import { runTransferReminderPass } from "../../src/ball/transfer-reminders";

// TASK-485: the daily pass that reminds a bank transfer buyer two days before their pay-by date.
// It runs in the 8am job (src/scripts/send-reminders.ts). Invented bookings.

const booking = (over: Record<string, unknown> = {}) => ({
  id: 1, reference: "BALL-7KQ2MZ", kind: "table" as const, quantity: 1, seats: 10, buyerName: "Ada Test",
  buyerEmail: "ada@example.com", ticketsPence: 100_000, donationPence: 0, totalPence: 100_000, giftAid: false,
  payBy: "2026-10-08", createdDay: "2026-10-01", remindedAt: null, ...over,
});

const quietly = () => vi.spyOn(console, "error").mockImplementation(() => {});

describe("the daily transfer reminder pass", () => {
  it("claims and reminds only the bookings due today", async () => {
    const send = vi.fn(async () => {});
    const claim = vi.fn(async () => true);
    const release = vi.fn(async () => {});
    const result = await runTransferReminderPass({
      list: async () => [booking(), booking({ id: 2, reference: "BALL-2PQRST", payBy: "2026-10-20" })],
      send,
      claim,
      release,
      today: "2026-10-06",
    });
    expect(result).toEqual({ considered: 2, sent: 1, failed: 0 });
    expect(claim).toHaveBeenCalledWith(1);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expect(claim.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
  });

  // Two runs at once (a manual run during the 8am one): whoever claims first sends; the other skips.
  it("sends nothing for a booking another run has already claimed", async () => {
    const send = vi.fn(async () => {});
    const result = await runTransferReminderPass({
      list: async () => [booking()],
      send,
      claim: async () => false,
      release: vi.fn(),
      today: "2026-10-06",
    });
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ considered: 1, sent: 0, failed: 0 });
  });

  // A failed send gives its claim back, so the next morning's run tries again; one failure never
  // stops the rest.
  it("releases a failed send, and carries on", async () => {
    const spy = quietly();
    const release = vi.fn(async () => {});
    const send = vi.fn(async (b: { id: number }) => {
      if (b.id === 1) throw new Error("mail relay down");
    });
    const result = await runTransferReminderPass({
      list: async () => [booking(), booking({ id: 2, reference: "BALL-2PQRST" })],
      send,
      claim: async () => true,
      release,
      today: "2026-10-06",
    });
    expect(result).toEqual({ considered: 2, sent: 1, failed: 1 });
    expect(release).toHaveBeenCalledWith(1);
    expect(release).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  // A database blip must not stop that morning's other reminders.
  it("carries on when a claim fails", async () => {
    const spy = quietly();
    const send = vi.fn(async () => {});
    const result = await runTransferReminderPass({
      list: async () => [booking(), booking({ id: 2, reference: "BALL-2PQRST" })],
      send,
      claim: vi.fn(async (id: number) => {
        if (id === 1) throw new Error("database blip");
        return true;
      }),
      release: vi.fn(),
      today: "2026-10-06",
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ considered: 2, sent: 1, failed: 1 });
    spy.mockRestore();
  });

  it("sends nothing once the date has passed: an overdue booking is for staff", async () => {
    const send = vi.fn(async () => {});
    await runTransferReminderPass({ list: async () => [booking()], send, claim: async () => true, release: vi.fn(), today: "2026-10-09" });
    expect(send).not.toHaveBeenCalled();
  });
});
