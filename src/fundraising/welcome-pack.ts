import { z } from "zod";
import { londonToday } from "../events/model";
import { dateParts } from "../events/render";
import { addDays } from "./follow-up";
import { FLOW, KIND_INFO, parseWants, type RequestActionInput, type RequestKind, type RequestRow } from "./requests";
import { tshirtLabel } from "./signup-tidy";
import type { FundraiserRecord } from "./model";

// Welcome packs (Jaimie, 2026-10-03). Pure: no pool, no clock. The SQL is in src/db/welcome-packs.ts,
// the routes in src/routes/admin-welcome-packs.ts, the printed letter in ./welcome-pack-print.ts.
//
// Every approved fundraiser and event host gets a welcome pack in the post. What is in it is worked
// out from their sign up each time, only what applies to that page:
//
//   the welcome letter     always
//   what they asked for    posters (by size), leaflets, printed QR codes, collection envelopes,
//                          buckets and tins, in the numbers they asked for (fundraisers.wants)
//   the paper sponsor form a sponsorship fundraiser: a sporting event, a team organiser's page, or
//                          anyone raising money who asked for one. Never a bake sale or a coffee
//                          morning, an event, or a page in memory of someone.
//   the NBCC T-shirt       a sporting event, in the size they chose. With no size yet it shows
//                          "Waiting for T-shirt size", and cannot be ticked.
//
// A page in memory of someone has no welcome pack and no T-shirt. It has "Things to send" instead:
// exactly what they asked for, with a gentle covering note in place of the letter, and nothing at
// all when they asked for nothing. A team member's page has none either: it gave no address.
//
// Staff tick each thing as it goes in (who, and when), or leave it out with a reason. Once every
// thing is ticked or left out the pack is Ready to send, and "Pack sent" records the date and who.
// Undo takes Sent back. To pack, Part packed, Ready to send, Sent.
//
// A tick is kept with what the thing was called when it was made ("10 A4 posters", "NBCC T-shirt,
// Adult M"): if the sign up has changed since (another number, another size, another split between
// A4 and A3), the tick no longer counts, and the list says what it was ticked for. Once a pack is
// Sent it stays Sent: a later change shows a small "Changed since it was sent" flag instead.
//
// Ticking something they asked for also marks its request as done in Requests (posters and the like
// Sent, buckets and tins With them), and taking the tick off opens it again (packRequestSync).

export type PackKind = "welcome" | "memory";
export type PackState = "to_pack" | "part" | "ready" | "sent";

export const PACK_STATE_LABELS: Record<PackState, string> = {
  to_pack: "To pack",
  part: "Part packed",
  ready: "Ready to send",
  sent: "Sent",
};
export const PACK_TITLES: Record<PackKind, string> = { welcome: "Welcome pack", memory: "Things to send" };
export const MEMORY_ADDRESS_NOTE = "This can be the funeral director's address.";
export const REASON_MAX = 200;
export const SIGNER_MAX = 100;
export const SIGNER_ROLE_MAX = 200;
/** The Monday summary counts a pack once its page has been approved for more than this many days. */
export const PACK_OVERDUE_DAYS = 2;

export const PHONE = "01292 811 015";
export const EMAIL = "events@nbcc.scot";
export const PRIVATE_AREA = "nbcc.scot/fundraise/manage";
export const HELP_PAGE = "nbcc.scot/fundraise/help";
const CHARITY = "Night Before Christmas Campaign";

/** The parts of a sign up a pack depends on. */
export type PackSubject = Pick<
  FundraiserRecord,
  | "id"
  | "status"
  | "path"
  | "public"
  | "title"
  | "slug"
  | "name"
  | "wants"
  | "postAddress"
  | "postLine1"
  | "postLine2"
  | "postTown"
  | "postPostcode"
  | "approvedAt"
  | "firstName"
  | "lastName"
  | "inMemory"
  | "teamId"
  | "isTeam"
  | "socialOk"
  | "eventDate"
  | "isSporting"
  | "tshirtSize"
  | "memoryName"
  | "memorySetupBy"
  | "memoryDirectorBusiness"
