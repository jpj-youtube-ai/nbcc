import { describe, it, expect } from "vitest";
import {
  applyPackAction,
  coveringNote,
  organiserPackLine,
  packActionSchema,
  packAddress,
  packCounts,
  tshirtLeftOut,
  packItems,
  packKind,
  packRequestSync,
  packSettled,
  packView,
  welcomeLetter,
  type PackSubject,
  type StoredPack,
} from "../../src/fundraising/welcome-pack";

// Welcome packs (Jaimie, 2026-10-03): what goes in each approved page's pack, where the tick list is
// up to, what each press changes, and the words of the welcome letter and the in memory covering
// note. Pure: no database, no clock. Every person, place and number is invented.

const NONE = { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, qrCount: 0, envelopeCount: 0, shoutOut: false, attend: false };
function subject(over: Partial<PackSubject> = {}): PackSubject {
  return {
    id: 9,
    status: "approved",
    path: "raising",
    public: true,
    title: "Robin's Big Walk",
    slug: "robins-big-walk",
    name: "Robin Example",
    firstName: "Robin",
    lastName: "Example",
    wants: { ...NONE },
    postAddress: null,
    postLine1: "1 Example Road",
    postLine2: null,
    postTown: "Exampleton",
    postPostcode: "EX1 1EX",
    approvedAt: "2026-10-01T09:00:00.000Z",
    inMemory: false,
    teamId: null,
    // A team organiser's page: raising money by sponsorship, so its pack has the sponsor form.
    isTeam: true,
    socialOk: false,
    eventDate: null,
    isSporting: false,
    tshirtSize: null,
    memoryName: null,
    memorySetupBy: null,
    memoryDirectorBusiness: null,
    ...over,
  };
}
const keys = (f: PackSubject, sizes?: { a4: number; a3: number } | null) => packItems(f, sizes).map((i) => i.key);
const pack = (over: Partial<StoredPack> = {}): StoredPack => ({ sentAt: null, sentBy: null, signer: null, signerRole: null, items: [], ...over });
// What each thing was called when it was ticked: a tick only counts while the list still says the same.
const WORDS: Record<string, (n: number | null) => string> = {
  letter: () => "Welcome letter",
  sponsor_form: () => "Sponsor form",
  posters_a4: (n) => `${n} A4 posters`,
  posters_a3: (n) => `${n} A3 posters`,
  envelopes: (n) => `${n} collection envelopes`,
  buckets: (n) => `${n} collection buckets`,
  tshirt: () => "NBCC T-shirt, Adult M",
};
const ticked = (key: string, quantity: number | null = null, label = (WORDS[key] ?? (() => key))(quantity)) => ({
  key,
  label,
  quantity,
  tickedAt: "2026-10-03T10:00:00.000Z",
  tickedBy: "admin:fern@example.com",
  skippedReason: null,
});

describe("who gets a pack", () => {
  it("is every approved or finished fundraiser and event host", () => {
    expect(packKind(subject())).toBe("welcome");
    expect(packKind(subject({ path: "event" }))).toBe("welcome");
    expect(packKind(subject({ status: "finished" }))).toBe("welcome");
  });
  it("is nobody still new or declined", () => {
    expect(packKind(subject({ status: "new" }))).toBeNull();
    expect(packKind(subject({ status: "declined" }))).toBeNull();
  });
  it("is never a team member's page, which gave no address", () => {
    expect(packKind(subject({ teamId: 4 }))).toBeNull();
  });
  it("in memory is only the things they asked for, and nothing when they asked for nothing", () => {
    expect(packKind(subject({ inMemory: true }))).toBeNull();
    expect(packKind(subject({ inMemory: true, wants: { ...NONE, envelopeCount: 30 } }))).toBe("memory");
  });
});

describe("what is in a pack", () => {
  it("always has the welcome letter", () => {
    expect(keys(subject({ isTeam: false }))).toEqual(["letter"]);
  });
  it("has the sponsor form only for a sponsorship fundraiser: a sporting event, or a team organiser's page", () => {
    expect(keys(subject({ isTeam: false, isSporting: true, tshirtSize: "adult_m" }))).toEqual(["letter", "sponsor_form", "tshirt"]);
    expect(keys(subject({ isTeam: true }))).toEqual(["letter", "sponsor_form"]);
    // A bake sale or a coffee morning raises money without sponsors.
    expect(keys(subject({ isTeam: false, isSporting: false }))).toEqual(["letter"]);
    expect(keys(subject({ isTeam: false, isSporting: null }))).toEqual(["letter"]);
  });
  it("has no way to ask for a sponsor form: the form never asks, so nothing in what they asked for adds one", () => {
    expect(keys(subject({ isTeam: false, wants: { ...NONE, sponsorForm: true, sponsorFormCount: 2 } as never }))).toEqual(["letter"]);
  });
  it("has no sponsor form or T-shirt for an event host", () => {
    expect(keys(subject({ path: "event", isSporting: true, tshirtSize: "adult_m" }))).toEqual(["letter"]);
  });
  it("has what they asked for, in the numbers they asked for", () => {
    const items = packItems(subject({ wants: { ...NONE, posterCount: 10, leafletCount: 50, bucketCount: 2, tinCount: 1, qrCount: 4 } }));
    expect(items.map((i) => [i.key, i.quantity, i.words])).toEqual([
      ["letter", null, "Welcome letter"],
      ["posters_a4", 10, "10 A4 posters"],
      ["leaflets", 50, "50 A5 leaflets"],
      ["qr_codes", 4, "4 printed QR codes"],
      ["buckets", 2, "2 collection buckets"],
      ["tins", 1, "1 collection tin"],
      ["sponsor_form", null, "Sponsor form"],
    ]);
  });
  it("splits the posters by size when they asked us to print some of each", () => {
    const f = subject({ wants: { ...NONE, posterCount: 12 } });
    expect(packItems(f, { a4: 10, a3: 2 }).map((i) => i.words)).toEqual(["Welcome letter", "10 A4 posters", "2 A3 posters", "Sponsor form"]);
    // Sizes that no longer add up to what they asked for are not trusted: all A4.
    expect(packItems(f, { a4: 3, a3: 1 }).map((i) => i.words)).toContain("12 A4 posters");
  });
  it("keeps an old combined ask as it was asked", () => {
    expect(packItems(subject({ wants: { ...NONE, leaflets: 20, buckets: 1 } })).map((i) => i.words)).toEqual([
      "Welcome letter",
      "20 leaflets or posters",
      "1 bucket or tin",
      "Sponsor form",
    ]);
  });
  it("has the T-shirt with its size for a sporting event", () => {
    const shirt = packItems(subject({ isSporting: true, tshirtSize: "adult_m" })).find((i) => i.key === "tshirt")!;
    expect(shirt).toMatchObject({ words: "NBCC T-shirt, Adult M", waiting: false });
  });
  it("waits for the T-shirt size when a sporting event has none yet", () => {
    const shirt = packItems(subject({ isSporting: true })).find((i) => i.key === "tshirt")!;
    expect(shirt).toMatchObject({ words: "Waiting for T-shirt size", waiting: true });
  });
  it("in memory lists exactly what they asked for, with a covering note: no welcome letter, sponsor form or T-shirt", () => {
    const f = subject({ inMemory: true, isSporting: true, tshirtSize: "adult_m", wants: { ...NONE, envelopeCount: 30, qrCount: 20, posterCount: 3 } });
    expect(packItems(f).map((i) => [i.key, i.words])).toEqual([
      ["letter", "Covering note"],
      ["posters_a4", "3 A4 posters"],
      ["qr_codes", "20 QR cards for the order of service"],
      ["envelopes", "30 collection envelopes"],
    ]);
  });
});

