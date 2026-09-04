import { describe, it, expect, vi } from "vitest";
import {
  isDigestDay,
  buildDigests,
  runDigestPass,
  DIGEST_WEEKDAY,
  type DigestRecipient,
} from "../../src/outreach/digest";
import type { Todo } from "../../src/outreach/todo";

// TASK-415: the Monday note. "Needs you today" only works for somebody who opens it, and these
// volunteers have jobs and lives, so once a week the list goes to them instead.
//
// The tests that matter are the ones about who does NOT get an email.

const MONDAY = new Date("2026-09-07T08:00:00Z");
const TUESDAY = new Date("2026-09-08T08:00:00Z");

const todo = (over: Partial<Todo> = {}): Todo => ({
  id: 1,
  businessName: "Ayr Joinery Ltd",
  kind: "nudge",
  reason: "",
  action: "",
  daysOverdue: 0,
  owner: "Sarah",
  ownerEmail: "sarah@nbcc.scot",
  ...over,
});

const volunteers: DigestRecipient[] = [
  { name: "Sarah", email: "sarah@nbcc.scot" },
  { name: "Jaimie", email: "jaimie@nbcc.scot" },
];

describe("which day", () => {
  it("goes on a Monday, before the week starts", () => {
    expect(DIGEST_WEEKDAY).toBe(1);
    expect(isDigestDay(MONDAY)).toBe(true);
  });

  it("does not go on any other day", () => {
    expect(isDigestDay(TUESDAY)).toBe(false);
  });
});

describe("who gets one", () => {
  // The feature, not an omission. An email that arrives every Monday saying "nothing to do"
  // teaches people to delete it unread, and then the one that matters goes with it.
  it("sends nothing to a volunteer with nothing waiting", () => {
    const digests = buildDigests([todo({ ownerEmail: "sarah@nbcc.scot" })], volunteers);
    expect(digests).toHaveLength(1);
    expect(digests[0].email).toBe("sarah@nbcc.scot");
  });

  // Five volunteers each getting the same list of nobody's businesses is how five people each
  // assume one of the others has it.
  it("does not mail unassigned work to everybody", () => {
    expect(buildDigests([todo({ ownerEmail: null, owner: null })], volunteers)).toEqual([]);
  });

  it("says nothing to somebody who has left the list", () => {
    const digests = buildDigests([todo({ ownerEmail: "gone@nbcc.scot" })], volunteers);
    expect(digests).toEqual([]);
  });

  it("gives each volunteer only their own", () => {
    const digests = buildDigests(
      [
        todo({ ownerEmail: "sarah@nbcc.scot" }),
        todo({ ownerEmail: "sarah@nbcc.scot" }),
        todo({ ownerEmail: "jaimie@nbcc.scot" }),
      ],
      volunteers,
    );
    expect(digests.find((d) => d.email === "sarah@nbcc.scot")?.total).toBe(2);
    expect(digests.find((d) => d.email === "jaimie@nbcc.scot")?.total).toBe(1);
  });
});

describe("what it says", () => {
  const [digest] = buildDigests(
    [
      todo({ kind: "nudge" }),
      todo({ kind: "nudge" }),
      todo({ kind: "ask-again" }),
      todo({ kind: "call" }),
    ],
    volunteers,
  );

  // The subject is the whole email for most people: it has to be judgeable without opening it.
  it("puts the count in the subject", () => {
    expect(digest.subject).toBe("4 businesses waiting on you");
  });

  it("counts one business in the singular", () => {
    const [one] = buildDigests([todo()], volunteers);
    expect(one.subject).toBe("1 business waiting on you");
  });

  // Same order as the list itself, so the email and the screen never disagree about what matters.
  it("leads with the promise we made, then the warm one", () => {
    expect(digest.lines[0]).toMatch(/come back around now/i);
    expect(digest.lines[1]).toMatch(/worth a call/i);
  });

  it("groups rather than listing every business", () => {
    expect(digest.lines).toHaveLength(3);
    expect(digest.lines.some((l) => l.includes("2"))).toBe(true);
  });

  it("mentions no business by name", () => {
    expect(digest.lines.join(" ")).not.toContain("Ayr Joinery");
  });
});

describe("the weekly pass", () => {
  const deps = (now: Date, send = vi.fn().mockResolvedValue(undefined)) => ({
    now,
    send,
    listTodos: async () => [todo()],
    listVolunteers: async () => volunteers,
  });

  it("does nothing at all on the other six days", async () => {
    const send = vi.fn();
    const result = await runDigestPass(deps(TUESDAY, send));
    expect(result.skipped).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends on the day", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await runDigestPass(deps(MONDAY, send));
    expect(result).toMatchObject({ volunteers: 1, sent: 1, failed: 0, skipped: false });
    expect(send).toHaveBeenCalledTimes(1);
  });

  // One bad address must not stop the others hearing.
  it("keeps going after a failure", async () => {
    const send = vi.fn().mockRejectedValue(new Error("bounced"));
    const result = await runDigestPass({
      now: MONDAY,
      send,
      listTodos: async () => [todo({ ownerEmail: "sarah@nbcc.scot" }), todo({ ownerEmail: "jaimie@nbcc.scot" })],
      listVolunteers: async () => volunteers,
    });
    expect(result).toMatchObject({ volunteers: 2, sent: 0, failed: 2 });
  });
});
