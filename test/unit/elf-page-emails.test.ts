// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderEmailsPage, type EmailsView } from "../../src/elf/pages/emails";
import { emailsView } from "./elf-fixtures";

// NBCC Elf Detective School, Christmas Eve and the grand prize (Plan 2c-2, Task 7): the page the link at the foot of
// a clue email, a promotion or a graduation opens. Following a link never changes anything, so the page asks, and
// only its button stops the emails or starts them again. It shows nothing of the family: not its name, nor its
// email. Every token here is invented (see elf-fixtures.ts).

const page = (v: EmailsView = emailsView()) => new DOMParser().parseFromString(renderEmailsPage(v), "text/html");
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
/** Everything the page's own part says, the site's banner and footer left out. */
const said = (v: EmailsView) => words(page(v).querySelector("main"));

const ASK =
  "Stop the emails from Elf Detective School? You will not get each door's first clue, or the emails when a detective is promoted or graduates. Everything stays in Detective HQ.";
const STOPPED = "You have stopped the emails from Elf Detective School. Everything is still in Detective HQ.";
const DONE_STOPPED = "Done. We will not send you these emails any more.";
const DONE_STARTED = "Done. They will start again with the next clue.";
const ALWAYS = "Sign in codes, payment receipts and the email when your family finds an elf first always come.";
const POST = "/elf/emails/0123456789abcdef0123456789abcdef";

/** The page's form: where it posts, what its hidden field sends, and its button's words. */
function formOf(v: EmailsView) {
  const form = page(v).querySelector<HTMLFormElement>("main form")!;
  return {
    method: form.getAttribute("method"),
    action: form.getAttribute("action"),
    stopped: form.querySelector<HTMLInputElement>('input[type="hidden"][name="stopped"]')!.value,
    button: words(form.querySelector('button[type="submit"]')),
  };
}

describe("the page the link to stop the emails opens", () => {
  it("is a private page called Your emails, under Elf Detective School's label", () => {
    const doc = page();
    expect(doc.title).toBe("Your emails | Night Before Christmas Campaign");
    expect(doc.querySelector('meta[name="robots"]')!.getAttribute("content")).toBe("noindex, nofollow");
    expect(doc.querySelectorAll("h1").length).toBe(1);
    expect(words(doc.querySelector(".elf-title h1"))).toBe("Your emails");
    expect(words(doc.querySelector("main .elf-label"))).toBe("Elf Detective School");
  });

  it("leads to Detective HQ from the strip under the site's banner", () => {
    expect(words(page().querySelector('nav.elf-bar a.elf-bar__go[href="/elf/hq"]'))).toBe("Detective HQ");
  });

  it("needs no script: its button is a plain form", () => {
    const scripts = [...page().querySelectorAll("script")].map((s) => s.getAttribute("src"));
    expect(scripts).toEqual(["/assets/js/main.js"]);
  });

  it("says what always comes, whatever the page is saying", () => {
    for (const v of [emailsView(), emailsView({ stopped: true }), emailsView({ stopped: true, said: "stopped" }), emailsView({ said: "started" })]) {
      expect(words(page(v).querySelector(".elf-emails__always")), JSON.stringify(v)).toBe(ALWAYS);
    }
  });
});

describe("the page while the emails are on", () => {
  it("asks whether to stop them, saying what stops and that everything stays in Detective HQ", () => {
    expect(words(page().querySelector(".elf-emails__now"))).toBe(ASK);
    expect(said(emailsView())).not.toContain("Done.");
  });

  it("stops them with its button, posting to the link's own address", () => {
    expect(formOf(emailsView())).toEqual({ method: "post", action: POST, stopped: "yes", button: "Stop these emails" });
  });
});

describe("the page once the emails are stopped", () => {
  it("says they are stopped and that everything is still in Detective HQ, and starts them again with its button", () => {
    const v = emailsView({ stopped: true });
    expect(words(page(v).querySelector(".elf-emails__now"))).toBe(STOPPED);
    expect(said(v)).not.toContain("Stop the emails from");
    expect(formOf(v)).toEqual({ method: "post", action: POST, stopped: "no", button: "Start them again" });
  });
});

describe("the page after its button", () => {
  it("says the emails are stopped, as a status, in place of what it said before, and can start them again", () => {
    const v = emailsView({ stopped: true, said: "stopped" });
    const status = page(v).querySelector('.elf-emails__said[role="status"]')!;
    expect(words(status)).toBe(DONE_STOPPED);
    expect(status.classList.contains("is-ok")).toBe(true);
    expect(said(v)).not.toContain(STOPPED);
    expect(page(v).querySelector(".elf-emails__now")).toBeNull();
    expect(formOf(v).button).toBe("Start them again");
  });

  it("says the emails start again with the next clue, and can stop them", () => {
    const v = emailsView({ said: "started" });
    expect(words(page(v).querySelector('.elf-emails__said[role="status"]'))).toBe(DONE_STARTED);
    expect(said(v)).not.toContain("Stop the emails from");
    expect(formOf(v)).toEqual({ method: "post", action: POST, stopped: "yes", button: "Stop these emails" });
  });
});

describe("what comes from data", () => {
  it("draws no button when its address is not on this site", () => {
    for (const postUrl of ["https://elsewhere.example/elf/emails/x", "//elsewhere.example/x", 'javascript:alert(1)', '/elf/emails/x" onclick="alert(1)']) {
      const doc = page(emailsView({ postUrl }));
      expect(doc.querySelector("form"), postUrl).toBeNull();
      expect(doc.documentElement.outerHTML).not.toContain("elsewhere");
      expect(doc.querySelector("[onclick]")).toBeNull();
      // It still says where the emails stand, and what always comes.
      expect(words(doc.querySelector(".elf-emails__now"))).toBe(ASK);
    }
  });

  it("reads an answer that is not one of its two as none, never writing it", () => {
    const html = renderEmailsPage({ ...emailsView(), said: '<img src=x onerror="alert(1)">' as unknown as EmailsView["said"] });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("&lt;img src=x");
    expect(words(new DOMParser().parseFromString(html, "text/html").querySelector(".elf-emails__now"))).toBe(ASK);
  });

  it("reads a stopped that is not true as on", () => {
    expect(formOf({ ...emailsView(), stopped: "yes" as unknown as boolean }).button).toBe("Stop these emails");
  });
});

// The paper look (docs/superpowers/specs/2026-11-04-elf-paper-design.md).
describe("the page, in paper", () => {
  const css = readFileSync(resolve(__dirname, "../../assets/css/elf.css"), "utf8");

  it("sets its words and its button on a taped note, as Detective HQ's case is", () => {
    const note = page().querySelector(".elf-emails-note")!;
    expect(note.classList.contains("elf-note")).toBe(true);
    expect(note.querySelector(":scope > .elf-tape")!.getAttribute("aria-hidden")).toBe("true");
    expect(note.querySelector("form")).not.toBeNull();
  });

  it("uses a crimson torn paper button, and none of the site's own buttons", () => {
    const doc = page();
    expect(doc.querySelector('main form button[type="submit"]')!.className).toBe("elf-btn elf-btn--crimson");
    expect(doc.querySelector(".site-main .btn")).toBeNull();
  });

  it("is styled, with its form drawn as no card of its own", () => {
    for (const rule of [".elf-emails-top .wrap", ".elf-emails-page", ".elf-emails-note .elf-emails__said"]) expect(css, rule).toContain(`${rule} {`);
    expect(css).toMatch(/form\.elf-emails \{[^}]*background:\s*none/);
  });
});