>;

/** A welcome pack, things to send (in memory), or no pack at all. */
export function packKind(f: PackSubject): PackKind | null {
  if (f.status !== "approved" && f.status !== "finished") return null;
  if (f.teamId) return null;
  if (f.inMemory === true) return memoryAsks(f).length ? "memory" : null;
  return "welcome";
}

export interface PackItem {
  key: string;
  /** What it is, for many: "A4 posters". Kept with a tick. */
  label: string;
  quantity: number | null;
  /** As the list says it: "10 A4 posters", "Welcome letter", "Waiting for T-shirt size". */
  words: string;
  /** Waiting on the organiser (their T-shirt size): it cannot be ticked. */
  waiting: boolean;
  /** As the welcome letter lists it; null for the letter itself. */
  inLetter: string | null;
}

/** The poster sizes of their last "Ask us to print these", when they asked that way. */
export type PosterSizes = { a4: number; a3: number };

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function asked(key: string, n: number, one: string, many: string): PackItem {
  const words = counted(n, one, many);
  return { key, label: many.charAt(0).toUpperCase() + many.slice(1), quantity: n, words, waiting: false, inLetter: words };
}

/** What they asked for that goes in the post, in a fixed order. */
function askedItems(f: PackSubject, sizes: PosterSizes | null | undefined, memory: boolean): PackItem[] {
  const w = parseWants(f.wants);
  const items: PackItem[] = [];
  if (w.posterCount > 0) {
    const split = sizes && sizes.a4 >= 0 && sizes.a3 >= 0 && sizes.a4 + sizes.a3 === w.posterCount ? sizes : { a4: w.posterCount, a3: 0 };
    if (split.a4 > 0) items.push(asked("posters_a4", split.a4, "A4 poster", "A4 posters"));
    if (split.a3 > 0) items.push(asked("posters_a3", split.a3, "A3 poster", "A3 posters"));
  }
  if (w.leafletCount > 0) items.push(asked("leaflets", w.leafletCount, "A5 leaflet", "A5 leaflets"));
  if (w.leaflets > 0) items.push(asked("leaflets_or_posters", w.leaflets, "leaflet or poster", "leaflets or posters"));
  const qr = w.qrCount ?? 0;
  if (qr > 0) {
    items.push(memory ? asked("qr_codes", qr, "QR card for the order of service", "QR cards for the order of service") : asked("qr_codes", qr, "printed QR code", "printed QR codes"));
  }
  const envelopes = w.envelopeCount ?? 0;
  if (envelopes > 0) items.push(asked("envelopes", envelopes, "collection envelope", "collection envelopes"));
  if (w.bucketCount > 0) items.push(asked("buckets", w.bucketCount, "collection bucket", "collection buckets"));
  if (w.tinCount > 0) items.push(asked("tins", w.tinCount, "collection tin", "collection tins"));
  if (w.buckets > 0) items.push(asked("buckets_or_tins", w.buckets, "bucket or tin", "buckets or tins"));
  return items;
}

const memoryAsks = (f: PackSubject) => askedItems(f, null, true);

/** Sport and the T-shirt are for a page of someone's own raising money (as src/db/fundraiser-signup-tidy.ts). */
const sportApplies = (f: PackSubject) => f.path === "raising" && f.inMemory !== true && !f.teamId;

/**
 * Is it a sponsorship fundraiser? Someone raising money (never an event, never in memory) for a
 * sporting event, or as a team's organiser, or who asked us for a sponsor form. A bake sale or a
 * coffee morning has no sponsors, so no form.
 */
function sponsorship(f: PackSubject): boolean {
  if (f.path !== "raising" || f.inMemory === true) return false;
  const raw = (f.wants && typeof f.wants === "object" ? f.wants : {}) as Record<string, unknown>;
  const askedForOne = raw.sponsorForm === true || Number(raw.sponsorFormCount) > 0;
  return f.isSporting === true || f.isTeam === true || askedForOne;
}

