import { z } from "zod";
import { MAX_BUCKETS, MAX_LEAFLETS, type FundraiserRecord, type Wants } from "./model";
import { addDays } from "./follow-up";

// TASK-505: what an organiser asked us for on the sign up form (fundraisers.wants), tracked to done.
// Pure: no pool, no clock. Today is passed in as a UK day (YYYY-MM-DD), so the clocks changing never
// moves a date and comparing two dates is comparing two strings. The SQL is in
// src/db/fundraising-requests.ts, the routes in src/routes/admin-fundraising-requests.ts.
//
//   posters, leaflets           To send, then Sent (posted or dropped off, the date, who, how many,
//   (and the old combined ask)  an optional note). Staff can change how many were actually sent.
//   buckets, tins               lent and tracked: To send, With them (the date, how many, who), then
//   (and the old combined ask)  Back (the date, how many came back, an optional note on the money
//                               inside or any missing). Due back two weeks after the fundraiser's
//                               date, or four weeks after they went out when it has no date.
//   a social media shout out    To do, then Done (the date, who, an optional link to the post). Only
//                               with their permission (socialOk); without it, nothing to do.
//   someone to come along       To arrange, Arranged (who is going, an optional note), then Done.
//
// A request needs no row until staff first act on it: with none it is at its first step, so sign ups
// from before this need no backfill. Forward one step at a time; the only way back is Undo, one step.

