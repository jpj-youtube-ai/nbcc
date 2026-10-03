import { describe, it, expect } from "vitest";
import {
  REQUEST_KINDS,
  applyRequestAction,
  dueBackOn,
  organiserRequestLines,
  parseWants,
  requestActionSchema,
  requestTotals,
  requestViews,
  requestsToDo,
  type RequestRow,
  type RequestSubject,
} from "../../src/fundraising/requests";
import type { Wants } from "../../src/fundraising/model";

// TASK-505: what an organiser asked us for, tracked to done. Pure: today is passed in as a UK day,
// so every date here is fixed. Every name, place and number is invented.

const TODAY = "2026-12-07";

// The sign up tidy (Jaimie, 2026-10-03): collection envelopes, in memory of someone, none by default.
const NONE: Wants = { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, qrCount: 0, envelopeCount: 0, shoutOut: false, attend: false };
const subject = (wants: Partial<Wants>, over: Partial<RequestSubject> = {}): RequestSubject => ({
  wants: { ...NONE, ...wants },
  socialOk: true,
  eventDate: "2026-12-12",
  status: "approved",
  ...over,
});

function row(kind: RequestRow["kind"], over: Partial<RequestRow> = {}): RequestRow {
  return {
    fundraiserId: 9,
    kind,
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
    updatedAt: "2026-12-01T10:00:00.000Z",
    updatedBy: "admin:fern@example.com",
    ...over,
  };
}

const kinds = (f: RequestSubject, rows: RequestRow[] = []) => requestViews(f, rows, TODAY).map((v) => v.kind);

describe("what shows", () => {
  it("shows nothing when nothing was asked for", () => {
    expect(requestViews(subject({}), [], TODAY)).toEqual([]);
  });

  it("shows each thing asked for, in a fixed order, the split and the old combined requests alike", () => {
    expect(
      kinds(subject({ posterCount: 10, leafletCount: 50, bucketCount: 2, tinCount: 1, leaflets: 3, buckets: 1, qrCount: 5, envelopeCount: 40, shoutOut: true, attend: true })),
    ).toEqual([...REQUEST_KINDS]);
  });

  it("starts each one at its first step, with how many were asked for, with no row needed (old sign ups need no backfill)", () => {
    const [posters, buckets, shout, attend] = requestViews(subject({ posterCount: 10, bucketCount: 2, shoutOut: true, attend: true }), [], TODAY);
    expect(posters).toMatchObject({ kind: "posters", group: "printed", label: "Posters", asked: 10, status: "to_send", statusLabel: "To send", actions: ["send"], outstanding: true });
    expect(buckets).toMatchObject({ kind: "buckets", group: "lent", label: "Collection buckets", asked: 2, status: "to_send", actions: ["out"], outstanding: true });
    expect(shout).toMatchObject({ kind: "shout_out", group: "shout_out", asked: null, status: "to_do", statusLabel: "To do", actions: ["done"], outstanding: true });
    expect(attend).toMatchObject({ kind: "attend", group: "attend", status: "to_arrange", statusLabel: "To arrange", actions: ["arrange"], outstanding: true });
  });

  it("keeps showing a request staff have acted on even after the ask was changed to none (the buckets are still out)", () => {
    expect(kinds(subject({}), [row("buckets", { status: "with_them", quantity: 2, sentOn: "2026-12-01" })])).toEqual(["buckets"]);
    // A row put back to its first step, and no longer asked for: nothing to show.
    expect(kinds(subject({}), [row("posters", { status: "to_send" })])).toEqual([]);
  });

  it("ignores a row for another fundraiser's kind it does not know", () => {
    expect(kinds(subject({}), [row("rubbish" as RequestRow["kind"], { status: "sent" })])).toEqual([]);
  });

  it("says No permission to post, with nothing to do, when they did not say we could post about it", () => {
    const [shout] = requestViews(subject({ shoutOut: true }, { socialOk: false }), [], TODAY);
    expect(shout).toMatchObject({ noPermission: true, actions: [], outstanding: false });
  });
});

