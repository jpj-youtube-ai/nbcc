import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Event tickets on the daily task (src/scripts/send-reminders.ts): a tickets email that did not go
// when the payment landed is sent again (each order claimed, once a run), and buyers' phone numbers
// are deleted 90 days after their event. Each part stands alone: one failing never stops the other.

const send = vi.hoisted(() => ({ resendUnsentTicketEmails: vi.fn(), deleteBuyerPhonesPastTheirTime: vi.fn() }));
vi.mock("../../src/tickets/send", () => send);

import { runTicketDailyPass } from "../../src/tickets/runner";

beforeEach(() => {
  vi.clearAllMocks();
  send.resendUnsentTicketEmails.mockResolvedValue({ tried: 2, sent: 1 });
  send.deleteBuyerPhonesPastTheirTime.mockResolvedValue(3);
});

describe("the daily ticket pass", () => {
  it("sends the tickets emails that never went, and deletes old phone numbers", async () => {
    expect(await runTicketDailyPass()).toEqual({ emailsTried: 2, emailsSent: 1, phonesDeleted: 3, failed: 0 });
  });

  it("still deletes phone numbers when the emails fail, and says one part failed", async () => {
    send.resendUnsentTicketEmails.mockRejectedValue(new Error("mail down"));
    expect(await runTicketDailyPass()).toEqual({ emailsTried: 0, emailsSent: 0, phonesDeleted: 3, failed: 1 });
  });

  it("is run by the daily task, in a try of its own", () => {
    const script = readFileSync(resolve(__dirname, "../../src/scripts/send-reminders.ts"), "utf8");
    expect(script).toContain('await import("../tickets/runner")');
    expect(script).toContain("event tickets daily pass failed:");
  });
});