/** Everything in this page's pack, in the order it is packed. Empty when it has no pack. */
export function packItems(f: PackSubject, sizes?: PosterSizes | null): PackItem[] {
  const kind = packKind(f);
  if (!kind) return [];
  if (kind === "memory") {
    return [{ key: "letter", label: "Covering note", quantity: null, words: "Covering note", waiting: false, inLetter: null }, ...askedItems(f, sizes, true)];
  }
  const items: PackItem[] = [
    { key: "letter", label: "Welcome letter", quantity: null, words: "Welcome letter", waiting: false, inLetter: null },
    ...askedItems(f, sizes, false),
  ];
  if (sponsorship(f)) {
    items.push({ key: "sponsor_form", label: "Sponsor form", quantity: null, words: "Sponsor form", waiting: false, inLetter: "a paper sponsor form" });
  }
  if (sportApplies(f) && f.isSporting === true) {
    const size = tshirtLabel(f.tshirtSize);
    items.push(
      size
        ? { key: "tshirt", label: "NBCC T-shirt", quantity: null, words: `NBCC T-shirt, ${size}`, waiting: false, inLetter: `your NBCC T-shirt, size ${size}` }
        : { key: "tshirt", label: "NBCC T-shirt", quantity: null, words: "Waiting for T-shirt size", waiting: true, inLetter: null },
    );
  }
  return items;
}

/** Who it goes to, and each line of the address they gave (none when they gave none). */
export function packAddress(f: PackSubject): { name: string; lines: string[] } {
  const tidy = (v: string | null | undefined) => String(v ?? "").trim();
  const name = [tidy(f.firstName), tidy(f.lastName)].filter(Boolean).join(" ") || tidy(f.name);
  const boxes = [f.postLine1, f.postLine2, f.postTown, f.postPostcode].map(tidy).filter(Boolean);
  // The single address box of a sign up made before the four boxes.
  const lines = boxes.length ? boxes : tidy(f.postAddress).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return { name, lines };
}

// --- as stored -------------------------------------------------------------------------------------

export interface StoredItem {
  key: string;
  label: string;
  quantity: number | null;
  tickedAt: string | null;
  /** Who ticked it, or left it out. */
  tickedBy: string | null;
  skippedReason: string | null;
}

export interface StoredPack {
  sentAt: string | null;
  sentBy: string | null;
  signer: string | null;
  signerRole: string | null;
  items: StoredItem[];
}

// --- as staff see it -------------------------------------------------------------------------------

export interface PackItemView extends PackItem {
  tickable: boolean;
  ticked: boolean;
  tickedAt: string | null;
  tickedBy: string | null;
  skippedReason: string | null;
  /** Ticked, or left out with a reason. */
  done: boolean;
  /**
   * The sign up has changed since this was ticked, in words. Before the pack is sent the tick no
   * longer counts ("needs ticking again"); after, it is only a flag. Null when nothing changed.
   */
  changeNote: string | null;
}

export interface PackView {
  kind: PackKind;
  title: string;
  state: PackState;
  stateLabel: string;
  items: PackItemView[];
  address: { name: string; lines: string[] };
  addressNote: string | null;
  canSend: boolean;
  /** Sent, and the sign up has changed since: a flag, never a reason to tick again. */
  changedSinceSent: boolean;
  sentAt: string | null;
  sentBy: string | null;
  signer: string | null;
  signerRole: string | null;
}

/** One page's pack as staff see it; null when it has none. */
/** "Adult M" from "NBCC T-shirt, Adult M". */
const sizeOf = (words: string) => words.replace(/^NBCC T-shirt,\s*/, "");

/** What a tick that no longer counts says of itself. */
function needsTickingAgain(item: PackItem, was: string): string {
  if (item.key === "tshirt") return `It was ticked for size ${sizeOf(was)}. They now want ${sizeOf(item.words)}, so it needs ticking again.`;
  return `It was ticked for ${was}. They now want ${item.words}, so it needs ticking again.`;
}