describe("the address", () => {
  it("is their name, then each line they gave", () => {
    expect(packAddress(subject({ postLine2: "Flat 2" }))).toEqual({ name: "Robin Example", lines: ["1 Example Road", "Flat 2", "Exampleton", "EX1 1EX"] });
  });
  it("reads the one old address box of a sign up from before", () => {
    expect(packAddress(subject({ postLine1: null, postTown: null, postPostcode: null, postAddress: "4 Old Lane\nOldtown\nOL1 1AA" })).lines).toEqual(["4 Old Lane", "Oldtown", "OL1 1AA"]);
  });
  it("is empty when they gave none", () => {
    expect(packAddress(subject({ postLine1: null, postTown: null, postPostcode: null })).lines).toEqual([]);
  });
});

describe("where the tick list is up to", () => {
  const f = subject({ wants: { ...NONE, posterCount: 10 } });
  it("starts To pack, with nothing ticked", () => {
    const v = packView(f, null)!;
    expect(v).toMatchObject({ kind: "welcome", title: "Welcome pack", state: "to_pack", stateLabel: "To pack", canSend: false });
    expect(v.items.every((i) => i.tickable && !i.ticked)).toBe(true);
  });
  it("is Part packed once something is ticked, with who and when", () => {
    const v = packView(f, pack({ items: [ticked("letter")] }))!;
    expect(v.state).toBe("part");
    expect(v.stateLabel).toBe("Part packed");
    expect(v.items[0]).toMatchObject({ ticked: true, tickedBy: "admin:fern@example.com", tickedAt: "2026-10-03T10:00:00.000Z" });
  });
  it("is Ready to send when everything is ticked or left out with a reason", () => {
    const skipped = { key: "sponsor_form", label: "Sponsor form", quantity: null, tickedAt: null, tickedBy: "admin:fern@example.com", skippedReason: "They have one" };
    const v = packView(f, pack({ items: [ticked("letter"), ticked("posters_a4", 10), skipped] }))!;
    expect(v).toMatchObject({ state: "ready", stateLabel: "Ready to send", canSend: true });
    expect(v.items[2]).toMatchObject({ ticked: false, skippedReason: "They have one", done: true });
  });
  it("is Sent once marked, with the date and who", () => {
    const v = packView(f, pack({ sentAt: "2026-10-04T09:00:00.000Z", sentBy: "admin:fern@example.com", items: [ticked("letter"), ticked("posters_a4", 10), ticked("sponsor_form")] }))!;
    expect(v).toMatchObject({ state: "sent", stateLabel: "Sent", sentAt: "2026-10-04T09:00:00.000Z", sentBy: "admin:fern@example.com", canSend: false });
  });
  it("drops a tick when they have since asked for a different number", () => {
    const v = packView(f, pack({ items: [ticked("posters_a4", 4)] }))!;
    const posters = v.items.find((i) => i.key === "posters_a4")!;
    expect(posters).toMatchObject({
      ticked: false,
      done: false,
      changeNote: "It was ticked for 4 A4 posters. They now want 10 A4 posters, so it needs ticking again.",
    });
    expect(v.state).toBe("to_pack");
    expect(v.changedSinceSent).toBe(false);
  });
  it("drops the T-shirt's tick when they have since chosen a different size", () => {
    const s = subject({ isSporting: true, tshirtSize: "adult_l" });
    const shirt = packView(s, pack({ items: [ticked("tshirt")] }))!.items.find((i) => i.key === "tshirt")!;
    expect(shirt).toMatchObject({ ticked: false, done: false, changeNote: "It was ticked for size Adult M. They now want Adult L, so it needs ticking again." });
    expect(packView(subject({ isSporting: true, tshirtSize: "adult_m" }), pack({ items: [ticked("tshirt")] }))!.items.find((i) => i.key === "tshirt")).toMatchObject({ ticked: true, changeNote: null });
  });
  it("drops the posters' tick when the split between A4 and A3 has changed", () => {
    const s = subject({ wants: { ...NONE, posterCount: 12 } });
    const v = packView(s, pack({ items: [ticked("posters_a4", 12)] }), { a4: 10, a3: 2 })!;
    expect(v.items.find((i) => i.key === "posters_a4")).toMatchObject({ ticked: false, changeNote: "It was ticked for 12 A4 posters. They now want 10 A4 posters, so it needs ticking again." });
    expect(v.items.find((i) => i.key === "posters_a3")).toMatchObject({ ticked: false, changeNote: null });
  });
  it("keeps a sent pack Sent when the sign up changes afterwards, with a flag rather than a tick to redo", () => {
    const sent = pack({ sentAt: "2026-10-04T09:00:00.000Z", sentBy: "admin:fern@example.com", items: [ticked("letter"), ticked("posters_a4", 4), ticked("sponsor_form")] });
    const v = packView(f, sent)!;
    expect(v).toMatchObject({ state: "sent", changedSinceSent: true, canSend: false });
    expect(v.items.find((i) => i.key === "posters_a4")).toMatchObject({ ticked: true, done: true, changeNote: "Changed since it was sent: it went as 4 A4 posters." });
    // Something asked for only after it went: not ticked, and it says so.
    const more = packView(subject({ wants: { ...NONE, posterCount: 4, bucketCount: 1 } }), sent)!;
    expect(more.changedSinceSent).toBe(true);
    expect(more.items.find((i) => i.key === "buckets")).toMatchObject({ ticked: false, changeNote: "Asked for since it was sent." });
    // Nothing changed: no flag.
    expect(packView(subject({ wants: { ...NONE, posterCount: 4 } }), sent)!.changedSinceSent).toBe(false);
  });
  it("cannot be ready while it waits for a T-shirt size, unless the T-shirt is left out with a reason", () => {
    const s = subject({ isSporting: true });
    const waiting = packView(s, pack({ items: [ticked("letter"), ticked("sponsor_form")] }))!;
    expect(waiting.items.find((i) => i.key === "tshirt")).toMatchObject({ tickable: false, waiting: true });
    expect(waiting).toMatchObject({ state: "part", canSend: false });
    const left = packView(
      s,
      pack({
        items: [
          ticked("letter"),
          ticked("sponsor_form"),
          { key: "tshirt", label: "Waiting for T-shirt size", quantity: null, tickedAt: null, tickedBy: "admin:fern@example.com", skippedReason: "Sending it later" },
        ],
      }),
    )!;
    expect(left.state).toBe("ready");
  });
  it("no longer counts a T-shirt left out while it waited, once their size has come in", () => {
    const leftOut = { key: "tshirt", label: "Waiting for T-shirt size", quantity: null, tickedAt: null, tickedBy: "admin:fern@example.com", skippedReason: "Sending it later" };
    const s = subject({ isSporting: true, tshirtSize: "adult_m" });
    const v = packView(s, pack({ items: [ticked("letter"), ticked("sponsor_form"), leftOut] }))!;
    expect(v.items.find((i) => i.key === "tshirt")).toMatchObject({
      ticked: false,
      skippedReason: null,
      done: false,
      tickable: true,
      changeNote: "Their size has come in: Adult M. Tick it when the T-shirt goes in.",
    });
    expect(v).toMatchObject({ state: "part", canSend: false });
    // Still waiting: the leave out stands.
    expect(packView(subject({ isSporting: true }), pack({ items: [ticked("letter"), ticked("sponsor_form"), leftOut] }))!.state).toBe("ready");
  });
  it("flags it on a sent pack instead, and the pack is no longer settled", () => {
    const leftOut = { key: "tshirt", label: "Waiting for T-shirt size", quantity: null, tickedAt: null, tickedBy: "admin:fern@example.com", skippedReason: "Sending it later" };
    const sent = pack({ sentAt: "2026-10-04T09:00:00.000Z", sentBy: "admin:fern@example.com", items: [ticked("letter"), ticked("sponsor_form"), leftOut] });
    const s = subject({ isSporting: true, tshirtSize: "adult_m" });
    const v = packView(s, sent)!;
    expect(v).toMatchObject({ state: "sent", changedSinceSent: true });
    expect(v.items.find((i) => i.key === "tshirt")).toMatchObject({ skippedReason: "Sending it later", changeNote: "Their size has come in since the pack was sent: Adult M." });
    expect(packSettled(s, sent)).toBe(false);
    // Sent, and nothing owed: settled. Not sent: never.
    expect(packSettled(subject({ isSporting: true }), sent)).toBe(true);
    expect(packSettled(s, pack({ items: [ticked("letter")] }))).toBe(false);
    expect(packSettled(s, null)).toBe(false);
  });
  it("does the same for anything left out whose words have changed", () => {
    const leftOut = { key: "posters_a4", label: "4 A4 posters", quantity: 4, tickedAt: null, tickedBy: "admin:fern@example.com", skippedReason: "None printed yet" };
    const v = packView(f, pack({ items: [leftOut] }))!;
    expect(v.items.find((i) => i.key === "posters_a4")).toMatchObject({
      skippedReason: null,
      done: false,
      changeNote: "It was left out as 4 A4 posters. They now want 10 A4 posters, so it needs another look.",
    });
    const sent = packView(f, pack({ sentAt: "2026-10-04T09:00:00.000Z", sentBy: "x", items: [ticked("letter"), leftOut, ticked("sponsor_form")] }))!;
    expect(sent.items.find((i) => i.key === "posters_a4")).toMatchObject({ skippedReason: "None printed yet", changeNote: "Changed since it was sent: it was left out as 4 A4 posters." });
  });
  it("says what went in a sent pack and is no longer asked for", () => {
    const sent = pack({ sentAt: "2026-10-04T09:00:00.000Z", sentBy: "x", items: [ticked("letter"), ticked("posters_a4", 10), ticked("sponsor_form")] });
    const v = packView(subject(), sent)!; // they no longer ask for posters
    expect(v.changedSinceSent).toBe(true);
    expect(v.goneNotes).toEqual(["No longer asked for: 10 A4 posters (it went in the pack)."]);
    expect(packView(f, sent)!.goneNotes).toEqual([]);
    // Before it is sent a tick for something no longer asked for says nothing.
    expect(packView(subject(), pack({ items: [ticked("posters_a4", 10)] }))!.goneNotes).toEqual([]);
  });
  it("in memory is titled Things to send, and says the address may be the funeral director's", () => {
    const v = packView(subject({ inMemory: true, memoryName: "Margaret Exampleton", wants: { ...NONE, envelopeCount: 30 } }), null)!;
    expect(v).toMatchObject({ kind: "memory", title: "Things to send", addressNote: "This can be the funeral director's address." });
    expect(packView(subject(), null)!.addressNote).toBeNull();
  });
  it("is nothing for a page with no pack", () => {
    expect(packView(subject({ status: "new" }), null)).toBeNull();
  });
});