describe("each step", () => {
  it("posters and leaflets: To send, then Sent with the date, how, who, the count and a note; Undo or change the count", () => {
    const [v] = requestViews(
      subject({ posterCount: 10 }),
      [row("posters", { status: "sent", quantity: 8, how: "post", sentOn: "2026-12-03", handledBy: "Fern", note: "Second class" })],
      TODAY,
    );
    expect(v).toMatchObject({ status: "sent", statusLabel: "Sent", quantity: 8, how: "post", sentOn: "2026-12-03", handledBy: "Fern", outstanding: false });
    expect(v.actions).toEqual(["count", "undo"]);
  });

  it("buckets and tins: To send, With them, then Back", () => {
    const f = subject({ bucketCount: 2 });
    expect(requestViews(f, [row("buckets", { status: "with_them", quantity: 2, sentOn: "2026-12-01" })], TODAY)[0]).toMatchObject({
      statusLabel: "With them",
      actions: ["back", "undo"],
      outstanding: false,
    });
    expect(requestViews(f, [row("buckets", { status: "back", quantity: 2, quantityBack: 2, sentOn: "2026-12-01", backOn: "2026-12-06" })], TODAY)[0]).toMatchObject({
      statusLabel: "Back",
      actions: ["undo"],
    });
  });

  it("a shout out: To do, then Done; someone to come along: To arrange, Arranged, then Done", () => {
    const f = subject({ shoutOut: true, attend: true });
    const views = requestViews(f, [row("shout_out", { status: "done", doneOn: "2026-12-02" }), row("attend", { status: "arranged", going: "Rowan" })], TODAY);
    expect(views.map((v) => [v.statusLabel, v.actions])).toEqual([
      ["Done", ["undo"]],
      ["Arranged", ["done", "undo"]],
    ]);
  });
});

describe("due back", () => {
  it("is two weeks after the fundraiser's date", () => {
    expect(dueBackOn("2026-12-12", "2026-12-01")).toBe("2026-12-26");
  });

  it("is four weeks after they went out when there is no date", () => {
    expect(dueBackOn(null, "2026-12-01")).toBe("2026-12-29");
  });

  it("is unknown with neither", () => {
    expect(dueBackOn(null, null)).toBeNull();
  });

  it("shows Due back from that day, not before, and only while they are with them", () => {
    const f = subject({ bucketCount: 1 }, { eventDate: "2026-11-23" }); // due back 2026-12-07
    const out = row("buckets", { status: "with_them", quantity: 1, sentOn: "2026-11-20" });
    expect(requestViews(f, [out], "2026-12-06")[0]).toMatchObject({ dueOn: "2026-12-07", dueBack: false });
    expect(requestViews(f, [out], "2026-12-07")[0]).toMatchObject({ dueOn: "2026-12-07", dueBack: true });
    expect(requestViews(f, [{ ...out, status: "back", backOn: "2026-12-07", quantityBack: 1 }], "2026-12-08")[0].dueBack).toBe(false);
    // Still to send: nothing is due back yet.
    expect(requestViews(f, [], "2026-12-08")[0]).toMatchObject({ dueOn: null, dueBack: false });
  });

  it("works across the clocks going back, as UK days", () => {
    // Date Sat 17 Oct 2026; the clocks go back on Sun 25 Oct. Due back Sat 31 Oct, never a day out.
    expect(dueBackOn("2026-10-17", null)).toBe("2026-10-31");
    expect(dueBackOn(null, "2026-03-20")).toBe("2026-04-17");
  });
});

describe("Requests to do", () => {
  const f = subject({ posterCount: 10 });

  it("is on while something is still at its first step, for a sign up still to come", () => {
    expect(requestsToDo(f, requestViews(f, [], TODAY), TODAY)).toBe(true);
    expect(requestsToDo({ ...f, status: "new" }, requestViews(f, [], TODAY), TODAY)).toBe(true);
  });

  it("is off once it is sent", () => {
    expect(requestsToDo(f, requestViews(f, [row("posters", { status: "sent", sentOn: "2026-12-03" })], TODAY), TODAY)).toBe(false);
  });

  it("is off for one past its date, declined or finished, as the Monday summary always has", () => {
    for (const g of [{ ...f, eventDate: "2026-12-06" }, { ...f, status: "declined" as const }, { ...f, status: "finished" as const }]) {
      expect(requestsToDo(g, requestViews(g, [], TODAY), TODAY)).toBe(false);
    }
    // No date: still to come.
    const undated = { ...f, eventDate: null };
    expect(requestsToDo(undated, requestViews(undated, [], TODAY), TODAY)).toBe(true);
  });

  it("is off for a shout out they gave no permission for", () => {
    const g = subject({ shoutOut: true }, { socialOk: false });
    expect(requestsToDo(g, requestViews(g, [], TODAY), TODAY)).toBe(false);
  });
});

