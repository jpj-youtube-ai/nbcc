import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ALERT_GAP_MS,
  alertRecipients,
  headElfName,
  headElvesOf,
  normaliseUkMobile,
  photoAlertDue,
  quietHours,
  type HeadElf,
} from "../../src/elf/alerts";
import type { ManagedUser } from "../../src/db/admin-users";

// The alert rules: when a text and an email go, who gets them. Pure. London is on GMT on 7 December,
// so a UTC time is the London time. Every head elf here is invented.

afterEach(() => vi.useRealTimers());

const at = (hhmm: string) => new Date(`2026-12-07T${hhmm}:00.000Z`);

describe("quiet hours", () => {
  it("run from 9pm to 8am London time", () => {
    expect(quietHours(at("20:59"))).toBe(false);
    expect(quietHours(at("21:00"))).toBe(true);
    expect(quietHours(at("07:59"))).toBe(true);
    expect(quietHours(at("08:00"))).toBe(false);
  });

  it("go by London's clock in summer too", () => {
    expect(quietHours(new Date("2026-07-07T20:30:00.000Z"))).toBe(true); // 9:30pm BST
    expect(quietHours(new Date("2026-07-07T19:30:00.000Z"))).toBe(false); // 8:30pm BST
  });

  it("have a gap of half an hour between alerts", () => {
    expect(ALERT_GAP_MS).toBe(30 * 60_000);
  });
});

describe("when a photo alert is due", () => {
  it("goes at once for the first photo, up to 8:59pm", () => {
    expect(photoAlertDue({ oldestWaitingAt: at("20:58"), lastAlertAt: null }, at("20:59"))).toBe(true);
  });

  it("waits for 8am when the photo came after 9pm", () => {
    const o = { oldestWaitingAt: at("21:01"), lastAlertAt: null };
    expect(photoAlertDue(o, at("21:01"))).toBe(false);
    expect(photoAlertDue(o, at("23:30"))).toBe(false);
    expect(photoAlertDue(o, new Date("2026-12-08T08:00:00.000Z"))).toBe(true);
  });

  it("is never due when no photo is waiting", () => {
    expect(photoAlertDue({ oldestWaitingAt: null, lastAlertAt: null }, at("12:00"))).toBe(false);
    expect(photoAlertDue({ oldestWaitingAt: null, lastAlertAt: at("11:00") }, at("12:00"))).toBe(false);
  });

  it("sends nothing more while the photos at the last alert are still waiting", () => {
    // Alert at 6:04pm, the oldest waiting is still the 6:00pm photo.
    expect(photoAlertDue({ oldestWaitingAt: at("18:00"), lastAlertAt: at("18:04") }, at("18:40"))).toBe(false);
  });

  it("sends another half an hour after the last, once the queue was cleared and a new photo came", () => {
    // Queue cleared at 6:05pm; the oldest waiting now is the 6:10pm photo.
    const o = { oldestWaitingAt: at("18:10"), lastAlertAt: at("18:04") };
    expect(photoAlertDue(o, at("18:20"))).toBe(false);
    expect(photoAlertDue(o, at("18:33"))).toBe(false);
    expect(photoAlertDue(o, at("18:34"))).toBe(true);
  });
});

describe("a typed mobile number", () => {
  it("becomes +447 and nine digits", () => {
    expect(normaliseUkMobile("07700 900 123")).toBe("+447700900123");
    expect(normaliseUkMobile("+44 (0)7700 900123")).toBe("+447700900123");
    expect(normaliseUkMobile("447700900123")).toBe("+447700900123");
    expect(normaliseUkMobile("07700-900.123")).toBe("+447700900123");
  });

  it("is null for a landline, words or anything else", () => {
    expect(normaliseUkMobile("01632 960 123")).toBeNull();
    expect(normaliseUkMobile("abc")).toBeNull();
    expect(normaliseUkMobile("")).toBeNull();
    expect(normaliseUkMobile(7700900123)).toBeNull();
    expect(normaliseUkMobile("07700 900 1234")).toBeNull();
  });
});

describe("a head elf's name", () => {
  it("is their full name, trimmed, or their email when that is blank", () => {
    expect(headElfName({ full_name: "  Alex Example ", email: "alex@example.org" })).toBe("Alex Example");
    expect(headElfName({ full_name: "  ", email: "jo@example.org" })).toBe("jo@example.org");
  });
});

const user = (id: number, o: Partial<ManagedUser>): ManagedUser => ({
  id,
  email: `u${id}@example.org`,
  full_name: `Person ${id}`,
  role: "viewer",
  status: "active",
  invited_at: null,
  last_login_at: null,
  permissions: {},
  ...o,
});

describe("who the head elves are", () => {
  it("keeps an editor given the section and an admin, and drops a disabled admin and a viewer with nothing", () => {
    const users = [
      user(1, { role: "editor", permissions: { elf: "view" }, full_name: "Zed Example" }),
      user(2, { role: "admin", status: "disabled" }),
      user(3, { role: "viewer", permissions: {} }),
      user(4, { role: "admin", full_name: "Alex Example" }),
    ];
    const elves = headElvesOf(users, [{ userId: 4, mobile: "+447700900123", alertsOn: false }]);
    expect(elves.map((e) => e.userId)).toEqual([4, 1]);
    expect(elves[0]).toEqual({ userId: 4, name: "Alex Example", email: "u4@example.org", mobile: "+447700900123", alertsOn: false });
    expect(elves[1]).toMatchObject({ userId: 1, mobile: null, alertsOn: true });
  });

  // An invite is accepted by setting a password, which makes the account active (src/db/admin-users.ts): until
  // then the address may not be the person's, so it gets no photo alert and no find alert, with its full names.
  it("leaves out someone invited who has not yet accepted their invite and signed in", () => {
    const users = [
      user(1, { role: "admin", full_name: "Alex Example" }),
      user(2, { role: "admin", status: "invited", full_name: "Jo Example" }),
      user(3, { role: "editor", status: "invited", permissions: { elf: "view" }, full_name: "Kim Example" }),
    ];
    const elves = headElvesOf(users, [{ userId: 2, mobile: "+447700900123", alertsOn: true }]);
    expect(elves.map((e) => e.userId)).toEqual([1]);
    expect(alertRecipients(elves)).toEqual({ emails: [elves[0]], texts: [] });
  });
});

describe("who an alert goes to", () => {
  it("emails everyone with alerts on and texts those who also have a mobile", () => {
    const e = (userId: number, mobile: string | null, alertsOn: boolean): HeadElf => ({ userId, name: `P${userId}`, email: `p${userId}@example.org`, mobile, alertsOn });
    const r = alertRecipients([e(1, "+447700900123", true), e(2, null, true), e(3, "+447700900456", false)]);
    expect(r.emails.map((x) => x.userId)).toEqual([1, 2]);
    expect(r.texts.map((x) => x.userId)).toEqual([1]);
  });
});
