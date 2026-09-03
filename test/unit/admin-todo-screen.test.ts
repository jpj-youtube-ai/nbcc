// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-405: "Needs you today" and the search box. The list is the reason to open this screen, so
// it sits above the forms; the things it must not do are what these tests pin down.

const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const app = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const view = doc.getElementById("view-outreach")!;

describe("needs you today", () => {
  // It is the reason to open the screen. Below the add form it would be a thing you scroll past.
  it("sits above the forms, not below them", () => {
    const order = [...view.querySelectorAll("h3.admin-subhead")].map((h) => h.textContent?.trim());
    expect(order[0]).toBe("Needs you today");
  });

  it("is one list, not three", () => {
    expect(doc.getElementById("outTodo")).not.toBeNull();
    for (const id of ["outNudgeList", "outCallList", "outAskAgainList"]) {
      expect(doc.getElementById(id), `${id} should not exist`).toBeNull();
    }
  });

  // Showing everyone's work by default means two volunteers chase the same business; showing only
  // what is assigned means an unassigned business belongs to nobody. So the default is both.
  it("defaults to mine and unassigned, with everyone's one click away", () => {
    const buttons = [...view.querySelectorAll("[data-out-scope]")];
    expect(buttons.map((b) => b.getAttribute("data-out-scope"))).toEqual(["mine", "all"]);
    expect(buttons[0].textContent).toMatch(/mine and unassigned/i);
    expect(buttons[0].classList.contains("is-active")).toBe(true);
    expect(app).toContain('var outTodoScope = "mine"');
  });

  // Without a selected style both buttons read as pressed and you cannot tell which list you
  // are looking at. .admin-btn has no is-active state of its own.
  it("shows which of the two is selected", () => {
    expect(css).toContain(".out-scope .admin-btn.is-active");
    const buttons = [...view.querySelectorAll("[data-out-scope]")];
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(app).toContain('x.setAttribute("aria-pressed"');
  });

  it("counts a single day in the singular", () => {
    expect(app).toContain('" day over</span>"');
  });

  it("says how many are behind the other view, so the toggle is worth pressing", () => {
    expect(app).toContain("altogether across everyone");
  });

  // Nothing has been emailed yet, so this is what the charity will actually see on day one. It
  // has to explain itself rather than read as broken.
  it("has an empty state that says why it is empty", () => {
    expect(app).toContain("Nothing needs you right now.");
    expect(app).toMatch(/gone unanswered for a fortnight/);
    expect(app).toMatch(/a date you set has come round/);
  });

  // A list of names with no explanation gets skimmed once and then ignored.
  it("gives every row a reason and an action, not just a name", () => {
    expect(app).toContain("out-todo-why");
    expect(app).toContain("out-todo-do");
    expect(app).toContain("H.escapeHtml(t.reason)");
    expect(app).toContain("H.escapeHtml(t.action)");
  });

  it("opens the business when a row is clicked", () => {
    expect(app).toMatch(/el\("outTodo"\)\.addEventListener[\s\S]{0,200}openBusiness/);
  });

  it("refreshes itself when an outcome is recorded, because that changes the list", () => {
    expect(app).toMatch(/openBusiness\(businessId\);\s*\r?\n\s*loadOutreachTodo\(\);/);
  });

  it("names each kind in words a volunteer would use", () => {
    for (const phrase of ["Ask again", "Worth a call", "No reply", "Ready to send", "No address"]) {
      expect(app, phrase).toContain(phrase);
    }
  });

  // The only place semantic colour appears on this screen. A promise we made and a warm business
  // going cold are the two rows worth spotting without reading.
  it("marks a promise and a warm business differently from the rest", () => {
    expect(css).toContain(".out-todo-row--ask-again");
    expect(css).toContain(".out-todo-row--call");
  });
});

describe("the volunteer picker", () => {
  // Signing a thank-you letter and chasing a local business are different jobs. The old picker
  // offered the letter-signers, so somebody who only did the second could not be assigned one.
  it("offers the admin users, not the letter-signers", () => {
    expect(app).toContain("/api/admin/outreach/volunteers");
    expect(app).toMatch(/loadOutreachVolunteers[\s\S]{0,600}o\.value = v\.email/);
    expect(app).not.toMatch(/owner\.innerHTML[\s\S]{0,200}H\.SIGNERS/);
  });

  // A display name is what a person recognises; the address is what "mine" can be matched on.
  it("stores both the name and the address", () => {
    expect(app).toContain("owner: outOwnerName()");
    expect(app).toContain('ownerEmail: el("outOwner").value || null');
  });
});

describe("search", () => {
  it("filters the full list on what somebody would half-remember", () => {
    expect(doc.getElementById("outSearch")?.getAttribute("type")).toBe("search");
    expect(app).toContain("r.businessName, r.contactName, r.contactEmail, r.contactPhone, r.owner");
  });

  it("says how many matched", () => {
    expect(app).toContain('" of " + outRows.length + " businesses"');
  });

  it("has a different empty state when a search matches nothing", () => {
    expect(app).toContain("Nothing matches that.");
  });
});