describe("what each press changes", () => {
  const f = subject();
  const act = (stored: StoredPack | null, input: Record<string, unknown>, s = f) => {
    const view = packView(s, stored)!;
    const item = view.items.find((i) => i.key === input.key);
    const seen = (input.action === "tick" || input.action === "skip") && !("words" in input) ? { words: item?.words ?? "x", quantity: item?.quantity ?? null } : {};
    return applyPackAction(view, packActionSchema.parse({ ...input, ...seen }));
  };
  it("ticks something, keeping what it was called and how many", () => {
    const r = act(null, { action: "tick", key: "letter" });
    expect(r).toMatchObject({ ok: true, change: { type: "tick", key: "letter", label: "Welcome letter", quantity: null }, words: "Welcome pack: Welcome letter ticked" });
  });
  it("will not tick the T-shirt while it waits for a size", () => {
    const r = act(null, { action: "tick", key: "tshirt" }, subject({ isSporting: true }));
    expect(r).toMatchObject({ ok: false, reason: "conflict" });
    expect(!r.ok && r.message).toMatch(/T-shirt size/);
  });
  it("will not tick something that is not in the pack", () => {
    expect(act(null, { action: "tick", key: "tshirt" })).toMatchObject({ ok: false, reason: "not_found" });
  });
  it("leaves something out only with a reason", () => {
    expect(packActionSchema.safeParse({ action: "skip", key: "sponsor_form", words: "Sponsor form", reason: "  " }).success).toBe(false);
    const r = act(null, { action: "skip", key: "sponsor_form", reason: " They have one " });
    expect(r).toMatchObject({ ok: true, change: { type: "skip", key: "sponsor_form", reason: "They have one" }, words: "Welcome pack: Sponsor form left out (They have one)" });
  });
  it("unticks", () => {
    const r = act(pack({ items: [ticked("letter")] }), { action: "untick", key: "letter" });
    expect(r).toMatchObject({ ok: true, change: { type: "untick", key: "letter" }, words: "Welcome pack: Welcome letter unticked" });
  });
  it("marks the pack sent only when it is ready", () => {
    expect(act(pack({ items: [ticked("letter")] }), { action: "send" })).toMatchObject({ ok: false, reason: "conflict" });
    const r = act(pack({ items: [ticked("letter"), ticked("sponsor_form")] }), { action: "send" });
    expect(r).toMatchObject({ ok: true, change: { type: "send" }, words: "Welcome pack sent" });
  });
  it("changes nothing in a pack that has been sent, until Undo", () => {
    const sent = pack({ sentAt: "2026-10-04T09:00:00.000Z", sentBy: "admin:fern@example.com", items: [ticked("letter"), ticked("sponsor_form")] });
    expect(act(sent, { action: "untick", key: "letter" })).toMatchObject({ ok: false, reason: "conflict" });
    expect(act(sent, { action: "send" })).toMatchObject({ ok: false, reason: "conflict" });
    expect(act(sent, { action: "undo" })).toMatchObject({ ok: true, change: { type: "undo" }, words: "Welcome pack: Sent undone" });
    expect(act(null, { action: "undo" })).toMatchObject({ ok: false, reason: "conflict" });
  });
  it("keeps who signs the letter", () => {
    const r = act(null, { action: "signer", name: " Fern Example ", role: "Volunteer, Night Before Christmas Campaign" });
    expect(r).toMatchObject({
      ok: true,
      change: { type: "signer", name: "Fern Example", role: "Volunteer, Night Before Christmas Campaign" },
      words: "Welcome pack: the letter is signed by Fern Example",
    });
    expect(packActionSchema.safeParse({ action: "signer", name: "" }).success).toBe(false);
  });
  it("changes nothing, and says nothing, when the press leaves it as it stands", () => {
    // Ticking what is ticked, unticking what nobody touched, and choosing the signer already chosen.
    expect(act(pack({ items: [ticked("letter")] }), { action: "tick", key: "letter" })).toEqual({ ok: true, change: null, words: "" });
    expect(act(null, { action: "untick", key: "letter" })).toEqual({ ok: true, change: null, words: "" });
    expect(act(pack({ signer: "Fern Example", signerRole: "Volunteer" }), { action: "signer", name: "Fern Example", role: "Volunteer" })).toEqual({ ok: true, change: null, words: "" });
    const left = { key: "sponsor_form", label: "Sponsor form", quantity: null, tickedAt: null, tickedBy: "admin:fern@example.com", skippedReason: "They have one" };
    expect(act(pack({ items: [left] }), { action: "skip", key: "sponsor_form", reason: "They have one" })).toEqual({ ok: true, change: null, words: "" });
    // A tick that no longer counts (the number changed) is a real change again.
    expect(act(pack({ items: [ticked("posters_a4", 4)] }), { action: "tick", key: "posters_a4" }, subject({ wants: { ...NONE, posterCount: 10 } }))).toMatchObject({
      ok: true,
      change: { type: "tick", label: "10 A4 posters", quantity: 10 },
    });
  });
  it("keeps the words of the thing with its tick, the T-shirt's size too", () => {
    const r = act(null, { action: "tick", key: "tshirt" }, subject({ isSporting: true, tshirtSize: "adult_m" }));
    expect(r).toMatchObject({ ok: true, change: { type: "tick", key: "tshirt", label: "NBCC T-shirt, Adult M" } });
  });
  it("ticks what staff saw, never what it has become since they opened the page", () => {
    const now = subject({ wants: { ...NONE, posterCount: 12 } });
    // They saw 10 on screen; it is 12 now.
    const r = act(null, { action: "tick", key: "posters_a4", words: "10 A4 posters", quantity: 10 }, now);
    expect(r).toEqual({ ok: false, reason: "conflict", message: "This has changed since you opened the page. Check the list and tick it again." });
    // The T-shirt's size too, and a leave out.
    const shirt = subject({ isSporting: true, tshirtSize: "adult_l" });
    expect(act(null, { action: "tick", key: "tshirt", words: "NBCC T-shirt, Adult M", quantity: null }, shirt)).toMatchObject({ ok: false, reason: "conflict" });
    expect(act(null, { action: "skip", key: "tshirt", words: "Waiting for T-shirt size", quantity: null, reason: "Later" }, shirt)).toMatchObject({ ok: false, reason: "conflict" });
    expect(act(null, { action: "tick", key: "posters_a4", words: "12 A4 posters", quantity: 12 }, now)).toMatchObject({ ok: true });
    // What was seen must be said.
    expect(packActionSchema.safeParse({ action: "tick", key: "letter" }).success).toBe(false);
  });
  it("in memory speaks of things to send", () => {
    const m = subject({ inMemory: true, wants: { ...NONE, envelopeCount: 30 } });
    expect(act(pack({ items: [ticked("letter", null, "Covering note"), ticked("envelopes", 30)] }), { action: "send" }, m)).toMatchObject({ ok: true, words: "Things to send: sent" });
  });
  it("refuses anything that is not one of the actions", () => {
    expect(packActionSchema.safeParse({ action: "post" }).success).toBe(false);
  });
});

