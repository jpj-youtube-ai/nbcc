import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderBallPage, TICKET_INCLUDES } from "../../src/ball/page";

// TASK-333: what the ticket covers, and the start time.
//
// The inclusions sentence exists in two places by necessity: ball.html shows it before the
// venue has confirmed a menu, and page.ts appends the menu note to it afterwards. They are
// two hand-written copies of one sentence, which is exactly the shape that drifts — and the
// symptom would be the page saying different things depending on whether a note happened to
// be set, which nobody would think to check.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ballHtml = readFileSync(resolve(ROOT, "ball.html"), "utf8");
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

// Sliced rather than matched. Every regex I reached for here had to survive a template
// literal on the way into `new RegExp`, and the escaping silently produced a pattern that
// matched nothing — so the assertions passed a comparison of two empty strings.
const region = (html: string, name: string): string => {
  const marker = `data-region="${name}"`;
  const at = html.indexOf(marker);
  if (at === -1) return "";
  const open = html.indexOf(">", at);
  const close = html.indexOf("<", open);
  return collapse(html.slice(open + 1, close));
};

describe("what the ticket includes", () => {
  it("the page's fallback is the same sentence page.ts appends the menu note to", () => {
    expect(region(ballHtml, "included")).toBe(collapse(TICKET_INCLUDES));
  });

  // The ticket terms are the third hand-written copy, and they had already drifted: they
  // promised "a meal" where the page selling the ticket promised three courses and a welcome
  // drink. Terms that undercut the advert are the wrong way round, and this is the one place a
  // buyer looks when they think they were told something different.
  it("the ticket terms promise no less than the page that sold the ticket", () => {
    const terms = collapse(readFileSync(resolve(ROOT, "ball-terms.html"), "utf8"));
    expect(terms).toContain(collapse(TICKET_INCLUDES));
  });

  // TASK-336: this used to require the sentence to close with "further drinks are not included".
  // The risk it guarded is real - "a drink on arrival" reads to plenty of people as "drinks are
  // provided", and the difference gets discovered at the bar on the night - but NBCC solved it
  // in the noun instead: a WELCOME drink is self-evidently one drink at the start. The guard
  // moves to the word carrying that meaning, so it cannot quietly go back to "a drink".
  it("calls it a WELCOME drink, which is what makes the caveat unnecessary", () => {
    expect(TICKET_INCLUDES).toMatch(/welcome drink on arrival/i);
    expect(region(ballHtml, "included")).toMatch(/welcome drink on arrival/i);
  });

  it("no longer ends an advert on what the buyer is not getting", () => {
    expect(TICKET_INCLUDES).not.toMatch(/further drinks/i);
    expect(region(ballHtml, "included")).not.toMatch(/not included/i);
  });

  it("names the three courses and the welcome drink", () => {
    expect(TICKET_INCLUDES).toMatch(/three-course meal/i);
    expect(TICKET_INCLUDES).toMatch(/welcome drink/i);
  });

  // The menu note is APPENDED, never substituted: a note about the menu must not delete the
  // statement about drinks.
  it("keeps the whole sentence when staff add a menu note", () => {
    const out = renderBallPage(ballHtml, {
      gateOpen: true,
      settings: { arrivalTime: null, includedNote: "Menu choices will follow by email.", lineUpNote: null },
    });
    expect(region(out, "included")).toContain(collapse(TICKET_INCLUDES));
    expect(region(out, "included")).toContain("Menu choices will follow by email.");
  });
});

describe("the start time", () => {
  it("says 7pm, and says it is not confirmed", () => {
    for (const name of ["arrival", "arrival-2"]) {
      expect(region(ballHtml, name)).toMatch(/7pm/i);
      expect(region(ballHtml, name)).toMatch(/confirmed/i);
    }
  });

  // Once the venue confirms, the admin value replaces the estimate everywhere it appears.
  it("is replaced in both places once staff set the real time", () => {
    const out = renderBallPage(ballHtml, {
      gateOpen: true,
      settings: { arrivalTime: "7pm for 7.30pm", includedNote: null, lineUpNote: null },
    });
    expect(region(out, "arrival")).toBe("7pm for 7.30pm");
    expect(region(out, "arrival-2")).toBe("7pm for 7.30pm");
  });
});