/** One page's pack as staff see it; null when it has none. */
export function packView(f: PackSubject, stored: StoredPack | null, sizes?: PosterSizes | null): PackView | null {
  const kind = packKind(f);
  if (!kind) return null;
  const sent = !!stored?.sentAt;
  const byKey = new Map((stored?.items ?? []).map((i) => [i.key, i]));
  const now = packItems(f, sizes);
  const items: PackItemView[] = now.map((item) => {
    const s = byKey.get(item.key) ?? null;
    const skippedReason = s?.skippedReason ?? null;
    // A tick counts while the thing is still what it was when ticked: the same words, the same number.
    const same = !!s && s.label === item.words && (s.quantity ?? null) === (item.quantity ?? null);
    const wasTicked = !!s?.tickedAt;
    // Once sent it went as it was ticked: a later change is flagged, never unticked.
    const ticked = sent ? wasTicked : wasTicked && !item.waiting && same;
    let changeNote: string | null = null;
    if (sent) {
      if (!s) changeNote = "Asked for since it was sent.";
      else if (wasTicked && !same) changeNote = `Changed since it was sent: it went as ${s.label}.`;
    } else if (wasTicked && !item.waiting && !same) {
      changeNote = needsTickingAgain(item, s!.label);
    }
    return {
      ...item,
      tickable: !item.waiting,
      ticked,
      tickedAt: ticked ? s!.tickedAt : null,
      tickedBy: ticked || skippedReason ? (s?.tickedBy ?? null) : null,
      skippedReason,
      done: ticked || !!skippedReason,
      changeNote,
    };
  });
  const done = items.filter((i) => i.done).length;
  const state: PackState = sent ? "sent" : done === items.length ? "ready" : done > 0 ? "part" : "to_pack";
  // Something that went in the pack and is no longer in the sign up counts as a change too.
  const gone = (stored?.items ?? []).some((i) => i.tickedAt && !now.some((n) => n.key === i.key));
  return {
    kind,
    title: PACK_TITLES[kind],
    state,
    stateLabel: PACK_STATE_LABELS[state],
    items,
    address: packAddress(f),
    addressNote: kind === "memory" ? MEMORY_ADDRESS_NOTE : null,
    canSend: state === "ready",
    changedSinceSent: sent && (gone || items.some((i) => i.changeNote !== null)),
    sentAt: sent ? stored!.sentAt : null,
    sentBy: sent ? stored!.sentBy : null,
    signer: stored?.signer ?? null,
    signerRole: stored?.signer ? (stored.signerRole ?? null) : null,
  };
}

// --- what each press changes -----------------------------------------------------------------------

const key = z.string().trim().min(1).max(40);
export const packActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("tick"), key }).strict(),
  z.object({ action: z.literal("untick"), key }).strict(),
  z
    .object({
      action: z.literal("skip"),
      key,
      reason: z
        .string({ required_error: "Say why it is being left out." })
        .trim()
        .min(1, "Say why it is being left out.")
        .max(REASON_MAX, `Keep the reason to ${REASON_MAX} characters or fewer.`),
    })
    .strict(),
  z.object({ action: z.literal("send") }).strict(),
  z.object({ action: z.literal("undo") }).strict(),
  z
    .object({
      action: z.literal("signer"),
      name: z.string({ required_error: "Choose who signs it." }).trim().min(1, "Choose who signs it.").max(SIGNER_MAX),
      role: z.preprocess((v) => (typeof v === "string" && v.trim() ? v : null), z.string().trim().max(SIGNER_ROLE_MAX).nullable()).optional(),
    })
    .strict(),
]);
export type PackActionInput = z.infer<typeof packActionSchema>;

export type PackChange =
  | { type: "tick"; key: string; label: string; quantity: number | null }
  | { type: "skip"; key: string; label: string; quantity: number | null; reason: string }
  | { type: "untick"; key: string }
  | { type: "send" }
  | { type: "undo" }
  | { type: "signer"; name: string; role: string | null };

/** `change` is null when the press leaves the pack exactly as it stands: nothing is written or recorded. */
export type PackActionResult =
  | { ok: true; change: PackChange | null; words: string }
  | { ok: false; reason: "not_found" | "conflict"; message: string };