describe("the welcome letter", () => {
  const signer = { name: "Fern Example", role: "Volunteer, Night Before Christmas Campaign" };
  const page = "nbcc.scot/fundraise/robins-big-walk";
  it("is the draft Jaimie wrote, for someone raising money", () => {
    const f = subject({ isSporting: true, tshirtSize: "adult_m", wants: { ...NONE, posterCount: 10 } });
    const l = welcomeLetter(f, packItems(f), signer, page);
    expect(l.greeting).toBe("Dear Robin,");
    expect(l.heading).toBe("Robin's Big Walk");
    expect(l.opening).toEqual([
      "Thank you so much for choosing to raise money for the Night Before Christmas Campaign. You're now part of the NBCC family, and we're so glad to have you.",
      "Your page is live at nbcc.scot/fundraise/robins-big-walk. Scan the code to see it, and share it with everyone you know.",
    ]);
    expect(l.packIntro).toBe("In this pack you'll find:");
    expect(l.packList).toEqual(["10 A4 posters", "a paper sponsor form", "your NBCC T-shirt, size Adult M"]);
    expect(l.closing).toEqual([
      "When the money starts coming in, your page shows your total. If you collect cash, you can pay it in from your private area at nbcc.scot/fundraise/manage.",
      "If you need anything at all, more posters, a collection bucket, or just a chat, call us on 01292 811 015 or email events@nbcc.scot. We're here to help. You'll also find tips and answers at nbcc.scot/fundraise/help.",
      "Every pound you raise helps the children, young people and vulnerable adults we support, all year round. Thank you.",
    ]);
    expect(l.signOff).toBe("With warmest wishes,");
    expect(l.signer).toBe("Fern Example");
    // The list's title already names the charity, so it is not said twice.
    expect(l.signerLines).toEqual(["Volunteer, Night Before Christmas Campaign"]);
  });
  it("names the charity under a signer with no title", () => {
    const f = subject();
    expect(welcomeLetter(f, packItems(f), { name: "Fern Example", role: null }, page).signerLines).toEqual(["Night Before Christmas Campaign"]);
  });
  it("is adapted for an event host: your event's page, and no sponsor form", () => {
    const f = subject({ path: "event", title: "Exampleton Quiz Night", wants: { ...NONE, posterCount: 5 } });
    const l = welcomeLetter(f, packItems(f), signer, "nbcc.scot/event/exampleton-quiz");
    expect(l.opening[0]).toBe(
      "Thank you so much for choosing to hold an event for the Night Before Christmas Campaign. You're now part of the NBCC family, and we're so glad to have you.",
    );
    expect(l.opening[1]).toBe("Your event's page is live at nbcc.scot/event/exampleton-quiz. Scan the code to see it, and share it with everyone you know.");
    expect(l.packList).toEqual(["5 A4 posters"]);
    expect(l.closing[0]).toBe(
      "When people give on your event's page, it shows your total. If you collect cash on the day, you can pay it in from your private area at nbcc.scot/fundraise/manage.",
    );
    expect(l.closing[2]).toBe("Every pound your event raises helps the children, young people and vulnerable adults we support, all year round. Thank you.");
    expect(JSON.stringify(l)).not.toMatch(/sponsor/i);
  });
  it("says nothing of a page that is not up, or of a pack with only the letter in it", () => {
    const f = subject({ path: "event", public: false });
    const l = welcomeLetter(f, packItems(f), signer, null);
    expect(l.opening).toHaveLength(1);
    expect(l.packIntro).toBeNull();
    expect(l.packList).toEqual([]);
  });
  it("leaves out of the list what is waiting or was left out", () => {
    const f = subject({ isSporting: true });
    const items = packItems(f).filter((i) => i.key !== "sponsor_form");
    expect(welcomeLetter(f, items, signer, page).packList).toEqual([]);
  });
  it("uses the first word of an old single name", () => {
    const f = subject({ firstName: null, lastName: null, name: "Sam Sample" });
    expect(welcomeLetter(f, packItems(f), signer, page).greeting).toBe("Dear Sam,");
  });
  // Jaimie, 2026-10-03: "Hi The," for a pub. The letter and the covering note take the same care.
  it("never says Dear The, or Dear with no name", () => {
    const group = subject({ firstName: null, lastName: null, name: "The Example Arms" });
    const blank = subject({ firstName: null, lastName: null, name: "" });
    for (const f of [group, blank]) {
      expect(welcomeLetter(f, packItems(f), signer, page).greeting).toBe("Hello,");
      expect(coveringNote(f, signer).greeting).toBe("Hello,");
    }
  });
  // Review: the same care as the emails. A title is skipped, and a group or a business (the name
  // its page is credited to) has no first name to use, whatever its first word.
  it("skips a title, and says Hello to a business whose name does not start with The", () => {
    const dr = subject({ firstName: null, lastName: null, name: "Dr Sam Example" });
    expect(welcomeLetter(dr, packItems(dr), signer, page).greeting).toBe("Dear Sam,");
    const ltd = { ...subject({ firstName: null, lastName: null, name: "Example Arms Ltd" }), creditName: "Example Arms Ltd" };
    expect(welcomeLetter(ltd, packItems(ltd), signer, page).greeting).toBe("Hello,");
    expect(coveringNote(ltd, signer).greeting).toBe("Hello,");
    // A first name of two words stays whole.
    const two = subject({ firstName: "Mary Jane", name: "Mary Jane Example" });
    expect(welcomeLetter(two, packItems(two), signer, page).greeting).toBe("Dear Mary Jane,");
  });
  it("never calls the people NBCC supports families", () => {
    const f = subject();
    expect(JSON.stringify(welcomeLetter(f, packItems(f), signer, page))).not.toMatch(/families/i);
  });
});

