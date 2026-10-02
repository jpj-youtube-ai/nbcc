import { z } from "zod";
import type { Wants } from "./model";
import {
  KIND_INFO,
  requestViews,
  shortDate,
  stillToCome,
  type RequestRow,
  type RequestState,
  type RequestSubject,
} from "./requests";

// TASK-512: "Ask us to print these". After seeing their materials in their private area, an
// organiser can ask us to print posters (A4 or A3) or leaflets (A5). Pure: no pool, no clock.
//
// The ask becomes the posters or leaflets request staff already track (TASK-505,
// src/fundraising/requests.ts), so there is nothing new for staff to learn:
//   - how many they want goes in fundraisers.wants (posterCount or leafletCount), where the sign up
//     form puts it, so it shows as "N asked for" in Admin > Fundraising's Requests, in the Monday
//     summary and on the Overview;
//   - the request is To send, with a note saying the sizes and the day they asked;
//   - asking again before we send replaces the ask; asking again after we sent some opens a new
//     To send, the note saying what went before (the audit log keeps every step).
// Only while the fundraiser is approved and still to come, the rule the requests themselves use.
// No new kind of request and no migration: TASK-511 adds printed QR codes as a kind of its own.

export const MAX_A4 = 100;
export const MAX_A3 = 50;
export const MAX_A5 = 500;

export type PrintKind = "posters" | "leaflets";

const howMany = (max: number, words: string) =>
  z
    .number({ invalid_type_error: "Give how many, as a number." })
    .int("Give a whole number.")
    .min(0, "Give how many, as a number.")
    .max(max, `We can print up to ${max} ${words} at a time. For more, give us a call.`);

export const printAskSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("posters"), a4: howMany(MAX_A4, "A4 posters").default(0), a3: howMany(MAX_A3, "A3 posters").default(0) }).strict(),
    z.object({ kind: z.literal("leaflets"), a5: howMany(MAX_A5, "leaflets").min(1, "Say how many leaflets you would like.") }).strict(),
  ])
  .superRefine((a, ctx) => {
    if (a.kind === "posters" && a.a4 + a.a3 < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["a4"], message: "Say how many posters you would like." });
    }
  });
export type PrintAsk = z.infer<typeof printAskSchema>;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "10 A4 posters and 2 A3 posters", "50 A5 leaflets". */
export function askWords(ask: PrintAsk): string {
  if (ask.kind === "leaflets") return count(ask.a5, "A5 leaflet", "A5 leaflets");
  return [ask.a4 ? count(ask.a4, "A4 poster", "A4 posters") : "", ask.a3 ? count(ask.a3, "A3 poster", "A3 posters") : ""]
    .filter(Boolean)
    .join(" and ");
}

const WANTS_KEY: Record<PrintKind, keyof Wants> = { posters: "posterCount", leaflets: "leafletCount" };

type Subject = Pick<RequestSubject, "status" | "eventDate">;

/** Approved and still to come: the same rule the requests' To do uses. */
export function canAskToPrint(f: Subject, today: string): boolean {
  return f.status === "approved" && stillToCome(f, today);
}

export type PrintAskResult =
  | { ok: true; kind: PrintKind; wantsKey: keyof Wants; total: number; state: RequestState; words: string }
  | { ok: false; message: string };

export const TOO_LATE = "Your fundraiser has finished or its day has passed, so we can't take an order online. If you still need some, give us a call on 01292 811 015.";

/**
 * What an ask changes. `current` is the posters or leaflets request as stored (null when staff have
 * not acted on it yet). `hasAddress`: whether we have somewhere to post them; without one the note
 * asks staff to find out.
 */
export function applyPrintAsk(
  f: Subject & { hasAddress?: boolean },
  current: RequestRow | null,
  ask: PrintAsk,
  today: string,
): PrintAskResult {
  if (!canAskToPrint(f, today)) return { ok: false, message: TOO_LATE };
  const kind: PrintKind = ask.kind;
  const total = ask.kind === "posters" ? ask.a4 + ask.a3 : ask.a5;
  const words = askWords(ask);
  let note = `Asked in their private area on ${shortDate(today)}: ${words}.`;
  if (current && current.status === "sent") {
    note += ` More, after the ${current.quantity ?? "ones"} we sent${current.sentOn ? ` on ${shortDate(current.sentOn)}` : ""}.`;
  }
  if (f.hasAddress === false) note += " We have no address to post them to: ask them where to send them.";
  const state: RequestState = {
    status: "to_send",
    quantity: null,
    quantityBack: null,
    how: null,
    sentOn: null,
    backOn: null,
    doneOn: null,
    handledBy: null,
    going: null,
    note,
    backNote: null,
    link: null,
  };
  return { ok: true, kind, wantsKey: WANTS_KEY[kind], total, state, words: `${KIND_INFO[kind].label}: they asked us to print ${words}` };
}

/** The organiser's last ask of each kind, from the audit log. */
export interface LastAsk {
  kind: PrintKind;
  words: string;
  /** The UK day they asked. */
  on: string;
}

export interface PrintLine {
  asked: number;
  words: string;
  status: "to_send" | "sent";
}

export interface PrintStatus {
  canAsk: boolean;
  posters: PrintLine | null;
  leaflets: PrintLine | null;
}

/** Where their posters and leaflets are up to, in words, for their private area. Never a staff note or name. */
export function printStatus(f: Subject & { wants: Wants; socialOk?: boolean }, rows: RequestRow[], last: LastAsk[], today: string): PrintStatus {
  const views = requestViews({ ...f, socialOk: f.socialOk ?? false }, rows, today);
  const line = (kind: PrintKind): PrintLine | null => {
    const v = views.find((x) => x.kind === kind);
    if (!v) return null;
    const noun = kind === "posters" ? "posters" : "leaflets";
    if (v.status === "sent") {
      const n = v.quantity ?? v.asked ?? 0;
      const how = v.how === "dropped_off" ? "dropped off" : "sent";
      return { asked: v.asked ?? 0, words: `We ${how} ${n} ${n === 1 ? noun.slice(0, -1) : noun}${v.sentOn ? ` on ${shortDate(v.sentOn)}` : ""}.`, status: "sent" };
    }
    // Still at its first step: shown only while the fundraiser is still to come, the rule the
    // organiser's own request lines use (organiserRequestLines).
    if (v.status !== "to_send" || !stillToCome(f, today)) return null;
    const mine = last.find((a) => a.kind === kind);
    const asked = mine ? `${mine.words} on ${shortDate(mine.on)}` : `${v.asked ?? 0} ${v.asked === 1 ? noun.slice(0, -1) : noun}`;
    return { asked: v.asked ?? 0, words: `You asked for ${asked}. We're getting them ready.`, status: "to_send" };
  };
  return { canAsk: canAskToPrint(f, today), posters: line("posters"), leaflets: line("leaflets") };
}
