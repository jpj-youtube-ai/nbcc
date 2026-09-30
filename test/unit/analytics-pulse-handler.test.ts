import { describe, it, expect, vi } from "vitest";
import { handlePulse, type PulseDeps } from "../../src/analytics/pulse-handler";
import { visitorId } from "../../src/analytics/visitor";

// TASK-479: what POST /api/pulse does with one event, with every seam (the switch, the limiter,
// the database, the place lookup) replaced by a stand-in. Invented data only.

const IP = "203.0.113.7";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const V = "00112233445566ff";
const NOW = new Date("2026-10-01T09:15:00Z");

function deps(overrides: Partial<PulseDeps> = {}): PulseDeps {
  return {
    now: () => NOW,
    isCollecting: vi.fn(async () => true),
    limiter: { allow: vi.fn(() => true) },
    saltFor: vi.fn(async () => "salt-of-the-day"),
    lastArrival: vi.fn(async () => null),
    insertView: vi.fn(async () => {}),
    recordLeave: vi.fn(async () => {}),
    insertClick: vi.fn(async () => {}),
    resolvePlace: vi.fn(() => ({ country: "GB", region: "Scotland", city: "Glenmorrow" })),
    ...overrides,
  };
}

const request = (body: unknown, extra: Partial<{ ip: string; userAgent: string; host: string }> = {}) => ({
  body: typeof body === "string" ? body : JSON.stringify(body),
  ip: IP,
  userAgent: UA,
  host: "nbcc.scot",
  ...extra,
});

const view = (over: Record<string, unknown> = {}) => ({ t: "view", v: V, p: "/donate", r: "", ...over });

describe("handlePulse: when nothing is kept", () => {
  it("keeps nothing while the switch is off", async () => {
    const d = deps({ isCollecting: vi.fn(async () => false) });
    expect(await handlePulse(request(view()), d)).toBe("off");
    expect(d.insertView).not.toHaveBeenCalled();
    expect(d.saltFor).not.toHaveBeenCalled();
  });

  it("keeps nothing past 120 events a minute from one address", async () => {
    const d = deps({ limiter: { allow: vi.fn(() => false) } });
    expect(await handlePulse(request(view()), d)).toBe("limited");
    expect(d.limiter.allow).toHaveBeenCalledWith(IP, NOW.getTime());
    expect(d.insertView).not.toHaveBeenCalled();
  });

  it("keeps nothing from a bot", async () => {
    const d = deps();
    expect(await handlePulse(request(view(), { userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1)" }), d)).toBe("bot");
    expect(d.insertView).not.toHaveBeenCalled();
  });

  it("keeps nothing from a body that does not fit", async () => {
    const d = deps();
    expect(await handlePulse(request("{nope"), d)).toBe("invalid");
    expect(d.insertView).not.toHaveBeenCalled();
  });
});

describe("handlePulse: a view", () => {
  it("keeps the canonical path, the daily id, the place and the device, and never the IP or user agent", async () => {
    const d = deps();
    expect(await handlePulse(request(view({ p: "/donate?token=secret", r: "https://www.bing.com/search?q=x" })), d)).toBe("kept");
    expect(d.saltFor).toHaveBeenCalledWith("2026-10-01");
    expect(d.resolvePlace).toHaveBeenCalledWith(IP);
    const row = (d.insertView as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(row).toEqual({
      viewId: V,
      at: NOW,
      day: "2026-10-01",
      path: "/donate",
      visitor: visitorId("salt-of-the-day", IP, UA),
      channel: "search",
      source: "Bing",
      campaign: null,
      country: "GB",
      region: "Scotland",
      city: "Glenmorrow",
      device: "phone",
      browser: "Safari",
      os: "iOS",
    });
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(IP);
    expect(stored).not.toContain("iPhone OS");
    expect(stored).not.toContain("secret");
  });

  it("files an unknown page as other", async () => {
    const d = deps();
    await handlePulse(request(view({ p: "/no-such-page" })), d);
    expect((d.insertView as ReturnType<typeof vi.fn>).mock.calls[0][0].path).toBe("other");
  });

  it("reads the tracking words in the address", async () => {
    const d = deps();
    await handlePulse(request(view({ u: { s: "newsletter", m: "email", c: "12" } })), d);
    const row = (d.insertView as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect([row.channel, row.campaign]).toEqual(["newsletter", "12"]);
  });

  it("keeps the channel of the visit when the visitor moves between our own pages", async () => {
    const d = deps({
      lastArrival: vi.fn(async () => ({ channel: "social" as const, source: "Facebook", campaign: null })),
    });
    await handlePulse(request(view({ r: "https://nbcc.scot/about-us" })), d);
    expect(d.lastArrival).toHaveBeenCalledWith("2026-10-01", visitorId("salt-of-the-day", IP, UA));
    const row = (d.insertView as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect([row.channel, row.source]).toEqual(["social", "Facebook"]);
  });

  it("counts a move from our own page as Direct when there is no earlier view today", async () => {
    const d = deps();
    await handlePulse(request(view({ r: "http://localhost:3000/" }), { host: "localhost" }), d);
    expect((d.insertView as ReturnType<typeof vi.fn>).mock.calls[0][0].channel).toBe("direct");
  });

  it("uses the same id for an IPv4 address however the server writes it", async () => {
    const d = deps();
    await handlePulse(request(view(), { ip: `::ffff:${IP}` }), d);
    expect(d.resolvePlace).toHaveBeenCalledWith(IP);
    expect((d.insertView as ReturnType<typeof vi.fn>).mock.calls[0][0].visitor).toBe(visitorId("salt-of-the-day", IP, UA));
  });
});

describe("handlePulse: leave and click", () => {
  it("records the time on the page and how far down it was read", async () => {
    const d = deps();
    expect(await handlePulse(request({ t: "leave", v: V, a: 42, s: 75 }), d)).toBe("kept");
    expect(d.recordLeave).toHaveBeenCalledWith(V, 42, 75);
  });

  it("records a click against its view", async () => {
    const d = deps();
    expect(await handlePulse(request({ t: "click", v: V, k: "outbound", l: "example.org" }), d)).toBe("kept");
    expect(d.insertClick).toHaveBeenCalledWith({ viewId: V, at: NOW, day: "2026-10-01", kind: "outbound", label: "example.org" });
  });
});