export const PACK_SENT_ALREADY = "This has been marked as sent. Press Undo first to change it.";
export const PACK_NOT_READY = "Tick everything, or leave it out with a reason, before marking it as sent.";
export const PACK_WAITING_SIZE = "We are waiting for their T-shirt size. Ask them for it, or leave the T-shirt out with a reason.";
export const PACK_NOT_IN_IT = "That is not in this pack. Have another look: it may have changed.";

/** What one press does to a pack as it stands. The words go in the fundraiser's History. */
export function applyPackAction(view: PackView, input: PackActionInput): PackActionResult {
  const head = view.title;
  const refuse = (reason: "not_found" | "conflict", message: string): PackActionResult => ({ ok: false, reason, message });
  const nothing: PackActionResult = { ok: true, change: null, words: "" };
  if (input.action === "signer") {
    const role = input.role ?? null;
    if (view.signer === input.name && (view.signerRole ?? null) === role) return nothing;
    const what = view.kind === "memory" ? "note" : "letter";
    return { ok: true, change: { type: "signer", name: input.name, role }, words: `${head}: the ${what} is signed by ${input.name}` };
  }
  if (input.action === "undo") {
    if (view.state !== "sent") return refuse("conflict", "It has not been marked as sent.");
    return { ok: true, change: { type: "undo" }, words: `${head}: Sent undone` };
  }
  if (view.state === "sent") return refuse("conflict", PACK_SENT_ALREADY);
  if (input.action === "send") {
    if (!view.canSend) return refuse("conflict", PACK_NOT_READY);
    return { ok: true, change: { type: "send" }, words: view.kind === "memory" ? `${head}: sent` : `${head} sent` };
  }
  const item = view.items.find((i) => i.key === input.key);
  if (!item) return refuse("not_found", PACK_NOT_IN_IT);
  // In the History a waiting T-shirt is named for what it is, not for what the list says of it.
  const named = item.waiting ? item.label : item.words;
  if (input.action === "tick") {
    if (!item.tickable) return refuse("conflict", PACK_WAITING_SIZE);
    if (item.ticked) return nothing;
    // Kept with the words the list says now, so a later change of number or size is noticed.
    return { ok: true, change: { type: "tick", key: item.key, label: item.words, quantity: item.quantity }, words: `${head}: ${named} ticked` };
  }
  if (input.action === "skip") {
    if (item.skippedReason === input.reason) return nothing;
    return {
      ok: true,
      change: { type: "skip", key: item.key, label: item.words, quantity: item.quantity, reason: input.reason },
      words: `${head}: ${named} left out (${input.reason})`,
    };
  }
  // Nothing to take off: never ticked or left out (a tick that no longer counts still has its row).
  if (!item.ticked && !item.skippedReason && !item.changeNote) return nothing;
  return { ok: true, change: { type: "untick", key: item.key }, words: `${head}: ${named} unticked` };
}

// --- the requests a pack looks after (Jaimie, WP3) -------------------------------------------------
//
// What they asked for is also tracked in Requests (./requests.ts). The pack keeps the two in step:
// once every thing of a kind that is going has its tick, the request is marked as it would be by
// hand (posters and the like Sent by post; buckets and tins With them), with how many went and a note
// saying it went with the pack. Take a tick off and a request the pack marked opens again; one staff
// dealt with by hand in Requests is never touched. Pure: the SQL applies each step with the Requests'
// own rules and audit (src/db/welcome-packs.ts).

/** Which request each thing in a pack belongs to. Both poster sizes are the one posters request. */
export const PACK_REQUEST_KIND: Readonly<Record<string, RequestKind>> = {
  posters_a4: "posters",
  posters_a3: "posters",
  leaflets: "leaflets",
  leaflets_or_posters: "leaflets_or_posters",
  qr_codes: "qr_codes",
  envelopes: "envelopes",
  buckets: "buckets",
  tins: "tins",
  buckets_or_tins: "buckets_or_tins",
};
export const PACK_REQUEST_NOTES: Record<PackKind, string> = {
  welcome: "Sent with the welcome pack.",
  memory: "Sent with the things they asked for.",
};
const PACK_NOTES: ReadonlySet<string> = new Set(Object.values(PACK_REQUEST_NOTES));

