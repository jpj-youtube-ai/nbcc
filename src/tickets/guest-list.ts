import type { Response } from "express";
import type { FundraiserRecord } from "../fundraising/model";
import { guestList, type OrderForList } from "./model";
import { whenWords } from "./emails";
import { renderGuestListPage } from "./render";

// Event tickets: the guest list page, for the organiser's private area and for staff alike. Names,
// tickets and references only. Never kept by a browser or anything in between, never indexed, and
// never handed to another website as a referrer.

export function sendGuestList(res: Response, f: FundraiserRecord, orders: OrderForList[]): Response {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
  const when = whenWords({ eventDate: f.eventDate, startTime: f.startTime, endTime: f.endTime ?? null, timeTbc: f.timeTbc ?? false });
  return res.type("html").send(renderGuestListPage({ title: f.title, when, list: guestList(orders), printedAt: new Date().toISOString() }));
}
