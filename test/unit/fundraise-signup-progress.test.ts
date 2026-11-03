// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiseSignUp } from "../../src/fundraising/render";
import { ALL_BUILT_IN_CATEGORIES, formCategories, memoryCategories, rememberCategories } from "../../src/fundraising/categories";

// The progress bar moves with every question (Jaimie, 2026-10-06). The five stages and their names
// stay; inside a stage the line to the next stage fills a little with each question answered, and
// the words say "question 3 of 11". The questions counted are the ones in play now, the same rule
// Next uses, so the total can grow as answers are given: the number they are on is never more than
// the total, and the bar never goes backwards on Next. And the thank you card lands clear of the
// fixed menu bar. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const stepsLib = require(resolve(ROOT, "assets/js/fundraise-steps.js"));
const { initFundraiseForm } = require(resolve(ROOT, "assets/js/fundraise.js"));
const template = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");
const joinTemplate = readFileSync(resolve(ROOT, "fundraise-join.html"), "utf8");
const socialHandles = require(resolve(ROOT, "assets/js/social-handles.js"));
const css = readFileSync(resolve(ROOT, "assets/css/fundraising.css"), "utf8").replace(/\r\n/g, "\n");

vi.setConfig({ testTimeout: 20_000 });

let calls: Array<{ url: string; init?: RequestInit }>;

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

function load() {
  rememberCategories(ALL_BUILT_IN_CATEGORIES);
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(renderFundraiseSignUp(template, true, formCategories(), memoryCategories()), "text/html")
    .documentElement.innerHTML;
  calls = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return url === "/api/fundraise/captcha" ? json(200, { siteKey: null }) : json(200, { status: "received" });
  });
  w.NBCCFormValidation = { validateForm: shared.validateForm, clearValidation: shared.clearValidation };
  w.NBCCSocialHandles = socialHandles;
  w.NBCCFormSteps = stepsLib;
  return initFundraiseForm(document, window);
}

