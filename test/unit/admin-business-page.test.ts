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

// TASK-411: whether a supporter has been thanked, on the Business supporters tab.
describe("the thank-you column", () => {
  const app2 = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
  const css2 = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");

  // It is the one thing on that row that goes out on its own, so it earns a column rather than a
  // tick among the fulfilment flags.
  it("is its own column, next to the band", () => {
    expect(app2).toContain("<th>Thank you letter</th>");
    expect(app2).toContain("fulfilmentThankYouCell(r)");
  });

  it("says when it went, not just that it did", () => {
    expect(app2).toContain("H.fmtDate(r.thank_you_sent_at)");
  });

  // "Did a person do that, or did the system?" is the question somebody will actually ask.
  it("says whether a person or the system sent it", () => {
    expect(app2).toContain('r.thank_you_sent_by === "automatic"');
    expect(app2).toContain('"automatically"');
    expect(app2).toContain('"by " + H.escapeHtml(r.thank_you_sent_by');
  });

  // Not yet thanked is a normal state on a fresh supporter, so it is quiet rather than alarming.
  it("shows a calm not-yet rather than a warning", () => {
    expect(app2).toContain("Not yet");
    expect(css2).toContain(".fx-ty--waiting");
    expect(css2).toContain(".fx-ty--sent");
  });
});

// TASK-412: the two things that protect the charity rather than the workflow.
describe("the TPS check before a call", () => {
  const app3 = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");

  // Ringing a business on the Corporate TPS register is an offence. Bulk screening needs a paid
  // licence nobody is buying at this volume, so the control is that the number is not shown until
  // somebody says they have checked it, and their name and the date are kept.
  it("hides the number until somebody says they have checked", () => {
    expect(app3).toContain("Number hidden until checked");
    expect(app3).toContain("if (r.ctpsCheckedAt)");
  });

  it("says why, and links the free lookup rather than just refusing", () => {
    expect(app3).toMatch(/against the law/i);
    expect(app3).toContain("tpsservices.co.uk");
  });

  it("keeps who checked it and when, and shows that back", () => {
    expect(app3).toContain("Checked against the register");
    expect(app3).toContain("H.escapeHtml(r.ctpsCheckedBy)");
  });

  it("asks before recording, because it is an assertion a person is making", () => {
    expect(app3).toMatch(/window\.confirm\([^)]*TPS register/);
    expect(app3).toContain("Your name and today's date are kept with it.");
  });

  // A viewer cannot make that assertion, so they are not offered the button.
  it("offers the button only to somebody who can edit", () => {
    expect(app3).toMatch(/canEdit\("outreach"\)[\s\S]{0,200}businessCtps/);
  });
});

describe("what we hold, if they ask", () => {
  const app4 = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
  const doc4 = new DOMParser().parseFromString(html, "text/html");

  it("is one button on the business page", () => {
    expect(doc4.getElementById("businessDisclose")?.textContent).toMatch(/show everything we hold/i);
    expect(app4).toContain("/disclosure");
  });

  // It gets pasted into a reply, so copying it has to be one press rather than a careful drag.
  it("can be copied in one press", () => {
    expect(doc4.getElementById("businessDiscloseCopy")).not.toBeNull();
    expect(app4).toContain("navigator.clipboard.writeText");
    expect(app4).toMatch(/paste it into your reply/i);
  });

  // The promise the legitimate-interests assessment makes, said on the screen where the notes
  // are typed as well as in the document itself.
  it("says on screen that the private notes are included", () => {
    const view4 = doc4.getElementById("view-business");
    expect(view4?.textContent).toMatch(/including the private notes/i);
  });
});