describe("the in memory covering note", () => {
  it("is gentle, with no exclamation marks", () => {
    const f = subject({ inMemory: true, memoryName: "Margaret Exampleton", wants: { ...NONE, envelopeCount: 30 } });
    const n = coveringNote(f, { name: "Fern Example", role: null });
    expect(n.greeting).toBe("Dear Robin,");
    expect(n.paragraphs).toEqual([
      "Here are the things you asked for, for Margaret Exampleton's page.",
      "If there is anything else we can do, please call us on 01292 811 015 or email events@nbcc.scot.",
    ]);
    expect(n.signOff).toBe("With warmest thoughts,");
    expect(n.signer).toBe("Fern Example");
    expect(n.signerLines).toEqual(["Night Before Christmas Campaign"]);
    expect(JSON.stringify(n)).not.toContain("!");
  });
});

describe("the organiser's own line, in their private area", () => {
  it("says nothing until the pack is sent", () => {
    expect(organiserPackLine(subject(), null)).toBeNull();
    expect(organiserPackLine(subject(), pack({ items: [ticked("letter")] }))).toBeNull();
  });
  it("says the welcome pack is on its way, and the day it was posted", () => {
    expect(organiserPackLine(subject(), pack({ sentAt: "2026-10-04T09:00:00.000Z", sentBy: "admin:fern@example.com" }))).toBe(
      "Your welcome pack is on its way. We posted it on 4 October 2026.",
    );
  });
  it("uses the UK day, whatever the clock in the cloud says", () => {
    expect(organiserPackLine(subject(), pack({ sentAt: "2026-07-04T23:30:00.000Z", sentBy: "x" }))).toContain("5 July 2026");
  });
  it("is gentle, and speaks of what they asked for, in memory", () => {
    const m = subject({ inMemory: true, wants: { ...NONE, envelopeCount: 30 } });
    expect(organiserPackLine(m, pack({ sentAt: "2026-10-04T09:00:00.000Z", sentBy: "x" }))).toBe(
      "The things you asked for are on their way. We posted them on 4 October 2026.",
    );
  });
  it("says nothing for a page with no pack, and never who sent it", () => {
    expect(organiserPackLine(subject({ teamId: 3 }), pack({ sentAt: "2026-10-04T09:00:00.000Z", sentBy: "admin:fern@example.com" }))).toBeNull();
    expect(organiserPackLine(subject(), pack({ sentAt: "2026-10-04T09:00:00.000Z", sentBy: "admin:fern@example.com" }))).not.toContain("fern");
  });
});

