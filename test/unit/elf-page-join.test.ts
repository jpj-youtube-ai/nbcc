// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderJoinPage } from "../../src/elf/pages/join";
import { joinBodyFromForm, parseJoin } from "../../src/elf/join";
import { FESTIVE_SURNAMES } from "../../src/elf/names";
import { ELF_DEFAULTS } from "../../src/elf/settings";

// NBCC Elf Detective School: the page where a grown up enrols their detectives and pays what they
// can. Every family here is invented.

const SETTINGS = { ...ELF_DEFAULTS, schoolOn: true };
const view = (over = {}) => ({ settings: SETTINGS, captchaSiteKey: null, surnames: FESTIVE_SURNAMES, ...over });
const page = (over = {}) => new DOMParser().parseFromString(renderJoinPage(view(over)), "text/html");
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("the enrol page", () => {
  it("posts to the school's own address, and works without a script", () => {
    const form = page().querySelector("form.elf-join-form")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/api/elf/join");
    expect(page().querySelector('script[src="/assets/js/elf-join.js"]')).not.toBeNull();
  });

  it("gives every control a label", () => {
    const doc = page();
    for (const el of doc.querySelectorAll("input:not([type=hidden]), select, textarea")) {
      const id = el.getAttribute("id");
      const labelled = (id && doc.querySelector(`label[for="${id}"]`)) || el.closest("label") || el.getAttribute("aria-label");
      expect(labelled, `${el.outerHTML} has a label`).toBeTruthy();
    }
  });

  it("never asks for an age, a school or a real surname", () => {
    const doc = page();
    const names = [...doc.querySelectorAll("input, select, textarea")].map((el) => el.getAttribute("name") ?? "");
    for (const n of names) expect(n.toLowerCase()).not.toMatch(/age|school|birth|realsurname/);
    // The only "last name" on the page is the grown up's, for Gift Aid.
    expect(names.filter((n) => /last/i.test(n))).toEqual(["decl-lastName"]);
  });

  it("offers a festive surname from the list for every detective", () => {
    const selects = page().querySelectorAll('select[name$="-surname"]');
    expect(selects.length).toBeGreaterThanOrEqual(1);
    for (const s of selects) {
      const options = [...s.querySelectorAll("option")].map((o) => o.getAttribute("value")).filter(Boolean);
      expect(options).toEqual([...FESTIVE_SURNAMES]);
    }
  });

  it("suggests £5 for each detective and says any amount from £1", () => {
    const text = words(page().querySelector(".elf-join-pay"));
    expect(text).toContain("£5");
    expect(text).toContain("£1");
    expect(text).toContain("Pay what you can");
    const entry = page().querySelector('input[name="entry"]')!;
    expect(entry.getAttribute("value")).toBe("5");
  });

  it("puts Gift Aid only beside the gift, never the entry", () => {
    const doc = page();
    const giftAid = doc.querySelector('input[name="giftAid"]')!;
    expect(giftAid.closest(".elf-join-gift")).not.toBeNull();
    expect(words(doc.querySelector(".elf-join-pay"))).not.toContain("Gift Aid");
    expect(words(doc.querySelector(".elf-join-gift"))).toContain("I want to Gift Aid my donation");
  });

  it("leaves the newsletter box unticked", () => {
    const box = page().querySelector('input[name="newsletter"]')!;
    expect(box.hasAttribute("checked")).toBe(false);
  });

  it("shows what went wrong, and keeps what was typed", () => {
    const doc = page({ errors: ["Please pick a surname from the list for each detective."], values: { grownUpName: "Sam <Example>", email: "sam@example.com" } });
    expect(words(doc.querySelector(".elf-join-errors"))).toContain("Please pick a surname");
    expect(doc.querySelector('input[name="grownUpName"]')!.getAttribute("value")).toBe("Sam <Example>");
  });

  it("shows the check that stops robots when it is switched on", () => {
    expect(page().querySelector(".cf-turnstile")).toBeNull();
    expect(page({ captchaSiteKey: "1x00000000000000000000AA" }).querySelector(".cf-turnstile")!.getAttribute("data-sitekey")).toBe(
      "1x00000000000000000000AA",
    );
  });
});

