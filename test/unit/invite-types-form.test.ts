// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiseSignUp } from "../../src/fundraising/render";

// Invite types (Jaimie, B1 + I1): an invite says what the person was invited to do, and its link
// opens the sign up form at the right place: the first question already answered (and A team chosen
// at the team step, for a team). They can still change it. The name and email are filled in as
// before; the 18 or over answer, consents and permissions never are. Every name and address here is
// invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initFundraiseForm } = require(resolve(ROOT, "assets/js/fundraise.js"));
const template = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");
const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const WHO = { name: "Mary Sample", firstName: "Mary", lastName: "Sample", email: "mary@example.com" };

let inviteAnswer: { status: number; body: unknown };

function load(search: string) {
  window.history.replaceState({}, "", "/fundraise" + search);
  document.documentElement.innerHTML = new DOMParser().parseFromString(renderFundraiseSignUp(template, true), "text/html").documentElement.innerHTML;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).fetch = vi.fn((url: string) => {
    const a = url === "/api/fundraise/invite" ? inviteAnswer : { status: 200, body: { siteKey: null } };
    return Promise.resolve({ ok: a.status >= 200 && a.status < 300, status: a.status, json: () => Promise.resolve(a.body) });
  });
  return initFundraiseForm(document, window);
}
const $ = (sel: string) => document.querySelector<HTMLInputElement>(sel)!;
const text = (sel: string) => ($(sel).textContent || "").replace(/\s+/g, " ").trim();
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
const chosen = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? "";
const currentStep = () => document.querySelector<HTMLElement>("[data-step].is-current")!;
async function open(more: Record<string, unknown>) {
  inviteAnswer = { status: 200, body: { ...WHO, ...more } };
  const form = load(`?invite=${TOKEN}`);
  await settle();
  return form;
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
});
beforeEach(() => {
  inviteAnswer = { status: 200, body: WHO };
});

describe("a form opened from an invite that says what it is for", () => {
  it("opens on I'm raising money", async () => {
    await open({ path: "raising" });
    expect(chosen("path")).toBe("raising");
    expect($("#pathRaising").checked).toBe(true);
    // Just me or a team is still theirs to answer.
    expect(chosen("team")).toBe("");
    expect($("#firstName").value).toBe("Mary");
    expect($("#lastName").value).toBe("Sample");
    expect($("#email").value).toBe("mary@example.com");
  });

  it("opens on raising money with A team chosen at the team step", async () => {
    await open({ path: "raising", team: "team" });
    expect(chosen("path")).toBe("raising");
    expect(chosen("team")).toBe("team");
    expect($("#teamYes").checked).toBe(true);
    // The team step is in play, with the team's own boxes showing.
    expect(document.querySelector<HTMLElement>("[data-team-step]")!.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("[data-team-fields]")!.hidden).toBe(false);
  });

  it("opens on I'm holding an event", async () => {
    await open({ path: "event" });
    expect(chosen("path")).toBe("event");
    expect($("#pathEvent").checked).toBe(true);
    // An event has no team step.
    expect(document.querySelector<HTMLElement>("[data-team-step]")!.hidden).toBe(true);
  });

  it("opens on a page in memory of someone, with the gentle words at the top", async () => {
    await open({ path: "memory" });
    expect(chosen("path")).toBe("memory");
    expect($("#pathMemory").checked).toBe(true);
    expect(text("#fundraise-heading")).toBe("A page in their memory");
    expect(document.querySelector<HTMLElement>("[data-memory-step]")!.hidden).toBe(false);
  });

  it("stays on the first question, so they see the choice and can change it", async () => {
    await open({ path: "memory" });
    expect(currentStep().contains($("#pathMemory"))).toBe(true);
    $("#pathEvent").checked = true;
    $("#pathEvent").dispatchEvent(new Event("change", { bubbles: true }));
    expect(chosen("path")).toBe("event");
    expect(text("#fundraise-heading")).not.toBe("A page in their memory");
  });

  it("never answers 18 or over, a consent or a permission for them", async () => {
    const answered = () =>
      Array.from(document.querySelectorAll<HTMLInputElement>('#fundraiseForm input[type="radio"]:checked, #fundraiseForm input[type="checkbox"]:checked'))
        .map((c) => c.name)
        .sort();
    // What the page itself starts with ticked, with no invite at all.
    load("");
    await settle();
    const plain = answered();
    for (const more of [{ path: "raising" }, { path: "raising", team: "team" }, { path: "event" }, { path: "memory" }]) {
      await open({ ...more, over18: "yes", memoryPermission: true, newsletterOk: true, socialOk: true });
      expect(chosen("over18")).toBe("");
      for (const id of ["memoryPermission", "newsletterOk", "socialOk"]) expect(document.querySelector<HTMLInputElement>(`#${id}`)?.checked ?? false).toBe(false);
      // The only answers given for them: the first question, and A team when invited as a team.
      expect(answered()).toEqual([...plain, "path", ...("team" in more ? ["team"] : [])].sort());
    }
  }, 30000); // five page loads

  it("leaves a choice they have already made alone", async () => {
    inviteAnswer = { status: 200, body: { ...WHO, path: "memory" } };
    load(`?invite=${TOKEN}`);
    $("#pathEvent").checked = true;
    $("#pathEvent").dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(chosen("path")).toBe("event");
    expect(text("#fundraise-heading")).not.toBe("A page in their memory");
  });

  it("takes no notice of a place that is not one", async () => {
    await open({ path: "wedding", team: "everyone" });
    expect(chosen("path")).toBe("");
    expect(chosen("team")).toBe("");
    expect($("#firstName").value).toBe("Mary");
  });

  it("does not choose a team for anything but raising money", async () => {
    await open({ path: "event", team: "team" });
    expect(chosen("team")).toBe("");
  });
});

describe("a form opened from an invite with no type", () => {
  it("opens as it always did, with nothing chosen", async () => {
    await open({});
    expect(chosen("path")).toBe("");
    expect(chosen("team")).toBe("");
    expect($("#firstName").value).toBe("Mary");
    expect($("#email").value).toBe("mary@example.com");
  });
});
