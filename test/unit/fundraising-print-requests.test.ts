import { describe, it, expect } from "vitest";
import {
  MAX_A3,
  MAX_A4,
  MAX_A5,
  applyPrintAsk,
  askWords,
  canAskToPrint,
  printAskSchema,
  printStatus,
} from "../../src/fundraising/print-requests";
import { requestViews, parseWants, type RequestRow } from "../../src/fundraising/requests";

// TASK-512: after seeing their materials, an organiser can ask us to print posters (A4 or A3) or
// leaflets (A5). The ask becomes the posters or leaflets request staff already track (TASK-505): how
// many they want goes in fundraisers.wants (where the sign up form put it), the request is To send,
// and a note says what sizes and when. So it shows in Admin > Fundraising's Requests, the Monday
// summary and the Overview with nothing new to learn. Pure; every name here is invented.

const TODAY = "2026-10-03";
const approved = { status: "approved" as const, eventDate: "2026-12-05", wants: parseWants({}), socialOk: false };

function row(over: Partial<RequestRow> = {}): RequestRow {
  return {
    fundraiserId: 12,
    kind: "posters",
    status: "to_send",
    quantity: null,
    quantityBack: null,
    how: null,
    sentOn: null,
    backOn: null,
    doneOn: null,
    handledBy: null,
    going: null,
    note: null,
    backNote: null,
    link: null,
    updatedAt: null,
    updatedBy: null,
    ...over,
  };
}

describe("what an organiser can ask for", () => {
  it("posters: how many A4 and how many A3, at least one", () => {
    expect(printAskSchema.safeParse({ kind: "posters", a4: 10, a3: 2 }).success).toBe(true);
    expect(printAskSchema.safeParse({ kind: "posters", a4: 0, a3: 3 }).success).toBe(true);
    const none = printAskSchema.safeParse({ kind: "posters", a4: 0, a3: 0 });
    expect(none.success).toBe(false);
  });

  it("leaflets: how many A5", () => {
    expect(printAskSchema.safeParse({ kind: "leaflets", a5: 50 }).success).toBe(true);
    expect(printAskSchema.safeParse({ kind: "leaflets", a5: 0 }).success).toBe(false);
  });

  it("whole numbers only, within what we print at a time", () => {
    expect(printAskSchema.safeParse({ kind: "posters", a4: 2.5, a3: 0 }).success).toBe(false);
    expect(printAskSchema.safeParse({ kind: "posters", a4: MAX_A4 + 1, a3: 0 }).success).toBe(false);
    expect(printAskSchema.safeParse({ kind: "posters", a4: 0, a3: MAX_A3 + 1 }).success).toBe(false);
    expect(printAskSchema.safeParse({ kind: "leaflets", a5: MAX_A5 + 1 }).success).toBe(false);
    expect(printAskSchema.safeParse({ kind: "posters", a4: -1, a3: 2 }).success).toBe(false);
  });

  it("nothing else", () => {
    expect(printAskSchema.safeParse({ kind: "buckets", a4: 1 }).success).toBe(false);
    expect(printAskSchema.safeParse({ kind: "posters", a4: 1, a3: 0, note: "x" }).success).toBe(false);
  });

  it("is said in words", () => {
    expect(askWords({ kind: "posters", a4: 10, a3: 2 })).toBe("10 A4 posters and 2 A3 posters");
    expect(askWords({ kind: "posters", a4: 1, a3: 0 })).toBe("1 A4 poster");
    expect(askWords({ kind: "posters", a4: 0, a3: 1 })).toBe("1 A3 poster");
    expect(askWords({ kind: "leaflets", a5: 1 })).toBe("1 A5 leaflet");
    expect(askWords({ kind: "leaflets", a5: 60 })).toBe("60 A5 leaflets");
  });
});

describe("when they can ask", () => {
  it("while approved and still to come", () => {
    expect(canAskToPrint(approved, TODAY)).toBe(true);
    expect(canAskToPrint({ ...approved, eventDate: null }, TODAY)).toBe(true);
    expect(canAskToPrint({ ...approved, eventDate: TODAY }, TODAY)).toBe(true);
  });

  it("not once it has finished or its day has passed", () => {
    expect(canAskToPrint({ ...approved, status: "finished" }, TODAY)).toBe(false);
    expect(canAskToPrint({ ...approved, eventDate: "2026-10-02" }, TODAY)).toBe(false);
  });
});