describe("the totals the Monday summary and the list use", () => {
  it("counts only what is still to send or do, and every bucket or tin not back, due or not", () => {
    const a = subject({ posterCount: 10, leafletCount: 50, shoutOut: true, attend: true });
    const b = subject({ bucketCount: 2, tinCount: 1 }, { eventDate: "2026-11-20" }); // past: its to send is not counted
    const c = subject({ buckets: 1, leaflets: 3 }, { eventDate: null });
    const t = requestTotals(
      [
        { f: a, rows: [row("leaflets", { status: "sent", quantity: 50, sentOn: "2026-12-01" }), row("attend", { status: "arranged", going: "Rowan" })] },
        { f: b, rows: [row("buckets", { status: "with_them", quantity: 2, sentOn: "2026-11-10" })] }, // due 2026-12-04
        { f: c, rows: [row("buckets_or_tins", { status: "with_them", quantity: 1, sentOn: "2026-12-01" })] }, // due 2026-12-29
      ],
      TODAY,
    );
    expect(t.materials).toEqual({ posters: 10, leaflets: 0, buckets: 0, tins: 0, leafletsOrPosters: 3, bucketsOrTins: 0, qrCodes: 0 });
    expect(t.materialsFundraisers).toBe(2);
    expect(t.shoutOuts).toBe(1);
    expect(t.attend).toEqual([]);
    expect(t.notBack).toBe(3);
    expect(t.notBackDue).toBe(2);
    expect(t.dueBackRequests).toBe(1);
  });

  it("counts what went out, or what was asked for when no count was kept", () => {
    const t = requestTotals([{ f: subject({ tinCount: 4 }), rows: [row("tins", { status: "with_them", quantity: null, sentOn: "2026-12-01" })] }], TODAY);
    expect(t.notBack).toBe(4);
  });
});