export interface PackRequestStep {
  kind: RequestKind;
  input: RequestActionInput;
}

/** The steps that bring the requests in line with the pack as it stands. `by` is who is ticking. */
export function packRequestSync(view: PackView, rows: RequestRow[], o: { today: string; by: string }): PackRequestStep[] {
  const steps: PackRequestStep[] = [];
  const kinds = [...new Set(view.items.map((i) => PACK_REQUEST_KIND[i.key]).filter((k): k is RequestKind => !!k))];
  for (const kind of kinds) {
    const going = view.items.filter((i) => PACK_REQUEST_KIND[i.key] === kind && !i.skippedReason);
    const allIn = going.length > 0 && going.every((i) => i.ticked);
    const group = KIND_INFO[kind].group;
    const flow = FLOW[group];
    const row = rows.find((r) => r.kind === kind && (flow as readonly string[]).includes(r.status)) ?? null;
    const status = row?.status ?? flow[0];
    const note = PACK_REQUEST_NOTES[view.kind];
    const quantity = going.reduce((n, i) => n + (i.quantity ?? 0), 0);
    const byThePack = !!row && row.note !== null && PACK_NOTES.has(row.note);
    if (allIn && group === "printed" && status === "sent" && byThePack && quantity > 0 && row!.quantity !== quantity) {
      // Ticked again after they asked for a different number: how many went is put right.
      steps.push({ kind, input: { action: "count", from: "sent", quantity } });
    } else if (allIn && status === flow[0]) {
      if (quantity < 1) continue;
      steps.push(
        group === "lent"
          ? { kind, input: { action: "out", from: "to_send", on: o.today, quantity, by: o.by, note } }
          : { kind, input: { action: "send", from: "to_send", on: o.today, how: "post", by: o.by, quantity, note } },
      );
    } else if (!allIn && byThePack && status === flow[1]) {
      steps.push({ kind, input: { action: "undo", from: status } });
    }
  }
  return steps;
}

// --- the words of the letter (a DRAFT for Jaimie to approve) --------------------------------------

export interface Signer {
  name: string;
  role: string | null;
}

export interface LetterWords {
  greeting: string;
  /** The fundraiser's title, as a heading under the greeting. */
  heading: string;
  /** Thank you, then where their page is (only when it is up). */
  opening: string[];
  packIntro: string | null;
  packList: string[];
  closing: string[];
  signOff: string;
  signer: string;
  /** Under the signature: their title, and the charity unless the title already names it. */
  signerLines: string[];
}

/** "Robin" from the first name they gave, or the first word of an old single name. */
export function packFirstName(f: Pick<PackSubject, "firstName" | "name">): string {
  return String(f.firstName ?? "").trim() || String(f.name ?? "").trim().split(/\s+/)[0] || "";
}

function signerLines(signer: Signer): string[] {
  const role = String(signer.role ?? "").trim();
  if (!role) return [CHARITY];
  return role.toLowerCase().includes(CHARITY.toLowerCase()) ? [role] : [role, CHARITY];
}

const FAMILY = "You're now part of the NBCC family, and we're so glad to have you.";
const WHO_WE_HELP = "helps the children, young people and vulnerable adults we support, all year round. Thank you.";
const ANYTHING =
  `If you need anything at all, more posters, a collection bucket, or just a chat, call us on ${PHONE} or email ${EMAIL}. ` +
  `We're here to help. You'll also find tips and answers at ${HELP_PAGE}.`;

/**
 * The welcome letter. `items` is what is going in the pack (leave out anything staff left out);
 * `pageWords` is the page's address as people would type it, or null when it has no page.
 */
