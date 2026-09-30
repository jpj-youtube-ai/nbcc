import { describe, it, expect } from "vitest";
import { parsePulse, PULSE_MAX_BYTES } from "../../src/analytics/payload";

// TASK-479: what pulse.js may send. Anything else, or anything too big, is dropped quietly.

const V = "0123456789abcdef";

describe("parsePulse", () => {
  it("reads a view", () => {
    const body = JSON.stringify({ t: "view", v: V, p: "/donate", r: "https://example.com/", u: { s: "newsletter", m: "email", c: "7" }, w: 390 });
    expect(parsePulse(body)).toEqual({
      t: "view",
      v: V,
      p: "/donate",
      r: "https://example.com/",
      u: { s: "newsletter", m: "email", c: "7" },
      w: 390,
    });
  });

  it("reads a view with nothing optional", () => {
    expect(parsePulse(JSON.stringify({ t: "view", v: V, p: "/" }))).toEqual({ t: "view", v: V, p: "/", r: "", u: {} });
  });

  it("reads a leave, capping the time at 30 minutes and the scroll at 100", () => {
    expect(parsePulse(JSON.stringify({ t: "leave", v: V, a: 5000, s: 140 }))).toEqual({ t: "leave", v: V, a: 1800, s: 100 });
    expect(parsePulse(JSON.stringify({ t: "leave", v: V, a: 12.6, s: 40 }))).toEqual({ t: "leave", v: V, a: 13, s: 40 });
  });

  it("reads a click, cutting a long label to 80 characters", () => {
    const parsed = parsePulse(JSON.stringify({ t: "click", v: V, k: "donate", l: "x".repeat(200) }));
    expect(parsed).toEqual({ t: "click", v: V, k: "donate", l: "x".repeat(80) });
  });

  it.each(["donate", "tickets", "phone", "email", "download", "outbound"])("accepts the click kind %s", (k) => {
    expect(parsePulse(JSON.stringify({ t: "click", v: V, k, l: "a" }))?.t).toBe("click");
  });

  it.each([
    ["not JSON", "hello"],
    ["an unknown event", JSON.stringify({ t: "scroll", v: V })],
    ["a bad view id", JSON.stringify({ t: "view", v: "not-hex!", p: "/" })],
    ["an unknown click kind", JSON.stringify({ t: "click", v: V, k: "hover", l: "a" })],
    ["a negative time", JSON.stringify({ t: "leave", v: V, a: -1, s: 0 })],
    ["a number for a path", JSON.stringify({ t: "view", v: V, p: 5 })],
    ["an array", "[]"],
    ["null", "null"],
  ])("drops %s", (_name, body) => {
    expect(parsePulse(body)).toBeNull();
  });

  it("drops a body over 2 KB", () => {
    expect(PULSE_MAX_BYTES).toBe(2048);
    const body = JSON.stringify({ t: "view", v: V, p: "/", r: "https://example.com/" + "a".repeat(2100) });
    expect(parsePulse(body)).toBeNull();
  });
});