describe("the organiser's own view", () => {
  it("says where each thing is up to, in plain words", () => {
    const f = subject({ posterCount: 10, leafletCount: 20, bucketCount: 2, tinCount: 1, shoutOut: true, attend: true });
    const lines = organiserRequestLines(
      requestViews(
        f,
        [
          row("posters", { status: "sent", how: "post", sentOn: "2026-12-03", quantity: 10, handledBy: "Fern", note: "Inside only" }),
          row("leaflets", { status: "sent", how: "dropped_off", sentOn: "2026-12-04", quantity: 20 }),
          row("buckets", { status: "with_them", quantity: 2, sentOn: "2026-12-01" }),
          row("tins", { status: "back", quantity: 1, quantityBack: 1, sentOn: "2026-11-01", backOn: "2026-12-05", backNote: "Tin a bit dented" }),
          row("shout_out", { status: "done", doneOn: "2026-12-02", link: "https://www.facebook.com/example/posts/1" }),
          row("attend", { status: "arranged", going: "Rowan Example", note: "Bring the banner" }),
        ],
        TODAY,
      ),
      TODAY,
      f,
    );
    expect(lines).toEqual([
      { label: "Posters", words: "sent on 3 Dec" },
      { label: "Leaflets", words: "dropped off on 4 Dec" },
      { label: "Collection buckets", words: "with you, please bring them back by 26 Dec" },
      { label: "Collection tins", words: "back with us on 5 Dec. Thank you!" },
      { label: "Social media shout out", words: "posted on 2 Dec", link: "https://www.facebook.com/example/posts/1" },
      { label: "Someone from NBCC to come along", words: "arranged, we look forward to seeing you" },
    ]);
    // Staff notes, names and who is going never reach the organiser.
    const all = JSON.stringify(lines);
    for (const secret of ["Fern", "Inside only", "dented", "Rowan", "banner"]) expect(all).not.toContain(secret);
  });

  it("says what is still to come, for a fundraiser still to come", () => {
    const f = subject({ posterCount: 10, bucketCount: 1, shoutOut: true, attend: true });
    expect(organiserRequestLines(requestViews(f, [], TODAY), TODAY, f)).toEqual([
      { label: "Posters", words: "we're getting them ready" },
      { label: "Collection buckets", words: "we're getting them ready" },
      { label: "Social media shout out", words: "coming soon" },
      { label: "Someone from NBCC to come along", words: "we're working on it and will be in touch" },
    ]);
  });

  // Review fix I1: there is no backfill, so a request made before staff could track them sits at its
  // first step for good. For a fundraiser past its date, finished or declined, saying "we're getting
  // them ready" would be wrong (the posters went weeks ago), so a first step is not shown. Anything
  // staff have moved on always is, and buckets still with them are always asked for back.
  it("leaves out anything still at its first step once the fundraiser is past, finished or declined", () => {
    const wants = { posterCount: 10, bucketCount: 1, shoutOut: true, attend: true };
    const past = subject(wants, { eventDate: "2026-11-20" });
    const out = [row("buckets", { status: "with_them", quantity: 1, sentOn: "2026-11-10" })];
    expect(organiserRequestLines(requestViews(past, out, TODAY), TODAY, past)).toEqual([
      { label: "Collection buckets", words: "with you, please bring them back as soon as you can" },
    ]);
    for (const status of ["finished", "declined"] as const) {
      const done = subject(wants, { status });
      expect(organiserRequestLines(requestViews(done, [], TODAY), TODAY, done)).toEqual([]);
      const sent = [row("posters", { status: "sent", how: "post", sentOn: "2026-12-03" })];
      expect(organiserRequestLines(requestViews(done, sent, TODAY), TODAY, done)).toEqual([{ label: "Posters", words: "sent on 3 Dec" }]);
    }
    // On its own date it is still to come; with no date it always is.
    for (const f of [subject(wants, { eventDate: TODAY }), subject(wants, { eventDate: null })]) {
      expect(organiserRequestLines(requestViews(f, [], TODAY), TODAY, f)).toHaveLength(4);
    }
  });

  it("asks for their OK when they wanted a shout out without saying we could post, and uses the old words for an old combined ask", () => {
    const f = subject({ leaflets: 5, buckets: 1, shoutOut: true }, { socialOk: false });
    expect(organiserRequestLines(requestViews(f, [], TODAY), TODAY, f)).toEqual([
      { label: "Leaflets or posters", words: "we're getting them ready" },
      { label: "Buckets or tins", words: "we're getting them ready" },
      {
        label: "A shout out on our social media",
        words: "we just need your OK to post about you. Reply to any of our emails or give us a ring and we'll sort it.",
      },
    ]);
  });

  it("never gives a link that is not a web address", () => {
    const f = subject({ shoutOut: true });
    const [line] = organiserRequestLines(requestViews(f, [row("shout_out", { status: "done", doneOn: "2026-12-02", link: "javascript:alert(1)" })], TODAY), TODAY, f);
    expect(line).toEqual({ label: "Social media shout out", words: "posted on 2 Dec" });
  });
});

describe("reading what they asked for", () => {
  it("reads the stored wants, old and new, with anything missing as none", () => {
    expect(parseWants({ leaflets: 3, shoutOut: true })).toEqual({ ...NONE, leaflets: 3, shoutOut: true });
    expect(parseWants(null)).toEqual(NONE);
    expect(parseWants({ posterCount: "x", bucketCount: -2 })).toEqual(NONE);
  });
});

// --- changing a request --------------------------------------------------------------------------

const parse = (body: unknown) => requestActionSchema.safeParse(body);
function act(f: RequestSubject, kind: RequestRow["kind"], current: RequestRow | null, body: unknown, today = TODAY) {
  const p = parse(body);
  if (!p.success) throw new Error(JSON.stringify(p.error.issues));
  return applyRequestAction(f, kind, current, p.data, today);
}

