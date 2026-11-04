// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderSignInPage, renderWelcomePage } from "../../src/elf/pages/sign-in";

// NBCC Elf Detective School: the sign in page and the welcome after paying, in paper
// (docs/superpowers/specs/2026-11-04-elf-paper-design.md). The signing in itself is tested in
// test/unit/elf-sign-in.test.ts. Every family here is invented.

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const css = readFileSync(resolve(__dirname, "../../assets/css/elf.css"), "utf8");

describe("the sign in page, in paper", () => {
  for (const stage of ["email", "code"] as const) {
    it(`asks for the ${stage} on a card sheet, with a crimson torn paper button`, () => {
      const doc = parse(renderSignInPage({ stage, email: "sam@example.com" }));
      expect(words(doc.querySelector(".elf-title h1#elf-sign-in-heading"))).toBe("Sign in to Detective HQ");
      const form = doc.querySelector("form.elf-sign-in")!;
      expect(form.classList.contains("elf-card")).toBe(true);
      expect(form.querySelector('button[type="submit"]')!.className).toBe("elf-btn elf-btn--crimson");
      expect(doc.querySelector(".site-main .btn")).toBeNull();
    });
  }

  it("still says what went wrong, and what went right, where a screen reader hears it", () => {
    const wrong = parse(renderSignInPage({ stage: "code", email: "sam@example.com", message: "That code has run out.", error: true }));
    expect(wrong.querySelector('[role="alert"].elf-sign-in__message.is-error')!.textContent).toBe("That code has run out.");
    const sent = parse(renderSignInPage({ stage: "code", email: "sam@example.com", message: "Check your email." }));
    expect(sent.querySelector('[role="status"].elf-sign-in__message.is-ok')!.textContent).toBe("Check your email.");
  });
});

describe("the welcome after paying, in paper", () => {
  it("thanks the family on a card sheet, with the painted presents and a fall of paper stars", () => {
    const doc = parse(renderWelcomePage({ state: "done" }));
    expect(words(doc.querySelector(".elf-title h1#elf-welcome-heading"))).toBe("Thank you, detectives enrolled!");
    const card = doc.querySelector(".elf-welcome.elf-card")!;
    expect(card.querySelector('a[href="/elf/sign-in"]')!.className).toBe("elf-btn elf-btn--crimson");
    const presents = [...doc.querySelectorAll("img.elf-welcome__present")].map((img) => img.getAttribute("src"));
    expect(presents).toEqual(["crimson", "holly", "cream"].map((c) => `/assets/img/elf/paper/deco/present-${c}.webp`));
    for (const img of doc.querySelectorAll("img.elf-welcome__present")) expect(img.getAttribute("alt")).toBe("");
    const stars = doc.querySelector(".elf-stars")!;
    expect(stars.getAttribute("aria-hidden")).toBe("true");
    expect(stars.querySelectorAll("i").length).toBeGreaterThanOrEqual(10);
    expect(doc.querySelector(".site-main .btn")).toBeNull();
  });

  it("waits on a card sheet too while the payment is checked, and looks again by itself", () => {
    const html = renderWelcomePage({ state: "checking" });
    const doc = parse(html);
    expect(words(doc.querySelector(".elf-title h1#elf-welcome-heading"))).toBe("We are just checking your payment");
    expect(doc.querySelector(".elf-welcome.elf-card")).not.toBeNull();
    expect(html).toContain('<meta http-equiv="refresh" content="3" />');
  });

  it("lets the paper stars fall only for a visitor happy with motion", () => {
    expect(css).toMatch(/@keyframes elf-fall/);
    expect(css).toMatch(/\.elf-stars i \{[^}]*clip-path/);
  });
});
