// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "my-story.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("my story page shell (REQ-NNN)", () => {
  it("has a centred intro whose H1 is 'Share your story'", () => {
    const intro = doc.querySelector("section.story-intro");
    expect(intro).not.toBeNull();
    expect(norm(intro?.querySelector("h1")?.textContent)).toBe("Share your story");
    expect(intro?.querySelector(".rule")).not.toBeNull();
  });
  it("writes the intro dash-free and names NBCC (REQ-031)", () => {
    const intro = norm(doc.querySelector("section.story-intro")?.textContent);
    expect(intro).toContain("NBCC");
    expect(intro).not.toMatch(/[–—-]/);
  });
});

describe("my story form structure (REQ-NNN)", () => {
  const form = doc.querySelector("#storyForm");
  const steps = [...(doc.querySelectorAll("[data-story-steps] .give-step") ?? [])];
  const field = (n: string) => form?.querySelector(`[name="${n}"]`);

  it("is a 3-step guided form with a progress list and a polite status region", () => {
    expect(form).not.toBeNull();
    expect(steps).toHaveLength(3);
    expect(doc.querySelector("[data-story-steps] .give-progress")).not.toBeNull();
    expect(doc.querySelector("#storyStatus")?.getAttribute("aria-live")).toBe("polite");
  });
  it("step 1 has the required role choice and required story textarea", () => {
    expect(field("submitterRole")).not.toBeNull();
    const story = field("storyText");
    expect(story?.tagName).toBe("TEXTAREA");
    expect(story?.hasAttribute("required")).toBe(true);
  });
  it("step 2 has the required use-scope choice and default-OFF identifier opt-ins", () => {
    expect(form?.querySelector('[name="useScope"][required]')).not.toBeNull();
    const first = field("shareFirstName") as HTMLInputElement | null;
    const town = field("shareTown") as HTMLInputElement | null;
    expect(first?.getAttribute("type")).toBe("checkbox");
    expect(first?.hasAttribute("checked")).toBe(false);
    expect(town?.hasAttribute("checked")).toBe(false);
  });
  it("step 3 fields are optional except the final confirm; 'how did you hear' is optional", () => {
    for (const n of ["firstName", "email", "phone", "ageBand", "gender", "town", "recipientType", "heardAbout"]) {
      expect(field(n), `#${n} present`).not.toBeNull();
      expect(field(n)?.hasAttribute("required"), `${n} optional`).toBe(false);
    }
    expect((field("confirmOver16") as HTMLInputElement)?.hasAttribute("required")).toBe(true);
  });
  it("has a hidden honeypot field named website", () => {
    const hp = field("website") as HTMLInputElement | null;
    expect(hp).not.toBeNull();
    expect(hp?.closest("[hidden], [aria-hidden='true']") || hp?.hasAttribute("hidden")).toBeTruthy();
  });
  it("writes the retention and withdrawal notice", () => {
    const text = norm(form?.textContent);
    expect(text.toLowerCase()).toContain("archive");
    expect(text.toLowerCase()).toContain("remove");
  });
  it("keeps the form copy dash-free (REQ-031)", () => {
    expect(norm(form?.textContent)).not.toMatch(/[–—-]/);
  });
});

import { readFileSync as read2 } from "node:fs";
describe("my story CSS is token-only (REQ-NNN)", () => {
  const css = read2(resolve(ROOT, "assets/css/styles.css"), "utf8");
  it("declares a MY STORY PAGE block", () => {
    expect(css).toMatch(/MY STORY PAGE/);
  });
  it("uses no raw hex or rgb in the story block", () => {
    const block = (css.split("MY STORY PAGE")[1] || "").split("/*")[0];
    expect(block.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(block.match(/\brgba?\(/gi) ?? []).toEqual([]);
  });
});

import { createRequire } from "node:module";
const require2 = createRequire(import.meta.url);

describe("my story stepping + validation (jsdom)", () => {
  const { initStorySteps } = require2(resolve(ROOT, "assets/js/main.js"));
  const formHtml = doc.querySelector("[data-story-steps]")?.outerHTML ?? "";
  const setVal = (n: string, v: string) => {
    (document.querySelector(`[name="${n}"]`) as HTMLInputElement | HTMLTextAreaElement).value = v;
  };
  const check = (n: string) => { (document.querySelector(`[name="${n}"]`) as HTMLInputElement).checked = true; };
  const clickNext = () => (document.querySelector("[data-story-next]") as HTMLButtonElement)?.click();
  const visibleStep = () =>
    [...document.querySelectorAll(".give-step")].find((s) => !(s as HTMLElement).hidden)?.getAttribute("data-step");

  beforeEach(() => {
    document.body.innerHTML = `<main>${formHtml}</main>`;
    (window as unknown as { fetch?: unknown }).fetch = undefined;
    initStorySteps(document, window);
  });

  it("exports initStorySteps", () => {
    expect(typeof initStorySteps).toBe("function");
  });
  it("starts on step 1 and blocks advancing until required fields are filled", () => {
    expect(visibleStep()).toBe("1");
    clickNext();
    expect(visibleStep()).toBe("1"); // still, story + role missing
    const err = document.querySelector('[data-err="1"]');
    expect(err?.classList.contains("show")).toBe(true);
  });
  it("advances to step 2 once role and story are provided", () => {
    check("submitterRole"); // first radio
    setVal("storyText", "The Red Bag brought my daughter such comfort.");
    clickNext();
    expect(visibleStep()).toBe("2");
  });
  it("reveals the public identifier opt-ins only when 'public' is chosen", () => {
    check("submitterRole");
    setVal("storyText", "A lovely moment.");
    clickNext();
    const publicRadio = document.querySelector('[name="useScope"][value="public"]') as HTMLInputElement;
    publicRadio.checked = true;
    publicRadio.dispatchEvent(new Event("change", { bubbles: true }));
    const reveal = document.querySelector('[data-reveal="public"]') as HTMLElement;
    expect(reveal.hidden).toBe(false);
  });
});