const $ = <T extends HTMLElement = HTMLInputElement>(sel: string) => document.querySelector<T>(sel)!;
const flush = () => new Promise((r) => setTimeout(r, 0));
const type = (id: string, value: string) => {
  const el = $<HTMLInputElement>(`#${id}`);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const tick = (id: string) => {
  const el = $<HTMLInputElement>(`#${id}`);
  el.checked = true;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const next = () => $<HTMLButtonElement>("[data-next]").click();
const back = () => $<HTMLButtonElement>("[data-back]").click();
const current = () => document.querySelector<HTMLElement>("[data-step].is-current")!;
const has = (id: string) => current().contains(document.getElementById(id));
/** The whole line someone reads above the dots. */
const line = () => ($(".fr-progress__now").textContent ?? "").replace(/\s+/g, " ").trim();
/** "question 3 of 11" as numbers, or null when the stage has one question and nothing is said. */
const place = () => {
  const m = /question (\d+) of (\d+)/.exec(line());
  return m ? { at: Number(m[1]), of: Number(m[2]) } : null;
};
/** How far along the bar is, in stages: each line between two dots is worth one. */
const fills = () => [...document.querySelectorAll<HTMLElement>(".fr-progress__fill")].map((f) => Number(f.style.getPropertyValue("--fill")));
const filled = () => fills().reduce((a, b) => a + b, 0);
const stageAt = () => Number(/^Step (\d+) of/.exec(line())![1]);

/** Answers the step showing with whatever lets Next go on, without choosing a dead end. */
function answerStep() {
  const step = current();
  const open = (n: Element) => !n.closest("[hidden]");
  for (const id of ["over18Yes", "sharesNo", "teamMe", "sportingNo", "childMe", "orgNo", "listedYes", "dateTbc", "booking-donations", "memorySetupBy-family", "memoryPermission", "memoryShareYes", "shareMention"]) {
    const box = document.getElementById(id);
    if (box && step.contains(box) && open(box)) tick(id);
  }
  const groups = new Set<string>();
  step.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((r) => {
    if (open(r)) groups.add(r.name);
  });
  groups.forEach((name) => {
    const radios = [...step.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`)].filter(open);
    if (!radios.some((r) => r.checked) && radios[0]) tick(radios[0].id);
  });
  step.querySelectorAll<HTMLInputElement>("input[required], textarea[required], select[required]").forEach((box) => {
    if (!open(box) || box.type === "radio" || !box.id) return;
    if (box.type === "checkbox") return tick(box.id);
    if (box.value) return;
    if (box.tagName === "SELECT") {
      const options = (box as unknown as HTMLSelectElement).options;
      return type(box.id, options[1] ? options[1].value : "");
    }
    const words: Record<string, string> = { email: "alex@example.com", tel: "01632 960123", number: "50", date: "2030-06-01", time: "10:00" };
    type(box.id, box.id === "postPostcode" ? "KA7 0ZZ" : words[box.type] || "Example words");
  });
}

/** Walks a path to the last step, answering as it goes, and keeps what the bar said at each step. */
function walk(pathId: string) {
  tick(pathId);
  const seen: Array<{ line: string; stage: number; place: ReturnType<typeof place>; filled: number }> = [];
  const note = () => seen.push({ line: line(), stage: stageAt(), place: place(), filled: filled() });
  note();
  for (let i = 0; i < 60 && !$("[data-next]").hidden; i++) {
    const before = current();
    answerStep();
    next();
    if (current() === before) {
      const held = [...before.querySelectorAll('[aria-invalid="true"]')].map((n) => n.id).join(", ");
      throw new Error(`held at "${before.querySelector("legend, h2, label")?.textContent}" by: ${held}`);
    }
    note();
  }
  return seen;
}

describe("the words above the dots", () => {
  beforeEach(() => load());

  it("say which question of the stage they are on", () => {
    tick("pathRaising");
    expect(line()).toMatch(/^Step 1 of 5: Your fundraiser, question 1 of \d+$/);
    next();
    expect(line()).toMatch(/^Step 1 of 5: Your fundraiser, question 2 of \d+$/);
  });

  it("keep the stage and its name in the words they have always had", () => {
    expect($("[data-progress-step]").textContent).toBe("Step 1 of 5: Your fundraiser");
    expect($("[data-progress-step] .fr-progress__name").textContent).toBe(": Your fundraiser");
  });

  it("go back a question on Back", () => {
    tick("pathRaising");
    next();
    tick("over18Yes");
    next();
    expect(place()!.at).toBe(3);
    back();
    expect(place()!.at).toBe(2);
  });

  it("tell a screen reader the question too, once for each new step", () => {
    tick("pathRaising");
    next();
    expect($("[data-step-news]").textContent).toMatch(/^Step 1 of 5, Your fundraiser, question 2 of \d+: Are you 18 or over\?$/);
  });

  it("stay where they are for someone under 18, who goes no further", () => {
    tick("pathRaising");
    next();
    const before = { line: line(), filled: filled() };
    tick("over18No");
    next();
    expect(has("over18No")).toBe(true);
    expect(line()).toBe(before.line);
    expect(filled()).toBe(before.filled);
  });
});

describe.each([
  ["raising money", "pathRaising", "Your fundraiser"],
  ["holding an event", "pathEvent", "Your event"],
  ["in memory of someone", "pathMemory", "About them"],
])("all the way through, %s", (_name, pathId, firstStage) => {
  beforeEach(() => load());

  it("moves the bar on with every question, never back, and never counts past the total", () => {
    const seen = walk(pathId);
    expect(seen[0].line).toMatch(new RegExp(`^Step 1 of 5: ${firstStage}, question 1 of \\d+$`));
    expect(seen.length).toBeGreaterThan(8);
    for (let i = 0; i < seen.length; i++) {
      const s = seen[i];
      if (s.place) {
        expect(s.place.at, s.line).toBeGreaterThanOrEqual(1);
        expect(s.place.at, s.line).toBeLessThanOrEqual(s.place.of);
        expect(s.place.of, s.line).toBeGreaterThan(1);
      }
      expect(s.line).not.toMatch(/question 1 of 1$/);
      // Every Next moves the bar on: never back, and never standing still.
      if (i > 0) expect(s.filled, `${seen[i - 1].line} -> ${s.line}`).toBeGreaterThan(seen[i - 1].filled);
      expect(s.filled, s.line).toBeGreaterThanOrEqual(s.stage - 1);
      expect(s.filled, s.line).toBeLessThan(s.stage);
    }
    const last = seen[seen.length - 1];
    expect(last.stage).toBe(5);
    expect(last.filled).toBe(4);
    expect(current().hasAttribute("data-review-step")).toBe(true);
  });
});

describe("near the end", () => {
  beforeEach(() => load());

  it("keeps Nearly there! and Last step!, and says nothing of a stage with one question", () => {
    const seen = walk("pathRaising");
    expect(seen[seen.length - 1].line).toBe("Step 5 of 5: Check and send Last step!");
    // What you'd like is one question: the words are as they have always been.
    expect(seen.filter((s) => s.stage === 4).map((s) => s.line)).toEqual(["Step 4 of 5: What you'd like Nearly there!"]);
  });

  it("has no lift in memory of someone, only the place", () => {
    const seen = walk("pathMemory");
    expect(seen.map((s) => s.line).join(" ")).not.toMatch(/Nearly there|Last step/);
    expect(seen[seen.length - 1].line).toBe("Step 5 of 5: Check the details");
  });
});

describe("the line between the dots", () => {
  beforeEach(() => load());

  it("fills by the questions done in the stage they are on", () => {
    tick("pathRaising");
    expect(fills()).toEqual([0, 0, 0, 0]);
    next();
    tick("over18Yes");
    next();
    const p = place()!;
    expect(p.at).toBe(3);
    expect(fills()[0]).toBeCloseTo(2 / p.of, 5);
    expect(fills().slice(1)).toEqual([0, 0, 0]);
  });

  it("is drawn for the eye only: the words and the list say it for a screen reader", () => {
    const fill = $(".fr-progress__fill");
    expect(fill.getAttribute("aria-hidden")).toBe("true");
    expect($("[data-progress]").getAttribute("aria-label")).toBe("Your progress");
    expect(document.querySelectorAll('.fr-progress__stage[aria-current="step"]')).toHaveLength(1);
  });

  it("keeps the same dots from one question to the next, so the fill can glide", () => {
    tick("pathRaising");
    const first = $(".fr-progress__fill");
    next();
    expect($(".fr-progress__fill")).toBe(first);
  });
});

// The awkward case, on the mechanism itself: an answer reveals one more question in the stage.
describe("when an answer adds a question to the stage", () => {
  function tiny() {
    document.body.innerHTML = `
      <form>
        <nav data-progress hidden>
          <p class="fr-progress__now"><span data-progress-step></span><span data-progress-place></span><span data-progress-lift></span></p>
          <ol data-progress-list></ol>
        </nav>
        <p data-step-news></p>
        <fieldset data-step data-stage="1"><legend>One</legend></fieldset>
        <fieldset data-step data-stage="1"><legend>Two</legend></fieldset>
        <fieldset data-step data-stage="1"><legend>Three</legend></fieldset>
        <fieldset data-step data-stage="1" id="extra" hidden><legend>Extra</legend></fieldset>
        <fieldset data-step data-stage="2"><legend>Last</legend></fieldset>
        <div data-step-nav hidden><button type="button" data-back>Back</button><button type="button" data-next>Next</button></div>
      </form>`;
    const form = document.querySelector("form")!;
    return stepsLib.create(form, {
      doc: document,
      win: window,
      steps: [...form.querySelectorAll("[data-step]")],
      nav: form.querySelector("[data-step-nav]"),
      progress: form.querySelector("[data-progress]"),
      news: form.querySelector("[data-step-news]"),
      stages: () => ["First", "Second"],
      lift: (at: number) => (lifted && at === 1 ? "Nearly there!" : ""),
    });
  }
  let lifted = false;
  beforeEach(() => {
    lifted = false;
  });

  it("reads as a sentence when a lift follows the place", () => {
    lifted = true;
    tiny();
    expect(line()).toBe("Step 1 of 2: First, question 1 of 3. Nearly there!");
  });

  it("counts the new question at once, and holds the bar where it was until Next passes it", () => {
    const wizard = tiny();
    wizard.next();
    wizard.next();
    expect(line()).toBe("Step 1 of 2: First, question 3 of 3");
    expect(fills()[0]).toBeCloseTo(2 / 3, 5);
    // The answer on question 3 brings in a fourth.
    $("#extra").hidden = false;
    wizard.refresh();
    expect(line()).toBe("Step 1 of 2: First, question 3 of 4");
    // By the sums it would drop to 2/4: it is held where it was.
    expect(fills()[0]).toBeCloseTo(2 / 3, 5);
    wizard.next();
    expect(line()).toBe("Step 1 of 2: First, question 4 of 4");
    expect(fills()[0]).toBeCloseTo(3 / 4, 5);
    wizard.next();
    expect(line()).toBe("Step 2 of 2: Second");
    expect(fills()[0]).toBe(1);
  });

  it("never goes back on Next, even when the sums say so, and does go back on Back", () => {
    const wizard = tiny();
    wizard.next();
    expect(fills()[0]).toBeCloseTo(1 / 3, 5);
    $("#extra").hidden = false;
    wizard.refresh();
    expect(fills()[0]).toBeCloseTo(1 / 3, 5);
    wizard.back();
    expect(line()).toBe("Step 1 of 2: First, question 1 of 4");
    expect(fills()[0]).toBe(0);
    wizard.next();
    expect(fills()[0]).toBeCloseTo(1 / 4, 5);
  });
});

describe("the team join form, which shares the bar", () => {
  it("has the place for its words too", () => {
    expect(joinTemplate).toContain("data-progress-place");
    expect(template).toContain("data-progress-place");
  });
});

describe("the look of it", () => {
  const rule = (sel: string) => {
    const at = css.indexOf(`\n${sel} {`);
    return at === -1 ? "" : css.slice(at, css.indexOf("}", at));
  };

  it("glides only for those who have not asked for less motion", () => {
    expect(rule(".fr-progress__fill")).not.toContain("transition");
    const block = css.slice(css.indexOf("/* The fill glides"));
    expect(block.slice(0, 400)).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.fr-progress__fill \{ transition: transform/);
  });

  it("uses the page's own holly green, and no new colour", () => {
    expect(rule(".fr-progress__fill")).toContain("background: var(--holly)");
  });

  it("puts the place on a line of its own on a phone, so nothing wraps badly", () => {
    const phone = css.slice(css.indexOf("@media (max-width: 560px) {\n  .fr-progress {"));
    // The place, and the lift too (Last step! used to break over two lines).
    expect(phone.slice(0, 900)).toContain(".fr-progress__more { display: block;");
    expect(phone.slice(0, 900)).toContain(".fr-progress__more.has-place::first-letter { text-transform: uppercase; }");
    expect(phone.slice(0, 900)).toContain(".fr-progress__sep { display: none; }");
  });
});

describe("the thank you after Send", () => {
  beforeEach(() => load());

  it("lands clear of the fixed menu bar, the way the page's other jumps do", () => {
    expect(css).toMatch(/\n\.fr-thanks \{[^}]*scroll-margin-top: calc\(var\(--nav-h\) \+ 1rem\)/);
  });

  it("is scrolled to its top, with the focus on it", async () => {
    walk("pathRaising");
    const thanks = $<HTMLElement>("[data-fundraise-thanks]");
    const scrolled = vi.fn();
    const focused = vi.fn();
    thanks.scrollIntoView = scrolled;
    thanks.focus = focused;
    $("#fundraiseForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    await flush();
    expect(calls.some((c) => c.url === "/api/fundraise")).toBe(true);
    expect(thanks.hidden).toBe(false);
    // The focus must not drag the page itself: the scroll that follows puts the card's top under the bar.
    expect(focused).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrolled).toHaveBeenCalledWith({ block: "start" });
  });
});