export const REQUEST_KINDS = ["posters", "leaflets", "leaflets_or_posters", "buckets", "tins", "buckets_or_tins", "shout_out", "attend"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export type RequestGroup = "printed" | "lent" | "shout_out" | "attend";

export const REQUEST_STATUSES = ["to_send", "sent", "with_them", "back", "to_do", "done", "to_arrange", "arranged"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_ACTIONS = ["send", "out", "back", "done", "arrange", "count", "undo"] as const;
export type RequestAction = (typeof REQUEST_ACTIONS)[number];

export const SEND_HOW = ["post", "dropped_off"] as const;
export type SendHow = (typeof SEND_HOW)[number];

/** Each kind: its group, its name, and the key in fundraisers.wants it comes from. */
export const KIND_INFO: Record<RequestKind, { group: RequestGroup; label: string; wantsKey: keyof Wants }> = {
  posters: { group: "printed", label: "Posters", wantsKey: "posterCount" },
  leaflets: { group: "printed", label: "Leaflets", wantsKey: "leafletCount" },
  leaflets_or_posters: { group: "printed", label: "Leaflets or posters", wantsKey: "leaflets" },
  buckets: { group: "lent", label: "Collection buckets", wantsKey: "bucketCount" },
  tins: { group: "lent", label: "Collection tins", wantsKey: "tinCount" },
  buckets_or_tins: { group: "lent", label: "Buckets or tins", wantsKey: "buckets" },
  shout_out: { group: "shout_out", label: "Social media shout out", wantsKey: "shoutOut" },
  attend: { group: "attend", label: "Someone from NBCC to come along", wantsKey: "attend" },
};

/** The steps of each group, in order. The first is where a request starts. */
export const FLOW: Record<RequestGroup, readonly RequestStatus[]> = {
  printed: ["to_send", "sent"],
  lent: ["to_send", "with_them", "back"],
  shout_out: ["to_do", "done"],
  attend: ["to_arrange", "arranged", "done"],
};

/** The action that moves each group on from a step. */
const FORWARD: Record<RequestGroup, Partial<Record<RequestStatus, RequestAction>>> = {
  printed: { to_send: "send" },
  lent: { to_send: "out", with_them: "back" },
  shout_out: { to_do: "done" },
  attend: { to_arrange: "arrange", arranged: "done" },
};

export const STATUS_LABELS: Record<RequestStatus, string> = {
  to_send: "To send",
  sent: "Sent",
  with_them: "With them",
  back: "Back",
  to_do: "To do",
  done: "Done",
  to_arrange: "To arrange",
  arranged: "Arranged",
};

export const DUE_BACK_AFTER_DATE_DAYS = 14;
export const DUE_BACK_AFTER_SENT_DAYS = 28;
export const NOTE_MAX = 500;
export const WHO_MAX = 100;
export const GOING_MAX = 200;
export const LINK_MAX = 500;

/** A request as stored (fundraiser_requests), one per fundraiser and kind. */
export interface RequestRow {
  fundraiserId: number;
  kind: RequestKind;
  status: RequestStatus;
  /** Posters and leaflets: how many were sent. Buckets and tins: how many went out. */
  quantity: number | null;
  /** Buckets and tins: how many came back. */
  quantityBack: number | null;
  how: SendHow | null;
  /** The day posters were sent, or buckets went out. */
  sentOn: string | null;
  backOn: string | null;
  /** The day a shout out was posted, or the day someone came along. */
  doneOn: string | null;
  handledBy: string | null;
  going: string | null;
  note: string | null;
  backNote: string | null;
  link: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** What a change sets: the row without whose it is and when it was saved. */
export type RequestState = Omit<RequestRow, "fundraiserId" | "kind" | "updatedAt" | "updatedBy">;

/** The parts of a fundraiser the requests depend on. */
export type RequestSubject = Pick<FundraiserRecord, "wants" | "socialOk" | "eventDate" | "status">;

export interface RequestView extends RequestState {
  kind: RequestKind;
  group: RequestGroup;
  label: string;
  /** How many they asked for; null for a yes or no request. */
  asked: number | null;
  statusLabel: string;
  /** Buckets and tins: the day they are due back, while they are with them. */
  dueOn: string | null;
  /** With them, and due back today or before. */
  dueBack: boolean;
  /** Still at its first step, with something staff can do. */
  outstanding: boolean;
  /** A shout out they did not give us permission to post. */
  noPermission: boolean;
  actions: RequestAction[];
  updatedAt: string | null;
  updatedBy: string | null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

/** fundraisers.wants as stored, old and new keys, with anything missing or odd as none. */
export function parseWants(raw: unknown): Wants {
  const w = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    posterCount: num(w.posterCount),
    leafletCount: num(w.leafletCount),
    bucketCount: num(w.bucketCount),
    tinCount: num(w.tinCount),
    leaflets: num(w.leaflets),
    buckets: num(w.buckets),
    shoutOut: w.shoutOut === true,
    attend: w.attend === true,
  };
}

const isKind = (k: unknown): k is RequestKind => (REQUEST_KINDS as readonly string[]).includes(String(k));

function askedFor(w: Wants, kind: RequestKind): number | null {
  const v = w[KIND_INFO[kind].wantsKey];
  return typeof v === "boolean" ? null : Number(v) || 0;
}

function wasAsked(w: Wants, kind: RequestKind): boolean {
  const v = w[KIND_INFO[kind].wantsKey];
  return typeof v === "boolean" ? v : Number(v) > 0;
}

const first = (kind: RequestKind): RequestStatus => FLOW[KIND_INFO[kind].group][0];

function emptyState(kind: RequestKind): RequestState {
  return {
    status: first(kind),
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
  };
}

/** Buckets and tins are due back two weeks after the date, or four weeks after they went out. */
export function dueBackOn(eventDate: string | null, sentOn: string | null): string | null {
  if (eventDate) return addDays(eventDate, DUE_BACK_AFTER_DATE_DAYS);
  if (sentOn) return addDays(sentOn, DUE_BACK_AFTER_SENT_DAYS);
  return null;
}

/** What a stored request holds, without whose it is and when it was saved. */
export function stateOf(r: RequestRow): RequestState {
  return {
    status: r.status,
    quantity: r.quantity,
    quantityBack: r.quantityBack,
    how: r.how,
    sentOn: r.sentOn,
    backOn: r.backOn,
    doneOn: r.doneOn,
    handledBy: r.handledBy,
    going: r.going,
    note: r.note,
    backNote: r.backNote,
    link: r.link,
  };
}

/** Every request this fundraiser has, in a fixed order: asked for, or acted on and not undone. */
export function requestViews(f: RequestSubject, rows: RequestRow[], today: string): RequestView[] {
  const byKind = new Map<RequestKind, RequestRow>();
  for (const r of rows) if (isKind(r.kind) && (FLOW[KIND_INFO[r.kind].group] as readonly string[]).includes(r.status)) byKind.set(r.kind, r);
  const views: RequestView[] = [];
  for (const kind of REQUEST_KINDS) {
    const r = byKind.get(kind) ?? null;
    const asked = wasAsked(f.wants, kind);
    if (!asked && (!r || r.status === first(kind))) continue;
    const { group, label } = KIND_INFO[kind];
    const state = r ? stateOf(r) : emptyState(kind);
    const noPermission = group === "shout_out" && !f.socialOk;
    const atStart = state.status === first(kind);
    const actions: RequestAction[] = [];
    const forward = FORWARD[group][state.status];
    if (forward && !(noPermission && atStart)) actions.push(forward);
    if (group === "printed" && state.status === "sent") actions.push("count");
    if (!atStart) actions.push("undo");
    const dueOn = group === "lent" && state.status === "with_them" ? dueBackOn(f.eventDate, state.sentOn) : null;
    views.push({
      ...state,
      kind,
      group,
      label,
      asked: askedFor(f.wants, kind),
      statusLabel: STATUS_LABELS[state.status],
      dueOn,
      dueBack: state.status === "with_them" && !!dueOn && today >= dueOn,
      outstanding: atStart && !noPermission,
      noPermission,
      actions,
      updatedAt: r?.updatedAt ?? null,
      updatedBy: r?.updatedBy ?? null,
    });
  }
  return views;
}

/**
 * Do staff still have something to send or do for it? Only for a sign up still to come: new or
 * approved, and not past its date. As the Monday summary always counted (TASK-503): something asked
 * for by one long past, declined or finished is done, or no longer wanted.
 */
export function stillToCome(f: Pick<RequestSubject, "status" | "eventDate">, today: string): boolean {
  return (f.status === "new" || f.status === "approved") && (!f.eventDate || f.eventDate >= today);
}

export function requestsToDo(f: RequestSubject, views: RequestView[], today: string): boolean {
  return stillToCome(f, today) && views.some((v) => v.outstanding);
}

/** The same shape as the Monday summary's materials (src/fundraising/summary.ts). */
export interface RequestMaterials {
  posters: number;
  leaflets: number;
  buckets: number;
  tins: number;
  leafletsOrPosters: number;
  bucketsOrTins: number;
}

export interface RequestTotals {
  /** Still to send, by kind, from sign ups still to come. */
  materials: RequestMaterials;
  /** How many sign ups still to come have something to send. */
  materialsFundraisers: number;
  /** Shout outs still to do (with permission), from sign ups still to come. */
  shoutOuts: number;
  /** The date of each request for someone to come along still to arrange (null when it has none). */
  attend: Array<string | null>;
  /** Buckets and tins with them now, however long they have had them. */
  notBack: number;
  /** Of those, how many are due back. */
  notBackDue: number;
  /** How many requests have buckets or tins due back: each is someone to chase. */
  dueBackRequests: number;
  /** How many sign ups show "Requests to do". */
  toDoFundraisers: number;
}

const MATERIAL_KEY: Partial<Record<RequestKind, keyof RequestMaterials>> = {
  posters: "posters",
  leaflets: "leaflets",
  leaflets_or_posters: "leafletsOrPosters",
  buckets: "buckets",
  tins: "tins",
  buckets_or_tins: "bucketsOrTins",
};

export function requestTotals(list: Array<{ f: RequestSubject; rows: RequestRow[] }>, today: string): RequestTotals {
  const t: RequestTotals = {
    materials: { posters: 0, leaflets: 0, buckets: 0, tins: 0, leafletsOrPosters: 0, bucketsOrTins: 0 },
    materialsFundraisers: 0,
    shoutOuts: 0,
    attend: [],
    notBack: 0,
    notBackDue: 0,
    dueBackRequests: 0,
    toDoFundraisers: 0,
  };
  for (const { f, rows } of list) {
    const views = requestViews(f, rows, today);
    for (const v of views) {
      if (v.status !== "with_them") continue;
      const n = v.quantity ?? v.asked ?? 0;
      t.notBack += n;
      if (v.dueBack) {
        t.notBackDue += n;
        t.dueBackRequests += 1;
      }
    }
    if (!stillToCome(f, today)) continue;
    let sends = false;
    for (const v of views) {
      if (!v.outstanding) continue;
      const key = MATERIAL_KEY[v.kind];
      if (key) {
        t.materials[key] += v.asked ?? 0;
        sends = true;
      }
      if (v.kind === "shout_out") t.shoutOuts += 1;
      if (v.kind === "attend") t.attend.push(f.eventDate);
    }
    if (sends) t.materialsFundraisers += 1;
    if (views.some((v) => v.outstanding)) t.toDoFundraisers += 1;
  }
  t.attend.sort((a, b) => String(a ?? "9").localeCompare(String(b ?? "9")));
  return t;
}

// --- the organiser's own view (their private area): words only, never a note or a name --------------

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "3 Dec" */
export function shortDate(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${d} ${SHORT_MONTHS[m - 1]}`;
}

export interface OrganiserRequestLine {
  label: string;
  words: string;
  /** A done shout out's post, when staff gave one. */
  link?: string;
}

const isHttps = (v: string | null): v is string => !!v && /^https:\/\/[^\s"'<>]+$/i.test(v);

function organiserWords(v: RequestView, today: string): string {
  switch (v.group) {
    case "printed":
      if (v.status === "sent") return `${v.how === "dropped_off" ? "dropped off" : "sent"} on ${shortDate(v.sentOn ?? today)}`;
      return "we're getting them ready";
    case "lent":
      if (v.status === "with_them") {
        return v.dueOn && v.dueOn >= today ? `with you, please bring them back by ${shortDate(v.dueOn)}` : "with you, please bring them back as soon as you can";
      }
      if (v.status === "back") return `back with us on ${shortDate(v.backOn ?? today)}. Thank you!`;
      return "we're getting them ready";
    case "shout_out":
      if (v.status === "done") return `posted on ${shortDate(v.doneOn ?? today)}`;
      return v.noPermission
        ? "we just need your OK to post about you. Reply to any of our emails or give us a ring and we'll sort it."
        : "coming soon";
    case "attend":
      if (v.status === "arranged") return "arranged, we look forward to seeing you";
      if (v.status === "done") return "thank you for having us";
      return "we're working on it and will be in touch";
  }
}

/**
 * Where each request is up to, in words for the organiser. Staff notes and names never go in.
 *
 * A request still at its first step is shown only while the fundraiser is still to come (the rule
 * the admin's Requests to do pill and the Monday summary use). There is no backfill, so one asked
 * for before requests were tracked sits at its first step for good: on a fundraiser past its date,
 * finished or declined, "we're getting them ready" would be wrong. Anything staff have moved on is
 * always shown, so buckets still with them are always asked for back.
 */
export function organiserRequestLines(
  views: RequestView[],
  today: string,
  f: Pick<RequestSubject, "status" | "eventDate">,
): OrganiserRequestLine[] {
  const toCome = stillToCome(f, today);
  return views.filter((v) => toCome || v.status !== FLOW[v.group][0]).map((v) => {
    const label = v.group === "shout_out" && v.noPermission && v.status === "to_do" ? "A shout out on our social media" : v.label;
    const line: OrganiserRequestLine = { label, words: organiserWords(v, today) };
    if (v.group === "shout_out" && v.status === "done" && isHttps(v.link)) line.link = v.link;
    return line;
  });
}

// --- changing a request --------------------------------------------------------------------------

function isRealDate(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const trimmed = (v: unknown) => (v == null ? "" : typeof v === "string" ? v.trim() : v);
const day = z
  .string({ required_error: "Give the date.", invalid_type_error: "Give the date." })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date.")
  .refine(isRealDate, "That date does not exist.");
const who = z.preprocess(
  trimmed,
  z.string().min(1, "Say who did it.").max(WHO_MAX, `Keep this to ${WHO_MAX} characters or fewer.`),
);
const optionalWho = z.preprocess(trimmed, z.string().max(WHO_MAX, `Keep this to ${WHO_MAX} characters or fewer.`)).optional();
const note = z.preprocess(trimmed, z.string().max(NOTE_MAX, `A note can be up to ${NOTE_MAX} characters.`)).optional();
const from = z.enum(REQUEST_STATUSES, { errorMap: () => ({ message: "Say what it showed before." }) });
const howMany = (min: number, max: number) =>
  z
    .number({ required_error: "Give how many.", invalid_type_error: "Give how many." })
    .int("Give a whole number.")
    .min(min, `Give how many, from ${min} to ${max.toLocaleString("en-GB")}.`)
    .max(max, `Give how many, from ${min} to ${max.toLocaleString("en-GB")}.`);
const link = z
  .preprocess(
    trimmed,
    z.union([
      z.literal(""),
      z
        .string()
        .max(LINK_MAX, "That link is too long.")
        .refine((v) => isHttps(v), "Paste the full web address of the post, starting https://"),
    ]),
  )
  .optional();

export const requestActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("send"),
      from,
      on: day,
      how: z.enum(SEND_HOW, { errorMap: () => ({ message: "Say whether it was posted or dropped off." }) }),
      by: who,
      quantity: howMany(1, MAX_LEAFLETS),
      note,
    })
    .strict(),
  z.object({ action: z.literal("out"), from, on: day, quantity: howMany(1, MAX_BUCKETS), by: who, note }).strict(),
  z.object({ action: z.literal("back"), from, on: day, quantity: howMany(0, MAX_BUCKETS), note }).strict(),
  z.object({ action: z.literal("done"), from, on: day, by: optionalWho, link }).strict(),
  z
    .object({
      action: z.literal("arrange"),
      from,
      going: z.preprocess(trimmed, z.string().min(1, "Say who is going.").max(GOING_MAX, `Keep this to ${GOING_MAX} characters or fewer.`)),
      note,
    })
    .strict(),
  z.object({ action: z.literal("count"), from, quantity: howMany(1, MAX_LEAFLETS) }).strict(),
  z.object({ action: z.literal("undo"), from }).strict(),
]);
export type RequestActionInput = z.infer<typeof requestActionSchema>;

export type ApplyResult =
  | { ok: true; state: RequestState; words: string }
  | { ok: false; reason: "not_asked" | "conflict" | "not_allowed" | "invalid"; message: string; field?: string };

export const CONFLICT = "Someone else changed this a moment ago. It now shows how it stands.";
const NOT_NOW = "That can't be done to this request now.";

const blankToNull = (v: string | undefined | null): string | null => (v == null || v.trim() === "" ? null : v.trim());
const invalid = (field: string, message: string): ApplyResult => ({ ok: false, reason: "invalid", message, field });

/** What clearing a step takes away when it is undone. */
function undone(kind: RequestKind, s: RequestState): RequestState {
  const group = KIND_INFO[kind].group;
  const steps = FLOW[group];
  const back = steps[steps.indexOf(s.status) - 1];
  if (group === "printed" || (group === "lent" && s.status === "with_them")) {
    return { ...s, status: back, quantity: null, how: null, sentOn: null, handledBy: null, note: null };
  }
  if (group === "lent") return { ...s, status: back, backOn: null, quantityBack: null, backNote: null };
  if (group === "shout_out") return { ...s, status: back, doneOn: null, link: null, handledBy: null };
  if (s.status === "arranged") return { ...s, status: back, going: null, note: null };
  return { ...s, status: back, doneOn: null };
}

/**
 * Move a request on by one step, change how many posters or leaflets went, or Undo one step.
 * `input.from` is the step the person saw: if it is not what is stored, nothing changes (a second
 * press, or two people at once). Dates are UK days, and none may be still to come.
 */
export function applyRequestAction(
  f: RequestSubject,
  kind: RequestKind,
  current: RequestRow | null,
  input: RequestActionInput,
  today: string,
): ApplyResult {
  const { group, label } = KIND_INFO[kind];
  const valid = current && (FLOW[group] as readonly string[]).includes(current.status) ? current : null;
  const state = valid ? stateOf(valid) : emptyState(kind);
  if (!wasAsked(f.wants, kind) && state.status === first(kind)) {
    return { ok: false, reason: "not_asked", message: "They did not ask for that." };
  }
  if (input.from !== state.status) return { ok: false, reason: "conflict", message: CONFLICT };
  if ("on" in input && input.on > today) return invalid("on", "That date is still to come.");

  if (input.action === "undo") {
    if (state.status === first(kind)) return { ok: false, reason: "not_allowed", message: NOT_NOW };
    const next = undone(kind, state);
    return { ok: true, state: next, words: `${label}: undone, back to ${STATUS_LABELS[next.status]}` };
  }
  if (input.action === "count") {
    if (group !== "printed" || state.status !== "sent") return { ok: false, reason: "not_allowed", message: NOT_NOW };
    return {
      ok: true,
      state: { ...state, quantity: input.quantity },
      words: `${label}: count sent changed from ${state.quantity ?? "none"} to ${input.quantity}`,
    };
  }
  if (FORWARD[group][state.status] !== input.action) return { ok: false, reason: "not_allowed", message: NOT_NOW };

  switch (input.action) {
    case "send":
      return {
        ok: true,
        state: { ...state, status: "sent", sentOn: input.on, how: input.how, handledBy: input.by, quantity: input.quantity, note: blankToNull(input.note) },
        words: `${label}: sent (${input.how === "dropped_off" ? "dropped off" : "by post"})`,
      };
    case "out":
      return {
        ok: true,
        state: { ...state, status: "with_them", sentOn: input.on, quantity: input.quantity, handledBy: input.by, note: blankToNull(input.note) },
        words: `${label}: ${input.quantity} with them`,
      };
    case "back": {
      const out = state.quantity ?? askedFor(f.wants, kind) ?? 0;
      if (input.quantity > out) return invalid("quantity", `Give how many came back, up to the ${out} that went out.`);
      if (state.sentOn && input.on < state.sentOn) return invalid("on", "They can't come back before they went out.");
      return {
        ok: true,
        state: { ...state, status: "back", backOn: input.on, quantityBack: input.quantity, backNote: blankToNull(input.note) },
        words: `${label}: back, ${input.quantity} of ${out}`,
      };
    }
    case "done":
      if (group === "shout_out") {
        if (!f.socialOk) return { ok: false, reason: "not_allowed", message: "They did not give permission to post about it." };
        const by = blankToNull(input.by);
        if (!by) return invalid("by", "Say who did it.");
        return {
          ok: true,
          state: { ...state, status: "done", doneOn: input.on, handledBy: by, link: blankToNull(input.link) },
          words: `${label}: done`,
        };
      }
      return { ok: true, state: { ...state, status: "done", doneOn: input.on }, words: `${label}: done` };
    case "arrange":
      return {
        ok: true,
        state: { ...state, status: "arranged", going: input.going, note: blankToNull(input.note) },
        words: `${label}: arranged`,
      };
  }
}
