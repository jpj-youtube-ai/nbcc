import { describe, it, expect } from "vitest";
import {
  KIND_INFO,
  REQUEST_KINDS,
  applyRequestAction,
  organiserRequestLines,
  parseWants,
  requestTotals,
  requestViews,
  type RequestSubject,
} from "../../src/fundraising/requests";
import { wantsLines, wantsPosted, type Wants } from "../../src/fundraising/model";
import { summaryLines } from "../../src/fundraising/summary";

// TASK-511: printed QR codes (cards or stickers with their page's QR code) are asked for on the
// sign up form like posters, and tracked the same way: To send, then Sent. Pure; every number is
// invented.

const TODAY = "2026-12-07";
const NONE: Wants = { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false };
const subject = (wants: Partial<Wants>, over: Partial<RequestSubject> = {}): RequestSubject => ({
  wants: { ...NONE, ...wants },
  socialOk: true,
  eventDate: "2026-12-12",
  status: "approved",
  ...over,
});

describe("printed QR codes as a request", () => {
  it("is a printed kind, named QR codes, read from qrCount", () => {
    expect(REQUEST_KINDS).toContain("qr_codes");
    expect(KIND_INFO.qr_codes).toEqual({ group: "printed", label: "QR codes", wantsKey: "qrCount" });
  });

  it("reads qrCount from what was stored, and none from a sign up from before", () => {
    expect(parseWants({ qrCount: 40 }).qrCount).toBe(40);
    expect(parseWants({ posterCount: 2 }).qrCount).toBe(0);
    expect(parseWants({ qrCount: "lots" }).qrCount).toBe(0);
  });

  it("shows only when asked for, after the other printed things, with how many", () => {
    expect(requestViews(subject({}), [], TODAY)).toEqual([]);
    const views = requestViews(subject({ posterCount: 5, qrCount: 30 }), [], TODAY);
    expect(views.map((v) => v.kind)).toEqual(["posters", "qr_codes"]);
    expect(views[1]).toMatchObject({ label: "QR codes", asked: 30, status: "to_send", statusLabel: "To send", outstanding: true, actions: ["send"] });
  });

  it("goes from To send to Sent like posters, and can be undone", () => {
    const f = subject({ qrCount: 30 });
    const sent = applyRequestAction(f, "qr_codes", null, { action: "send", from: "to_send", on: "2026-12-05", how: "post", by: "Fern", quantity: 30 }, TODAY);
    expect(sent).toMatchObject({ ok: true, state: { status: "sent", quantity: 30, how: "post" }, words: "QR codes: sent (by post)" });
  });

  it("is counted in the totals still to send, and in the Monday summary's things to post", () => {
    const t = requestTotals([{ f: subject({ qrCount: 30 }), rows: [] }, { f: subject({ qrCount: 10, posterCount: 2 }), rows: [] }], TODAY);
    expect(t.materials.qrCodes).toBe(40);
    expect(t.materialsFundraisers).toBe(2);
  });

  it("tells the organiser where it is up to, in the same words as posters", () => {
    const f = subject({ qrCount: 30 });
    const lines = organiserRequestLines(requestViews(f, [], TODAY), TODAY, f);
    expect(lines).toEqual([{ label: "QR codes", words: "we're getting them ready" }]);
  });
});

describe("what they would like, in words", () => {
  it("needs an address for QR codes, as they are posted", () => {
    expect(wantsPosted({ ...NONE, qrCount: 1 })).toBe(true);
    expect(wantsPosted({ ...NONE })).toBe(false);
  });

  it("says how many printed QR codes", () => {
    expect(wantsLines({ ...NONE, qrCount: 1 })).toEqual(["1 printed QR code"]);
    expect(wantsLines({ ...NONE, posterCount: 3, qrCount: 25 })).toEqual(["3 posters", "25 printed QR codes"]);
  });
});

describe("the Monday summary", () => {
  it("lists QR codes with the other things to post", () => {
    const counts = {
      week: { from: "2026-11-30", to: "2026-12-06" },
      today: TODAY,
      onlinePence: 0,
      paidInPence: 0,
      cashPence: 0,
      giftAidPence: 0,
      raisedPence: 0,
      liveCount: 1,
      totalRaisedPence: 0,
      newSignUps: [],
      toApprove: 0,
      changesToCheck: 0,
      newsToCheck: 0,
      materials: { posters: 4, leaflets: 0, buckets: 0, tins: 0, leafletsOrPosters: 0, bucketsOrTins: 0, qrCodes: 30 },
      materialsFundraisers: 1,
      shoutOuts: 0,
      attend: [],
      notBack: 0,
      notBackDue: 0,
      dueBackRequests: 0,
      callsDue: 0,
      invitesNotTaken: [],
      pastDate: 0,
      saysFinished: 0,
      comingUp: [],
      waiting: 1,
    };
    expect(summaryLines(counts).waiting).toContain("Posters (4) and printed QR codes (30) to post");
  });
});
