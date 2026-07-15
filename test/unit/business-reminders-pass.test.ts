import { describe, it, expect, vi } from "vitest";
import { runReminderPass, type ReminderPassDeps } from "../../src/business/reminders";
import type { SupporterDueForReminder } from "../../src/db/fulfilment";
import type { BusinessSupporterReminderEmail } from "../../src/clients/email";

// TASK-222: the pure daily reminder orchestration (runReminderPass), tested stub-only (DB-free,
// config-free) like runBusinessInviteBackfill. The due-list is INJECTED, so this file proves the
// pass's behaviour given whatever the query returns: it builds + sends the STAGE-appropriate branded
// email, advances the reminder_count ONLY on a successful send, counts best-effort, and never aborts
// the run on one failure — and a second run over an empty due-list is a no-op. The "who is due (5-day
// at count 0, 14-day at count 1, nobody when captured / not invited / already at stage / too recent)"
// SQL is proven separately in test/unit/fulfilment-reminders-query.test.ts.

const BASE = "https://nbcc.test";
const FROM = "giving@nbcc.scot";

// Two due supporters: one owed the 5-day nudge (stage 1), one owed the 14-day last note (stage 2).
const dueRows: SupporterDueForReminder[] = [
  { fulfilmentId: 1, token: "tok-1", band: "gold", email: "a@biz.test", name: "Bean There", stage: 1 },
  { fulfilmentId: 2, token: "tok-2", band: "platinum", email: "b@biz.test", name: "Sam Sole", stage: 2 },
];

// Build deps with sensible defaults; each test overrides the seam it exercises. `sent` captures every
// message the pass tried to send (in order) for assertions.
function makeDeps(overrides: Partial<ReminderPassDeps> = {}): {
  deps: ReminderPassDeps;
  sent: BusinessSupporterReminderEmail[];
  markSent: ReturnType<typeof vi.fn>;
  sendReminder: ReturnType<typeof vi.fn>;
} {
  const sent: BusinessSupporterReminderEmail[] = [];
  const sendReminder = vi.fn(async (m: BusinessSupporterReminderEmail) => {
    sent.push(m);
  });
  const markSent = vi.fn(async () => true);
  const deps: ReminderPassDeps = {
    listDue: async () => dueRows,
    sendReminder,
    markSent,
    baseUrl: BASE,
    from: FROM,
    ...overrides,
  };
  return { deps, sent, markSent, sendReminder };
}

describe("runReminderPass sends the stage-appropriate reminder and advances on success", () => {
  it("emails each due supporter their stage's reminder, From/Reply-To the giving inbox", async () => {
    const { deps, sent } = makeDeps();
    const result = await runReminderPass(deps);
    expect(result).toEqual({ due: 2, sent: 2, failed: 0 });

    // Stage 1 (5-day) → the warm "still love to thank you" subject + the env-correct tokenised link for tok-1.
    expect(sent[0].subject).toContain("still love to thank you");
    expect(sent[0].subject).toContain("Bean There");
    expect(sent[0].html).toContain("https://nbcc.test/business/thank-you?token=tok-1");
    expect(sent[0].email).toBe("a@biz.test");
    expect(sent[0].from).toBe(FROM);
    expect(sent[0].replyTo).toBe(FROM);

    // Stage 2 (14-day) → the gentle "one last gentle note" subject + the tokenised link for tok-2.
    expect(sent[1].subject).toContain("One last gentle note");
    expect(sent[1].html).toContain("https://nbcc.test/business/thank-you?token=tok-2");
  });

  it("advances reminder_count to the sent stage, once per supporter, only after the send", async () => {
    const { deps, markSent } = makeDeps();
    await runReminderPass(deps);
    expect(markSent).toHaveBeenCalledTimes(2);
    expect(markSent).toHaveBeenNthCalledWith(1, 1, 1); // fulfilment 1 → stage 1
    expect(markSent).toHaveBeenNthCalledWith(2, 2, 2); // fulfilment 2 → stage 2
  });
});

describe("best-effort: one failure never aborts the rest, and a failed send does not advance the count", () => {
  it("a failed send is counted, leaves that record un-advanced, and the next supporter still sends", async () => {
    const markSent = vi.fn(async () => true);
    const sendReminder = vi.fn(async (m: BusinessSupporterReminderEmail) => {
      if (m.email === "a@biz.test") throw new Error("relay 500");
    });
    const { deps } = makeDeps({ sendReminder, markSent });
    const result = await runReminderPass(deps);

    expect(result).toEqual({ due: 2, sent: 1, failed: 1 });
    // Both supporters were attempted (the first failure did not abort the loop).
    expect(sendReminder).toHaveBeenCalledTimes(2);
    // The failed supporter (id 1) was NOT marked; only the succeeded one (id 2, stage 2) advanced.
    expect(markSent).toHaveBeenCalledTimes(1);
    expect(markSent).toHaveBeenCalledWith(2, 2);
  });

  it("a stamp failure (send ok, mark throws) is counted as failed and does not abort the run", async () => {
    const markSent = vi.fn(async (id: number) => {
      if (id === 1) throw new Error("db blip");
      return true;
    });
    const { deps, sendReminder } = makeDeps({ markSent });
    const result = await runReminderPass(deps);

    // Supporter 1's mark threw → failed; supporter 2 still processed → sent.
    expect(result).toEqual({ due: 2, sent: 1, failed: 1 });
    expect(sendReminder).toHaveBeenCalledTimes(2);
  });
});

describe("a run over an empty due-list (nobody due, or a completed second run) is a no-op", () => {
  it("sends nothing and marks nothing when the due-list is empty", async () => {
    const { deps, markSent, sendReminder } = makeDeps({ listDue: async () => [] });
    const result = await runReminderPass(deps);
    expect(result).toEqual({ due: 0, sent: 0, failed: 0 });
    expect(sendReminder).not.toHaveBeenCalled();
    expect(markSent).not.toHaveBeenCalled();
  });
});