describe("the counts", () => {
  const today = "2026-10-06";
  const row = (id: number, over: Partial<PackSubject> = {}) => subject({ id, ...over });
  it("counts each page with a pack to send once: waiting for a T-shirt size, or to send, or in memory", () => {
    const list = [
      row(1, { approvedAt: "2026-10-03T09:00:00.000Z" }), // 3 days: to send
      row(2, { approvedAt: "2026-10-04T09:00:00.000Z" }), // 2 days: not yet
      row(3, { approvedAt: "2026-10-01T09:00:00.000Z" }), // sent
      row(4, { status: "new", approvedAt: null, isSporting: true }), // not approved yet: not counted
      row(5, { approvedAt: "2026-09-01T09:00:00.000Z", isSporting: true }), // waiting for a size: only that line
      row(6, { approvedAt: "2026-09-01T09:00:00.000Z", inMemory: true, wants: { ...NONE, envelopeCount: 5 } }), // in memory: its own count
      row(7, { approvedAt: "2026-09-01T09:00:00.000Z", status: "finished" }), // finished: no longer waiting
      row(8, { status: "declined", approvedAt: null, isSporting: true }),
      row(9, { approvedAt: "2026-09-01T09:00:00.000Z", inMemory: true, wants: { ...NONE, envelopeCount: 5 } }), // in memory, sent
      row(10, { approvedAt: "2026-09-01T09:00:00.000Z", isSporting: true }), // waiting for a size, but its pack has gone
      row(11, { approvedAt: "2026-10-05T09:00:00.000Z", isSporting: true }), // approved yesterday, waiting for a size
      row(12, { approvedAt: "2026-09-01T09:00:00.000Z", isSporting: true, tshirtSize: "adult_m" }), // has its size: to send
    ];
    expect(packCounts(list, new Set([3, 9, 10]), today)).toEqual({ packsToSend: 2, tshirtWaiting: 2, memoryToSend: 1 });
  });
  // Review: staff left the waiting T-shirt out with a reason, so the pack no longer waits on the
  // organiser. It is a pack to send (once approved for more than 2 days), not one waiting for a size.
  it("counts a pack whose waiting T-shirt was left out as a pack to send, never as waiting for a size", () => {
    const list = [
      row(5, { approvedAt: "2026-09-01T09:00:00.000Z", isSporting: true }), // left out: to send
      row(11, { approvedAt: "2026-10-05T09:00:00.000Z", isSporting: true }), // left out, approved yesterday: not yet
      row(13, { approvedAt: "2026-09-01T09:00:00.000Z", isSporting: true }), // still waiting
    ];
    expect(packCounts(list, new Set(), today, new Set([5, 11]))).toEqual({ packsToSend: 1, tshirtWaiting: 1, memoryToSend: 0 });
  });
  it("knows a waiting T-shirt left out with a reason, until the pack is sent or the size comes in", () => {
    const waiting = subject({ isSporting: true });
    const leftOut = pack({ items: [{ key: "tshirt", label: "Waiting for T-shirt size", quantity: null, tickedAt: null, tickedBy: "admin:fern@example.com", skippedReason: "They do not want one" }] });
    expect(tshirtLeftOut(waiting, leftOut)).toBe(true);
    expect(tshirtLeftOut(waiting, null)).toBe(false);
    expect(tshirtLeftOut(waiting, pack({ items: [ticked("letter")] }))).toBe(false);
    // The size has come in: the leave out no longer counts, and the pack shows it to be ticked.
    expect(tshirtLeftOut(subject({ isSporting: true, tshirtSize: "adult_m" }), leftOut)).toBe(false);
    expect(tshirtLeftOut(subject(), leftOut)).toBe(false);
  });
});

