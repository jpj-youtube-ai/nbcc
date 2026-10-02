import { describe, it, expect } from "vitest";
import { instagramLink, facebookLink } from "../../src/fundraising/social";

// TASK-511: their Instagram and their Facebook, in boxes of their own. People type a handle (@name
// or name) or paste a link, with or without https, from the app or the website: each is tidied to
// one full link, and anything that is not an Instagram or a Facebook address is refused. https is
// never required. Every handle here is invented.

describe("Instagram", () => {
  it.each([
    ["@robin.bakes", "https://www.instagram.com/robin.bakes"],
    ["robin.bakes", "https://www.instagram.com/robin.bakes"],
    ["Robin_Bakes", "https://www.instagram.com/robin_bakes"],
    ["instagram.com/robin.bakes", "https://www.instagram.com/robin.bakes"],
    ["www.instagram.com/robin.bakes/", "https://www.instagram.com/robin.bakes"],
    ["http://instagram.com/robin.bakes", "https://www.instagram.com/robin.bakes"],
    ["https://www.instagram.com/robin.bakes?igsh=abc123", "https://www.instagram.com/robin.bakes"],
    ["https://instagram.com/robin.bakes/reels/", "https://www.instagram.com/robin.bakes"],
    ["  @robin.bakes  ", "https://www.instagram.com/robin.bakes"],
    ["https://m.instagram.com/robin.bakes#top", "https://www.instagram.com/robin.bakes"],
    // A name with a full stop that looks like a website is still a name.
    ["robin.me", "https://www.instagram.com/robin.me"],
  ])("tidies %j to the full link", (typed, link) => {
    expect(instagramLink(typed)).toEqual({ ok: true, link });
  });

  it("takes nothing as nothing", () => {
    expect(instagramLink("")).toEqual({ ok: true, link: null });
    expect(instagramLink("   ")).toEqual({ ok: true, link: null });
    expect(instagramLink("@")).toEqual({ ok: false, message: expect.any(String) });
  });

  it.each([
    "robin bakes", // a space is never in a handle
    "robin..bakes",
    ".robin",
    "robin.",
    "a".repeat(31),
    "https://www.facebook.com/robin.bakes", // the wrong website
    "https://evil.example/instagram.com/robin",
    "instagram.com.evil.example/robin",
    "https://www.instagram.com/", // no one in particular
    "https://www.instagram.com/p/C0abc123/", // a single post, not them
    "https://www.instagram.com/explore/tags/cakes",
    "javascript:alert(1)",
    "<script>",
  ])("refuses %j with a plain message", (typed) => {
    const r = instagramLink(typed);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Instagram/);
  });
});

describe("Facebook", () => {
  it.each([
    ["robinbakes", "https://www.facebook.com/robinbakes"],
    ["@Robin.Bakes", "https://www.facebook.com/Robin.Bakes"],
    ["facebook.com/robinbakes", "https://www.facebook.com/robinbakes"],
    ["www.facebook.com/robinbakes/", "https://www.facebook.com/robinbakes"],
    ["https://m.facebook.com/robinbakes?ref=share", "https://www.facebook.com/robinbakes"],
    ["http://fb.com/robinbakes", "https://www.facebook.com/robinbakes"],
    ["https://www.facebook.com/groups/exampleton.bakers", "https://www.facebook.com/groups/exampleton.bakers"],
    ["https://www.facebook.com/events/123456789/", "https://www.facebook.com/events/123456789"],
    ["https://www.facebook.com/profile.php?id=100012345678901&ref=x", "https://www.facebook.com/profile.php?id=100012345678901"],
    ["https://www.facebook.com/share/1AbC2dEf3G/", "https://www.facebook.com/share/1AbC2dEf3G"],
    ["web.facebook.com/robin-bakes-123", "https://www.facebook.com/robin-bakes-123"],
  ])("tidies %j to the full link", (typed, link) => {
    expect(facebookLink(typed)).toEqual({ ok: true, link });
  });

  it("takes nothing as nothing", () => {
    expect(facebookLink("")).toEqual({ ok: true, link: null });
  });

  it.each([
    "Robin Bakes", // a name with a space, not the address
    "https://www.instagram.com/robinbakes",
    "https://facebook.com.evil.example/robin",
    "https://evil.example/facebook.com/robin",
    "https://www.facebook.com/",
    "https://www.facebook.com/profile.php", // no id
    "https://www.facebook.com/profile.php?id=abc",
    "https://www.facebook.com/robin<b>",
    "javascript:alert(1)",
    "x".repeat(301),
  ])("refuses %j with a plain message", (typed) => {
    const r = facebookLink(typed);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Facebook/);
  });
});