describe("reading the plain form", () => {
  const form = {
    grownUpName: "Sam Example",
    email: "sam@example.com",
    "detective-1-first": "Ruby",
    "detective-1-surname": "Tinselfoot",
    "detective-2-first": "",
    "detective-2-surname": "Snowsleuth",
    "detective-3-first": "Leo",
    "detective-3-surname": "Frostwhistle",
    entry: "£10",
    donation: "2.50",
    agreed: "on",
  };

  it("turns pounds into pence and skips a detective left blank", () => {
    const body = joinBodyFromForm(form);
    expect(body).toMatchObject({ entryPence: 1000, donationPence: 250, agreed: true, giftAid: false, coverFee: false, newsletter: false });
    expect(body.detectives).toEqual([
      { firstName: "Ruby", surname: "Tinselfoot" },
      { firstName: "Leo", surname: "Frostwhistle" },
    ]);
    expect(parseJoin(SETTINGS, body).ok).toBe(true);
  });

  it("refuses an amount that is not money", () => {
    expect(parseJoin(SETTINGS, joinBodyFromForm({ ...form, entry: "ten" })).ok).toBe(false);
  });

  it("brings the Gift Aid declaration along only when Gift Aid is ticked", () => {
    const decl = { "decl-firstName": "Sam", "decl-lastName": "Example", "decl-houseNameNumber": "12", "decl-address": "Holly Lane, Troon", "decl-postcode": "KA10 6AA" };
    expect(joinBodyFromForm({ ...form, ...decl }).declaration).toBeUndefined();
    expect(joinBodyFromForm({ ...form, ...decl, giftAid: "on" }).declaration).toEqual({
      firstName: "Sam",
      lastName: "Example",
      houseNameNumber: "12",
      address: "Holly Lane, Troon",
      postcode: "KA10 6AA",
      nonUk: false,
    });
  });
});

// The paper look (docs/superpowers/specs/2026-11-04-elf-paper-design.md): the enrol page in paper.
describe("the enrol page, in paper", () => {
  const css = readFileSync(resolve(__dirname, "../../assets/css/elf.css"), "utf8");

  it("has its title on a torn strip", () => {
    const title = page().querySelector(".elf-title h1#elf-join-heading")!;
    expect(words(title)).toBe("Enrol your detectives");
  });

  it("sends people to pay with a crimson torn paper button, and uses none of the site's own buttons", () => {
    const doc = page();
    expect(doc.querySelector('form.elf-join-form button[type="submit"]')!.className).toBe("elf-btn elf-btn--crimson elf-btn--l");
    expect(doc.querySelector(".site-main .btn")).toBeNull();
  });

  it("ticks its boxes on little squares of paper, still real tick boxes", () => {
    for (const tick of page().querySelectorAll(".elf-tick input")) expect(tick.getAttribute("type")).toBe("checkbox");
    expect(css).toMatch(/\.elf-tick input \{[^}]*appearance:\s*none/);
    expect(css).toMatch(/\.elf-tick input:checked \{[^}]*background/);
    expect(css).toMatch(/\.elf-tick input:focus-visible \{[^}]*outline/);
  });
});

describe("adding a detective, signed in", () => {
  const signedIn = { grownUpName: "Sam Example", email: "sam@example.com" };

  it("asks only for the detectives and the payment, never the email again", () => {
    const doc = page({ signedIn });
    expect(doc.querySelector('input[name="email"]')).toBeNull();
    expect(doc.querySelector('input[name="grownUpName"]')).toBeNull();
    expect(words(doc.querySelector("h1"))).toBe("Add a detective");
    expect(words(doc.querySelector(".elf-join-you"))).toContain("sam@example.com");
  });

  it("still reads the plain form without the grown up's fields", () => {
    const body = joinBodyFromForm({ "detective-1-first": "Ivy", "detective-1-surname": "Snowsleuth", entry: "5", agreed: "on" });
    expect(body.detectives).toEqual([{ firstName: "Ivy", surname: "Snowsleuth" }]);
  });
});