describe("the requests a pack looks after", () => {
  const base = { today: "2026-10-03", by: "fern@example.com" };
  const row = (kind: string, over: Record<string, unknown> = {}) =>
    ({
      fundraiserId: 9, kind, status: "to_send", quantity: null, quantityBack: null, how: null, sentOn: null, backOn: null, doneOn: null,
      handledBy: null, going: null, note: null, backNote: null, link: null, updatedAt: null, updatedBy: null, ...over,
    }) as never;
  const f = subject({ wants: { ...NONE, posterCount: 12, bucketCount: 2 } });
  const sizes = { a4: 10, a3: 2 };
  const pressed = (type: "tick" | "untick" | "skip", key: string, marked = false) => ({ ...base, press: { type, key }, marked });
  const sendPressed = { ...base, press: { type: "send" as const }, marked: false };
  // Who last changed a request: the pack itself, or a member of staff by hand in Requests.
  const BY_PACK = { updatedBy: "pack:admin:fern@example.com" };
  const BY_HAND = { updatedBy: "admin:ash@example.com" };

  it("marks a request as sent once everything of its kind is ticked, with how many went", () => {
    const one = packView(f, pack({ items: [ticked("posters_a4", 10)] }), sizes)!;
    expect(packRequestSync(one, [], pressed("tick", "posters_a4"))).toEqual([]);
    const both = packView(f, pack({ items: [ticked("posters_a4", 10), ticked("posters_a3", 2)] }), sizes)!;
    expect(packRequestSync(both, [], pressed("tick", "posters_a3"))).toEqual([
      { kind: "posters", input: { action: "send", from: "to_send", on: "2026-10-03", how: "post", by: "fern@example.com", quantity: 12, note: "Sent with the welcome pack." } },
    ]);
  });
  it("counts only what went when part of it was left out", () => {
    const left = { key: "posters_a3", label: "2 A3 posters", quantity: 2, tickedAt: null, tickedBy: "admin:fern@example.com", skippedReason: "No A3 paper" };
    const v = packView(f, pack({ items: [ticked("posters_a4", 10), left] }), sizes)!;
    expect(packRequestSync(v, [], pressed("skip", "posters_a3"))[0]).toMatchObject({ kind: "posters", input: { action: "send", quantity: 10 } });
    // All of it left out: nothing went, so the request stays open.
    const none = packView(f, pack({ items: [{ ...left, key: "posters_a4", label: "10 A4 posters", quantity: 10 }, left] }), sizes)!;
    expect(packRequestSync(none, [], pressed("skip", "posters_a4"))).toEqual([]);
  });
  it("lends buckets and tins: they are with them, to come back", () => {
    const v = packView(f, pack({ items: [ticked("buckets", 2)] }), sizes)!;
    expect(packRequestSync(v, [], pressed("tick", "buckets"))).toEqual([
      { kind: "buckets", input: { action: "out", from: "to_send", on: "2026-10-03", quantity: 2, by: "fern@example.com", note: "Sent with the welcome pack." } },
    ]);
  });
  it("looks only at the request of the thing pressed", () => {
    // Everything ticked, the posters request open (staff undid it by hand in Requests): ticking the
    // letter, or the buckets, does nothing to the posters.
    const all = packView(f, pack({ items: [ticked("letter"), ticked("posters_a4", 10), ticked("posters_a3", 2), ticked("buckets", 2)] }), sizes)!;
    expect(packRequestSync(all, [], pressed("tick", "letter"))).toEqual([]);
    expect(packRequestSync(all, [], pressed("tick", "buckets")).map((s) => s.kind)).toEqual(["buckets"]);
    expect(packRequestSync(all, [row("buckets", { status: "with_them", quantity: 2 })], pressed("tick", "sponsor_form"))).toEqual([]);
  });
  it("never puts back a count staff corrected by hand in Requests", () => {
    // Ticked as 12 (Sent, 12); staff then corrected it to 8 in Requests.
    const all = packView(f, pack({ items: [ticked("letter"), ticked("posters_a4", 10), ticked("posters_a3", 2), ticked("sponsor_form")] }), sizes)!;
    const corrected = [row("posters", { status: "sent", quantity: 8, note: "Sent with the welcome pack." })];
    expect(packRequestSync(all, corrected, pressed("tick", "letter", false))).toEqual([]);
    expect(packRequestSync(all, corrected, pressed("untick", "letter", false))).toEqual([]);
    expect(packRequestSync(all, corrected, sendPressed)).toEqual([]);
  });
  it("never sends again, on another press, a request staff undid by hand", () => {
    const all = packView(f, pack({ items: [ticked("letter"), ticked("posters_a4", 10), ticked("posters_a3", 2)] }), sizes)!;
    expect(packRequestSync(all, [row("posters", { status: "to_send" })], pressed("tick", "letter"))).toEqual([]);
    expect(packRequestSync(all, [row("posters", { status: "to_send" })], pressed("skip", "sponsor_form"))).toEqual([]);
  });
  it("on Pack sent only catches up requests still To send, never a count or an undo", () => {
    const all = packView(f, pack({ items: [ticked("letter"), ticked("posters_a4", 10), ticked("posters_a3", 2), ticked("buckets", 2), ticked("sponsor_form")] }), sizes)!;
    const rows = [row("buckets", { status: "with_them", quantity: 1, note: "Sent with the welcome pack." })];
    expect(packRequestSync(all, rows, sendPressed)).toEqual([
      { kind: "posters", input: { action: "send", from: "to_send", on: "2026-10-03", how: "post", by: "fern@example.com", quantity: 12, note: "Sent with the welcome pack." } },
    ]);
  });
  it("on Pack sent never sends again a request the pack marked once and staff then undid by hand", () => {
    // Posters ticked (the pack marked the request Sent); staff pressed Undo in Requests, so it stands To send.
    const all = packView(f, pack({ items: [ticked("letter"), ticked("posters_a4", 10), ticked("posters_a3", 2), ticked("buckets", 2), ticked("sponsor_form")] }), sizes)!;
    const undone = [row("posters", { status: "to_send" })];
    const steps = packRequestSync(all, undone, { ...sendPressed, markedKinds: new Set(["posters"]) } as never);
    // The buckets, which the pack never marked, are still caught up.
    expect(steps.map((s) => s.kind)).toEqual(["buckets"]);
  });
  it("leaves alone a request staff already dealt with in Requests", () => {
    const v = packView(f, pack({ items: [ticked("buckets", 2)] }), sizes)!;
    expect(packRequestSync(v, [row("buckets", { status: "with_them", quantity: 2, note: null })], pressed("tick", "buckets"))).toEqual([]);
    expect(packRequestSync(v, [row("buckets", { status: "back", quantity: 2 })], pressed("tick", "buckets"))).toEqual([]);
  });
  it("opens the request again when its tick is taken off, but only one the pack marked", () => {
    const v = packView(f, pack({ items: [ticked("posters_a4", 10)] }), sizes)!;
    const sent = [row("posters", { status: "sent", quantity: 12, note: "Sent with the welcome pack.", ...BY_PACK })];
    expect(packRequestSync(v, sent, pressed("untick", "posters_a3", true))).toEqual([{ kind: "posters", input: { action: "undo", from: "sent" } }]);
    // Whatever its note says, one the pack did not mark stays as staff left it.
    expect(packRequestSync(v, sent, pressed("untick", "posters_a3", false))).toEqual([]);
  });
  it("puts how many went right when the press re-ticks a thing of that kind, and only then", () => {
    const more = subject({ wants: { ...NONE, posterCount: 12 } });
    const v = packView(more, pack({ items: [ticked("posters_a4", 12)] }))!;
    const marked = [row("posters", { status: "sent", quantity: 10, note: "Sent with the welcome pack.", ...BY_PACK })];
    expect(packRequestSync(v, marked, pressed("tick", "posters_a4", true))).toEqual([{ kind: "posters", input: { action: "count", from: "sent", quantity: 12 } }]);
    expect(packRequestSync(v, [row("posters", { status: "sent", quantity: 12 })], pressed("tick", "posters_a4", true))).toEqual([]);
    // Never one the pack did not mark.
    expect(packRequestSync(v, marked, pressed("tick", "posters_a4", false))).toEqual([]);
  });
  // Review: both sizes ticked (the pack marked Posters Sent, 12). Staff pressed Undo in Requests,
  // unticked the A4 posters, then marked Posters Sent by hand, with 8. The pack's mark is still on its
  // rows, but the request as it stands is staff's own: the pack never changes it.
  it("never changes the count of a request staff sent again by hand, when its thing is ticked again", () => {
    const both = packView(f, pack({ items: [ticked("posters_a4", 10), ticked("posters_a3", 2)] }), sizes)!;
    const byHand = [row("posters", { status: "sent", quantity: 8, how: "dropped_off", ...BY_HAND })];
    expect(packRequestSync(both, byHand, pressed("tick", "posters_a4", true))).toEqual([]);
    // The same press on one the pack itself last changed does put the count right.
    const byPack = [row("posters", { status: "sent", quantity: 8, ...BY_PACK })];
    expect(packRequestSync(both, byPack, pressed("tick", "posters_a4", true))).toEqual([{ kind: "posters", input: { action: "count", from: "sent", quantity: 12 } }]);
  });
  // Review: both sizes ticked (Sent, 12). Staff press Undo in Requests. The A4 posters are unticked
  // and ticked again: the request staff undid by hand stays To send.
  it("never sends again a request staff undid by hand, when its thing is ticked again", () => {
    const both = packView(f, pack({ items: [ticked("posters_a4", 10), ticked("posters_a3", 2)] }), sizes)!;
    const undone = [row("posters", { status: "to_send", ...BY_HAND })];
    expect(packRequestSync(both, undone, pressed("tick", "posters_a4", true))).toEqual([]);
    expect(packRequestSync(both, undone, pressed("skip", "posters_a3", true))).toEqual([]);
    // One the pack itself opened again (a tick came off) is sent again when the tick goes back.
    const byPack = [row("posters", { status: "to_send", ...BY_PACK })];
    expect(packRequestSync(both, byPack, pressed("tick", "posters_a4", false)).map((s) => s.input.action)).toEqual(["send"]);
    // And one the pack never marked is marked as before, whoever touched it last.
    expect(packRequestSync(both, undone, pressed("tick", "posters_a4", false)).map((s) => s.input.action)).toEqual(["send"]);
  });
  it("never opens again a request staff sent again by hand, when a tick comes off", () => {
    const one = packView(f, pack({ items: [ticked("posters_a3", 2)] }), sizes)!;
    const byHand = [row("posters", { status: "sent", quantity: 8, ...BY_HAND })];
    expect(packRequestSync(one, byHand, pressed("untick", "posters_a4", true))).toEqual([]);
    // Nor one from before the pack said who last changed it: left as it is.
    expect(packRequestSync(one, [row("posters", { status: "sent", quantity: 8 })], pressed("untick", "posters_a4", true))).toEqual([]);
  });
  // Review: A4 10 and A3 2 both ticked (Sent, 12). Staff then leave the A3 posters out: 10 went.
  it("puts how many went right when one size is left out after both went", () => {
    const left = { key: "posters_a3", label: "2 A3 posters", quantity: 2, tickedAt: null, tickedBy: "admin:fern@example.com", skippedReason: "No A3 paper" };
    const v = packView(f, pack({ items: [ticked("posters_a4", 10), left] }), sizes)!;
    const sent = [row("posters", { status: "sent", quantity: 12, ...BY_PACK })];
    expect(packRequestSync(v, sent, pressed("skip", "posters_a3", true))).toEqual([{ kind: "posters", input: { action: "count", from: "sent", quantity: 10 } }]);
    // Never on one the pack did not mark, or one staff changed by hand since.
    expect(packRequestSync(v, sent, pressed("skip", "posters_a3", false))).toEqual([]);
    expect(packRequestSync(v, [row("posters", { status: "sent", quantity: 12, ...BY_HAND })], pressed("skip", "posters_a3", true))).toEqual([]);
    // Leaving out something else changes nothing.
    expect(packRequestSync(v, sent, pressed("skip", "sponsor_form", true))).toEqual([]);
  });
  it("in memory says what it went with", () => {
    const m = subject({ inMemory: true, wants: { ...NONE, envelopeCount: 30 } });
    const v = packView(m, pack({ items: [ticked("envelopes", 30)] }))!;
    expect(packRequestSync(v, [], pressed("tick", "envelopes"))[0]).toMatchObject({ kind: "envelopes", input: { action: "send", quantity: 30, note: "Sent with the things they asked for." } });
  });
});
