// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OUTCOMES } from "../../src/outreach/model";
import { OUTCOME_LABELS, OUTCOME_MEANINGS } from "../../src/outreach/outcomes";

// TASK-404: the page for one business. Reached by clicking a name, not from the nav, so it follows
// view-donor's shape. Its job is that a volunteer who has never seen this firm gets the whole
// history in one place - piecing it together from a list row is how somebody ends up asking the
// same business twice.

const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const app = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const view = doc.getElementById("view-business");

describe("the one-business page (TASK-404)", () => {
  it("exists, hidden, with a way back", () => {
    expect(view).not.toBeNull();
    expect(view?.hasAttribute("hidden")).toBe(true);
    expect(doc.getElementById("businessBack")?.textContent).toMatch(/back/i);
    expect(app).toContain('bindClick("businessBack", function () { selectView("outreach"); });');
  });

  // Deliberately NOT in the nav: it is about one business, so it is reached from that business.
  it("is not a nav destination", () => {
    const nav = [...doc.querySelectorAll(".admin-nav-link")].map((b) => b.getAttribute("data-view"));
    expect(nav).not.toContain("business");
  });

  it("opens when a name in the list is clicked", () => {
    expect(app).toContain('data-out-open="');
    expect(app).toContain('e.target.closest("[data-out-open]")');
    expect(app).toContain("openBusiness(Number(");
  });

  // The things a volunteer needs before picking up the phone, in one place.
  it.each([
    "Where it stands",
    "Contact",
    "Who knows them",
    "Looked after by",
    "Where the details came from",
    "They agreed to hear from us",
    "Why this business",
  ])("shows %s", (label) => {
    expect(app).toContain(`factRow("${label}"`);
  });

  it("makes the email and the phone number usable, not just readable", () => {
    expect(app).toContain('href="mailto:');
    expect(app).toContain('href="tel:');
  });
});

describe("recording what happened", () => {
  it("offers every outcome, with what each one means", () => {
    for (const outcome of OUTCOMES) {
      expect(app, `${outcome} label`).toContain(OUTCOME_LABELS[outcome]);
      expect(app, `${outcome} meaning`).toContain(OUTCOME_MEANINGS[outcome]);
    }
  });

  // One press, one effect, and the button says which. "Submit" would not.
  it("has a button that says what pressing it does", () => {
    expect(doc.getElementById("businessOutcomeSave")?.textContent?.trim()).toBe(
      "Save what happened",
    );
    expect(doc.getElementById("businessNoteAdd")?.textContent?.trim()).toBe("Add this note");
  });

  // A decline is the one outcome that takes something away: it puts the business permanently out
  // of the matcher's reach. It gets the pause.
  it("pauses before recording a decline, and says what that means", () => {
    expect(app).toMatch(/window\.confirm\([^;]*said no\?/);
    expect(app).toContain("They will not be contacted again.");
  });

  // "Not this year" is worth more than a no only if something remembers the date, and a date
  // field on any other outcome is a field people fill in for no reason.
  it("asks for a date only on not-this-year, and suggests one", () => {
    expect(doc.getElementById("businessAskAgainField")?.hasAttribute("hidden")).toBe(true);
    expect(app).toContain('picked.value === "not_this_year"');
    expect(app).toContain("d.setMonth(d.getMonth() + 11)");
  });

  it("explains why the date matters, rather than just labelling the box", () => {
    expect(view?.textContent).toMatch(/without one/i);
  });
});

describe("notes", () => {
  it("says who wrote each one and when", () => {
    expect(app).toContain("out-note-meta");
    expect(app).toContain("H.escapeHtml(n.author)");
    expect(app).toContain("H.fmtDate(n.createdAt)");
  });

  // They are disclosable if the business ever asks what we hold, and they cannot be tidied
  // afterwards. Both facts belong on screen, next to the box, not in a policy nobody reads.
  it("warns, where the note is typed, that it is permanent and disclosable", () => {
    const text = view?.textContent ?? "";
    expect(text).toMatch(/cannot be edited or deleted/i);
    expect(text).toMatch(/the business can ask to see them/i);
  });

  it("keeps the line breaks somebody typed", () => {
    expect(css).toMatch(/\.out-note-body\{[^}]*white-space:pre-wrap/);
  });

  it("has an empty state that says what to do", () => {
    expect(app).toContain("No notes yet.");
  });
});

describe("who knows them", () => {
  it("is asked for when a business is added", () => {
    expect(doc.getElementById("outWarmIntro")).not.toBeNull();
    expect(doc.querySelector('label[for="outWarmIntro"]')?.textContent).toMatch(
      /who do we know that knows them/i,
    );
    expect(app).toContain('warmIntro: (el("outWarmIntro").value || "").trim() || null');
  });

  // A separate field rather than a line in the note, because a chase list has to be able to say
  // "ask Sarah first" without reading free text nobody re-reads.
  it("is its own field, not folded into the private note", () => {
    expect(doc.getElementById("outWarmIntro")).not.toBe(doc.getElementById("outNote"));
    expect(app).toContain('factRow("Who knows them"');
  });
});

describe("permissions", () => {
  it("shows a viewer the page but neither form", () => {
    expect(app).toContain('el("businessOutcomeForm").hidden = !writable');
    expect(app).toContain('el("businessNoteForm").hidden = !writable');
  });
});
