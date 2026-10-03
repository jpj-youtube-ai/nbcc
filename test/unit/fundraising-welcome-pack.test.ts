import { describe, it, expect } from "vitest";
import {
  applyPackAction,
  coveringNote,
  organiserPackLine,
  packActionSchema,
  packAddress,
  packCounts,
  packItems,
  packKind,
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
const ticked = (key: string, quantity: number | null = null, label = key) => ({
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
  it("always has the welcome letter, and a sponsor form for someone raising money", () => {
    expect(keys(subject())).toEqual(["letter", "sponsor_form"]);
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
    expect(posters).toMatchObject({ ticked: false, done: false, changedFrom: 4 });
    expect(v.state).toBe("to_pack");
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
          { key: "tshirt", label: "NBCC T-shirt", quantity: null, tickedAt: null, tickedBy: "admin:fern@example.com", skippedReason: "Sending it later" },
        ],
      }),
    )!;
    expect(left.state).toBe("ready");
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
  const act = (stored: StoredPack | null, input: unknown, s = f) => applyPackAction(packView(s, stored)!, packActionSchema.parse(input));
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
    expect(packActionSchema.safeParse({ action: "skip", key: "sponsor_form", reason: "  " }).success).toBe(false);
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
  it("in memory speaks of things to send", () => {
    const m = subject({ inMemory: true, wants: { ...NONE, envelopeCount: 30 } });
    expect(act(pack({ items: [ticked("letter"), ticked("envelopes", 30)] }), { action: "send" }, m)).toMatchObject({ ok: true, words: "Things to send: sent" });
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
  it("counts welcome packs approved more than 2 days ago and not sent, and who waits for a T-shirt size", () => {
    const list = [
      row(1, { approvedAt: "2026-10-03T09:00:00.000Z" }), // 3 days: counts
      row(2, { approvedAt: "2026-10-04T09:00:00.000Z" }), // 2 days: not yet
      row(3, { approvedAt: "2026-10-01T09:00:00.000Z" }), // sent
      row(4, { status: "new", approvedAt: null, isSporting: true }), // waiting for a size, no pack yet
      row(5, { approvedAt: "2026-09-01T09:00:00.000Z", isSporting: true }), // both
      row(6, { approvedAt: "2026-09-01T09:00:00.000Z", inMemory: true, wants: { ...NONE, envelopeCount: 5 } }), // in memory: not a welcome pack
      row(7, { approvedAt: "2026-09-01T09:00:00.000Z", status: "finished" }), // finished: no longer waiting
      row(8, { status: "declined", approvedAt: null, isSporting: true }),
    ];
    expect(packCounts(list, new Set([3]), today)).toEqual({ packsToSend: 2, tshirtWaiting: 2 });
  });
});