describe("what a change must carry", () => {
  it("takes a sending: date, posted or dropped off, who, how many, and an optional note", () => {
    expect(parse({ action: "send", from: "to_send", on: "2026-12-03", how: "post", by: "Fern", quantity: 10, note: "" }).success).toBe(true);
    const bad = parse({ action: "send", from: "to_send", on: "2026-02-30", how: "pigeon", by: "", quantity: 0, note: "x".repeat(501) });
    expect(bad.success).toBe(false);
    const fields = bad.success ? [] : bad.error.issues.map((i) => i.path.join("."));
    expect(fields.sort()).toEqual(["by", "how", "note", "on", "quantity"]);
  });

  it("refuses anything it does not know, and an action that does not exist", () => {
    expect(parse({ action: "send", from: "to_send", on: "2026-12-03", how: "post", by: "Fern", quantity: 1, extra: 1 }).success).toBe(false);
    expect(parse({ action: "skip", from: "to_send" }).success).toBe(false);
  });

  it("takes a link to the post only as a full https address", () => {
    expect(parse({ action: "done", from: "to_do", on: "2026-12-02", by: "Fern", link: "https://www.instagram.com/p/abc" }).success).toBe(true);
    expect(parse({ action: "done", from: "to_do", on: "2026-12-02", by: "Fern", link: "http://example.com" }).success).toBe(false);
    expect(parse({ action: "done", from: "to_do", on: "2026-12-02", by: "Fern", link: "javascript:alert(1)" }).success).toBe(false);
  });
});

describe("moving a request on", () => {
  const f = subject({ posterCount: 10, bucketCount: 2, shoutOut: true, attend: true });

  it("sends posters from To send (no row yet) with what staff entered", () => {
    const r = act(f, "posters", null, { action: "send", from: "to_send", on: "2026-12-03", how: "dropped_off", by: "Fern", quantity: 8, note: "  Left at reception " });
    expect(r).toEqual({
      ok: true,
      state: expect.objectContaining({ status: "sent", sentOn: "2026-12-03", how: "dropped_off", handledBy: "Fern", quantity: 8, note: "Left at reception" }),
      words: "Posters: sent (dropped off)",
    });
  });

  it("lends buckets out, then has them back with how many and a note on the money", () => {
    const out = act(f, "buckets", null, { action: "out", from: "to_send", on: "2026-12-01", quantity: 2, by: "Fern" });
    expect(out.ok && out.state).toMatchObject({ status: "with_them", sentOn: "2026-12-01", quantity: 2, handledBy: "Fern" });
    const current = row("buckets", { ...(out.ok ? out.state : {}) });
    const back = act(f, "buckets", current, { action: "back", from: "with_them", on: "2026-12-06", quantity: 1, note: "One missing, about £40 inside" });
    expect(back.ok && back.state).toMatchObject({ status: "back", backOn: "2026-12-06", quantityBack: 1, backNote: "One missing, about £40 inside", quantity: 2 });
  });

  it("will not take back more than went out, or before they went out", () => {
    const current = row("buckets", { status: "with_them", quantity: 2, sentOn: "2026-12-01" });
    expect(act(f, "buckets", current, { action: "back", from: "with_them", on: "2026-12-06", quantity: 3 })).toMatchObject({ ok: false, reason: "invalid", field: "quantity" });
    expect(act(f, "buckets", current, { action: "back", from: "with_them", on: "2026-11-30", quantity: 2 })).toMatchObject({ ok: false, reason: "invalid", field: "on" });
  });

  it("will not take a date still to come, in UK days", () => {
    expect(act(f, "posters", null, { action: "send", from: "to_send", on: "2026-12-08", how: "post", by: "Fern", quantity: 1 })).toMatchObject({
      ok: false,
      reason: "invalid",
      field: "on",
    });
  });

  it("marks a shout out done with a link and who, only with permission", () => {
    const done = act(f, "shout_out", null, { action: "done", from: "to_do", on: "2026-12-02", by: "Fern", link: "https://www.facebook.com/example/posts/1" });
    expect(done.ok && done.state).toMatchObject({ status: "done", doneOn: "2026-12-02", handledBy: "Fern", link: "https://www.facebook.com/example/posts/1" });
    expect(act(f, "shout_out", null, { action: "done", from: "to_do", on: "2026-12-02" })).toMatchObject({ ok: false, field: "by" });
    expect(act({ ...f, socialOk: false }, "shout_out", null, { action: "done", from: "to_do", on: "2026-12-02", by: "Fern" })).toMatchObject({ ok: false, reason: "not_allowed" });
  });

  it("arranges someone to come along, then marks it done, never straight to done", () => {
    expect(act(f, "attend", null, { action: "done", from: "to_arrange", on: "2026-12-07" })).toMatchObject({ ok: false, reason: "not_allowed" });
    const arranged = act(f, "attend", null, { action: "arrange", from: "to_arrange", going: "Rowan", note: "Bring the banner" });
    expect(arranged.ok && arranged.state).toMatchObject({ status: "arranged", going: "Rowan", note: "Bring the banner" });
    const done = act(f, "attend", row("attend", { status: "arranged", going: "Rowan" }), { action: "done", from: "arranged", on: "2026-12-07" });
    expect(done.ok && done.state).toMatchObject({ status: "done", doneOn: "2026-12-07", going: "Rowan" });
  });

  it("changes the count actually sent, once sent", () => {
    const sent = row("posters", { status: "sent", quantity: 10, sentOn: "2026-12-03", how: "post", handledBy: "Fern" });
    const r = act(f, "posters", sent, { action: "count", from: "sent", quantity: 6 });
    expect(r).toMatchObject({ ok: true, state: { status: "sent", quantity: 6, sentOn: "2026-12-03" }, words: "Posters: count sent changed from 10 to 6" });
    expect(act(f, "posters", null, { action: "count", from: "to_send", quantity: 6 })).toMatchObject({ ok: false, reason: "not_allowed" });
  });

  it("refuses an action that does not belong to the kind", () => {
    expect(act(f, "posters", null, { action: "out", from: "to_send", on: "2026-12-01", quantity: 2, by: "Fern" })).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(act(f, "buckets", null, { action: "send", from: "to_send", on: "2026-12-01", how: "post", quantity: 2, by: "Fern" })).toMatchObject({ ok: false, reason: "not_allowed" });
  });

  it("refuses a request they did not ask for, with nothing done about it yet", () => {
    expect(act(f, "tins", null, { action: "out", from: "to_send", on: "2026-12-01", quantity: 1, by: "Fern" })).toMatchObject({ ok: false, reason: "not_asked" });
  });

  it("refuses a change made from an out of date screen: what staff saw must be what is stored", () => {
    const sent = row("posters", { status: "sent", sentOn: "2026-12-03" });
    expect(act(f, "posters", sent, { action: "send", from: "to_send", on: "2026-12-03", how: "post", by: "Fern", quantity: 10 })).toMatchObject({
      ok: false,
      reason: "conflict",
    });
  });
});