export function welcomeLetter(f: PackSubject, items: PackItem[], signer: Signer, pageWords: string | null): LetterWords {
  const event = f.path === "event";
  const packList = items.filter((i) => !i.waiting && i.inLetter).map((i) => i.inLetter as string);
  const opening = [
    `Thank you so much for choosing to ${event ? "hold an event" : "raise money"} for the ${CHARITY}. ${FAMILY}`,
  ];
  if (pageWords) {
    opening.push(`Your ${event ? "event's page" : "page"} is live at ${pageWords}. Scan the code to see it, and share it with everyone you know.`);
  }
  return {
    greeting: `Dear ${packFirstName(f)},`,
    heading: f.title,
    opening,
    packIntro: packList.length ? "In this pack you'll find:" : null,
    packList,
    closing: [
      event
        ? `When people give on your event's page, it shows your total. If you collect cash on the day, you can pay it in from your private area at ${PRIVATE_AREA}.`
        : `When the money starts coming in, your page shows your total. If you collect cash, you can pay it in from your private area at ${PRIVATE_AREA}.`,
      ANYTHING,
      `Every pound ${event ? "your event raises" : "you raise"} ${WHO_WE_HELP}`,
    ],
    signOff: "With warmest wishes,",
    signer: signer.name,
    signerLines: signerLines(signer),
  };
}

export interface NoteWords {
  greeting: string;
  paragraphs: string[];
  signOff: string;
  signer: string;
  signerLines: string[];
}

/** In memory: the gentle covering note that goes with what they asked for. Never the welcome letter. */
export function coveringNote(f: PackSubject, signer: Signer): NoteWords {
  const name = String(f.memoryName ?? "").trim();
  return {
    greeting: `Dear ${packFirstName(f)},`,
    paragraphs: [
      name ? `Here are the things you asked for, for ${name}'s page.` : "Here are the things you asked for.",
      `If there is anything else we can do, please call us on ${PHONE} or email ${EMAIL}.`,
    ],
    signOff: "With warmest thoughts,",
    signer: signer.name,
    signerLines: signerLines(signer),
  };
}

// --- the organiser's own line -----------------------------------------------------------------------

/**
 * In their private area: a small line once it has been sent, with the UK day, and nothing before.
 * Never who sent it, or what staff ticked.
 */
export function organiserPackLine(f: PackSubject, stored: Pick<StoredPack, "sentAt"> | null): string | null {
  const kind = packKind(f);
  if (!kind || !stored?.sentAt) return null;
  const p = dateParts(londonToday(new Date(stored.sentAt)));
  const day = `${p.day} ${p.month} ${p.year}`;
  return kind === "memory" ? `The things you asked for are on their way. We posted them on ${day}.` : `Your welcome pack is on its way. We posted it on ${day}.`;
}

// --- the counts, for the Monday summary -----------------------------------------------------------

export interface PackCounts {
  /** Welcome packs for pages approved more than 2 days ago, not yet sent. */
  packsToSend: number;
  /** Of the welcome packs still to send, the sporting events still waiting for a T-shirt size. */
  tshirtWaiting: number;
  /** In memory pages approved more than 2 days ago with things to send, not yet sent. */
  memoryToSend: number;
}

/** Is this page's pack still to send? Approved (a finished one is past it), with a pack, not sent. */
export function packToSend(f: PackSubject, sent: ReadonlySet<number>): boolean {
  return f.status === "approved" && packKind(f) !== null && !sent.has(f.id);
}

export function packCounts(list: PackSubject[], sent: ReadonlySet<number>, today: string): PackCounts {
  const before = addDays(today, -PACK_OVERDUE_DAYS);
  const counts: PackCounts = { packsToSend: 0, tshirtWaiting: 0, memoryToSend: 0 };
  for (const f of list) {
    // Only an approved page has a pack to send: a new sign up is not counted, nor one whose pack has gone.
    if (!packToSend(f, sent)) continue;
    const overdue = !!f.approvedAt && londonToday(new Date(f.approvedAt)) < before;
    if (packKind(f) === "memory") {
      if (overdue) counts.memoryToSend += 1;
      continue;
    }
    if (overdue) counts.packsToSend += 1;
    if (sportApplies(f) && f.isSporting === true && !tshirtLabel(f.tshirtSize)) counts.tshirtWaiting += 1;
  }
  return counts;
}