describe("making the ask a request", () => {
  it("a first ask: the wanted count, To send, and a note with the sizes for staff", () => {
    const r = applyPrintAsk(approved, null, { kind: "posters", a4: 10, a3: 2 }, TODAY);
    expect(r).toMatchObject({ ok: true, kind: "posters", wantsKey: "posterCount", total: 12 });
    if (!r.ok) return;
    expect(r.state.status).toBe("to_send");
    expect(r.state.note).toBe("Asked in their private area on 3 Oct: 10 A4 posters and 2 A3 posters.");
    expect(r.words).toBe("Posters: they asked us to print 10 A4 posters and 2 A3 posters");
  });

  it("asking again before we send replaces what they asked for", () => {
    const r = applyPrintAsk(approved, row({ note: "Asked in their private area on 1 Oct: 4 A4 posters." }), { kind: "posters", a4: 6, a3: 0 }, TODAY);
    expect(r.ok && r.total).toBe(6);
    expect(r.ok && r.state.note).toBe("Asked in their private area on 3 Oct: 6 A4 posters.");
  });

  it("asking again after we sent some opens a new To send, saying what went before", () => {
    const sent = row({ status: "sent", quantity: 10, how: "post", sentOn: "2026-10-01", handledBy: "Robin" });
    const r = applyPrintAsk(approved, sent, { kind: "posters", a4: 5, a3: 0 }, TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state).toMatchObject({ status: "to_send", quantity: null, how: null, sentOn: null, handledBy: null });
    expect(r.state.note).toBe("Asked in their private area on 3 Oct: 5 A4 posters. More, after the 10 we sent on 1 Oct.");
  });

  it("leaflets go to the leaflets request", () => {
    const r = applyPrintAsk(approved, null, { kind: "leaflets", a5: 50 }, TODAY);
    expect(r).toMatchObject({ ok: true, kind: "leaflets", wantsKey: "leafletCount", total: 50 });
  });

  it("is refused once it has finished or its day has passed", () => {
    expect(applyPrintAsk({ ...approved, status: "finished" }, null, { kind: "leaflets", a5: 5 }, TODAY).ok).toBe(false);
    expect(applyPrintAsk({ ...approved, eventDate: "2026-09-30" }, null, { kind: "leaflets", a5: 5 }, TODAY).ok).toBe(false);
  });

  it("shows in the requests staff track, as asked and To send", () => {
    const r = applyPrintAsk(approved, null, { kind: "posters", a4: 10, a3: 2 }, TODAY);
    if (!r.ok) throw new Error("refused");
    const wants = { ...approved.wants, [r.wantsKey]: r.total };
    const stored = row({ ...r.state, kind: "posters" });
    const views = requestViews({ ...approved, wants }, [stored], TODAY);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ kind: "posters", asked: 12, status: "to_send", outstanding: true });
  });
});

describe("what the organiser sees", () => {
  it("nothing asked: just whether they can ask", () => {
    expect(printStatus(approved, [], [], TODAY)).toEqual({ canAsk: true, posters: null, leaflets: null });
  });

  it("their ask, its sizes and where it is up to", () => {
    const wants = { ...approved.wants, posterCount: 12 };
    const s = printStatus({ ...approved, wants }, [row({ note: "x" })], [{ kind: "posters", words: "10 A4 posters and 2 A3 posters", on: "2026-10-03" }], TODAY);
    expect(s.posters).toEqual({ asked: 12, words: "You asked for 10 A4 posters and 2 A3 posters on 3 Oct. We're getting them ready.", status: "to_send" });
  });

  it("an ask from the sign up form, before there were sizes", () => {
    const wants = { ...approved.wants, leafletCount: 30 };
    const s = printStatus({ ...approved, wants }, [], [], TODAY);
    expect(s.leaflets).toEqual({ asked: 30, words: "You asked for 30 leaflets. We're getting them ready.", status: "to_send" });
  });

  it("once sent", () => {
    const wants = { ...approved.wants, posterCount: 12 };
    const s = printStatus({ ...approved, wants }, [row({ status: "sent", quantity: 12, how: "dropped_off", sentOn: "2026-10-02" })], [], TODAY);
    expect(s.posters).toEqual({ asked: 12, words: "We dropped off 12 posters on 2 Oct.", status: "sent" });
  });
});

describe("what the organiser sees once it is over", () => {
  it("no 'getting them ready' for an ask still waiting on a fundraiser that has finished", () => {
    const wants = { ...approved.wants, posterCount: 12 };
    expect(printStatus({ ...approved, status: "finished", wants }, [], [], TODAY).posters).toBeNull();
  });

  it("but what we sent still shows", () => {
    const wants = { ...approved.wants, posterCount: 12 };
    const s = printStatus({ ...approved, status: "finished", wants }, [row({ status: "sent", quantity: 12, how: "post", sentOn: "2026-10-02" })], [], TODAY);
    expect(s.posters?.status).toBe("sent");
  });
});

// TASK-512 review: asking again before we send the "more" keeps saying what went before.
describe("asking again after a re-opened ask", () => {
  it("carries the 'after the N we sent' forward", () => {
    const sent = row({ status: "sent", quantity: 10, how: "post", sentOn: "2026-10-01", handledBy: "Robin" });
    const first = applyPrintAsk(approved, sent, { kind: "posters", a4: 5, a3: 0 }, TODAY);
    if (!first.ok) throw new Error("refused");
    const again = applyPrintAsk(approved, row({ ...first.state }), { kind: "posters", a4: 8, a3: 1 }, "2026-10-04");
    expect(again.ok && again.state.note).toBe("Asked in their private area on 4 Oct: 8 A4 posters and 1 A3 poster. More, after the 10 we sent on 1 Oct.");
  });

  it("adds nothing when nothing was sent before", () => {
    const again = applyPrintAsk(approved, row({ note: "Asked in their private area on 1 Oct: 4 A4 posters." }), { kind: "posters", a4: 6, a3: 0 }, TODAY);
    expect(again.ok && again.state.note).toBe("Asked in their private area on 3 Oct: 6 A4 posters.");
  });
});