describe("Undo: the only way back, one step at a time", () => {
  const f = subject({ posterCount: 10, bucketCount: 2, shoutOut: true, attend: true });

  it("takes posters back to To send, clearing what was entered", () => {
    const r = act(f, "posters", row("posters", { status: "sent", quantity: 8, how: "post", sentOn: "2026-12-03", handledBy: "Fern", note: "x" }), { action: "undo", from: "sent" });
    expect(r).toMatchObject({ ok: true, state: { status: "to_send", quantity: null, how: null, sentOn: null, handledBy: null, note: null }, words: "Posters: undone, back to To send" });
  });

  it("takes buckets from Back to With them, keeping when they went out", () => {
    const r = act(f, "buckets", row("buckets", { status: "back", quantity: 2, sentOn: "2026-12-01", handledBy: "Fern", backOn: "2026-12-06", quantityBack: 2, backNote: "All fine" }), {
      action: "undo",
      from: "back",
    });
    expect(r).toMatchObject({ ok: true, state: { status: "with_them", quantity: 2, sentOn: "2026-12-01", handledBy: "Fern", backOn: null, quantityBack: null, backNote: null } });
  });

  it("takes someone to come along from Done to Arranged, keeping who is going", () => {
    const r = act(f, "attend", row("attend", { status: "done", going: "Rowan", doneOn: "2026-12-07" }), { action: "undo", from: "done" });
    expect(r).toMatchObject({ ok: true, state: { status: "arranged", going: "Rowan", doneOn: null } });
  });

  it("has nothing to undo at the first step", () => {
    expect(act(f, "posters", null, { action: "undo", from: "to_send" })).toMatchObject({ ok: false, reason: "not_allowed" });
  });
});
