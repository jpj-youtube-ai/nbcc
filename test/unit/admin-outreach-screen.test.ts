// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-401: the Contact businesses screen in admin.html, and the browser code behind it.
//
// The matcher, the schemas and the email copy are proved DB-free elsewhere. What is worth pinning
// here is the screen itself: every control the volunteer needs exists, the preview is fetched from
// the server rather than re-built in the browser (so it cannot drift from what is sent), and the
// send is behind a deliberate pause. These are the things a refactor quietly breaks.

const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const app = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const view = doc.getElementById("view-outreach");

describe("the Contact businesses screen (TASK-401)", () => {
  it("is reachable from the nav, by the name the charity uses for it", () => {
    const link = [...doc.querySelectorAll(".admin-nav-link")].find(
      (b) => b.getAttribute("data-view") === "outreach",
    );
    expect(link?.textContent?.trim()).toBe("Contact businesses");
  });

  it("has its own view, hidden until chosen, and labelled for a screen reader", () => {
    expect(view).not.toBeNull();
    expect(view?.hasAttribute("hidden")).toBe(true);
    expect(doc.getElementById(view!.getAttribute("aria-labelledby")!)).not.toBeNull();
  });

  it("loads when the nav item is chosen", () => {
    expect(app).toContain('else if (name === "outreach") loadOutreach();');
  });

  // Everything a volunteer needs to record a business from one phone call.
  it.each([
    ["outBusinessName", "the business name"],
    ["outContactName", "who they spoke to"],
    ["outContactEmail", "the email address"],
    ["outContactPhone", "the phone number"],
    ["outBusinessType", "company or sole trader"],
    ["outOwner", "which volunteer is looking after them"],
    ["outNote", "why this business"],
  ])("asks for %s (%s)", (id) => {
    expect(doc.getElementById(id), `#${id}`).not.toBeNull();
  });

  it("labels every field, rather than relying on a placeholder", () => {
    for (const field of view!.querySelectorAll("input, select, textarea")) {
      const id = field.getAttribute("id");
      expect(id, `a field in the outreach view has no id: ${field.outerHTML}`).toBeTruthy();
      expect(doc.querySelector(`label[for="${id}"]`), `no <label> for #${id}`).not.toBeNull();
    }
  });

  // The phone number is what makes the follow-up call possible, so it has to be capturable at the
  // point the volunteer has it - not added later by someone editing the database.
  it("takes a phone number as a telephone field", () => {
    expect(doc.getElementById("outContactPhone")?.getAttribute("type")).toBe("tel");
  });

  it("warns about duplicates while the volunteer types, not after they commit", () => {
    expect(doc.getElementById("outWarnings")?.getAttribute("aria-live")).toBe("polite");
    expect(app).toContain('tyBindInput("outBusinessName", outCheckSoon)');
    expect(app).toContain('tyBindInput("outContactEmail", outCheckSoon)');
    expect(app).toContain("/api/admin/outreach/check");
  });

  // A decline is an instruction. The volunteer has to say, in as many words, that this is a
  // different business before the add is allowed through - and the server checks again.
  it("asks for an explicit acknowledgement before a declined business can be added", () => {
    expect(app).toContain("I have checked, and this is a different business");
    expect(app).toContain("payload.acknowledgedMatches = true");
  });

  it("dresses a do-not-contact warning differently from an ordinary one", () => {
    expect(css).toContain(".out-warn--stop");
    expect(app).toContain("out-warn--stop");
  });

  it("has the personal message box, and previews it as the volunteer types", () => {
    expect(doc.getElementById("outPersonal")).not.toBeNull();
    expect(app).toContain('tyBindInput("outPersonal", outPreviewSoon)');
  });

  // The preview is rendered by the server through the same builder the send uses. Re-implementing
  // the template in browser JavaScript would be faster and would start lying within a week.
  it("gets the preview from the server rather than building it in the browser", () => {
    expect(doc.getElementById("outPreview")?.tagName).toBe("IFRAME");
    expect(app).toContain("/api/admin/outreach/preview");
    expect(app).not.toMatch(/<!doctype html>/i);
  });

  it("gives the preview frame a title, so it is not an unlabelled frame", () => {
    expect(doc.getElementById("outPreview")?.getAttribute("title")).toBeTruthy();
  });

  it("puts one deliberate pause in front of a send", () => {
    expect(app).toContain("It goes straight to their inbox.");
    expect(app).toMatch(/window\.confirm\([^)]*goes straight to their inbox/);
  });

  // A Viewer can look at the list; only an Editor sees the two buttons that act.
  it("hides both actions from a viewer", () => {
    expect(app).toContain('var writable = canEdit("outreach")');
    expect(app).toContain('el("outAdd").hidden = !writable');
    expect(app).toContain('el("outSend").hidden = !writable');
  });

  // Offering a business that has no address, or one already emailed, is offering a send that is
  // going to fail or a business contacted twice.
  it("only offers businesses that can actually be sent to", () => {
    expect(app).toContain("return r.contactEmail && !r.sentAt;");
  });

  it("says where each business stands in words, not in codes", () => {
    for (const phrase of ["Signed up", "Not this year", "Said no", "Not emailed yet"]) {
      expect(app, phrase).toContain(phrase);
    }
  });

  it("keeps the block-caps rule: no shouting in the copy", () => {
    const text = (view?.textContent ?? "").replace(/NBCC|OSCR|PECR/g, "");
    expect(text).not.toMatch(/\b[A-Z]{4,}\b/);
  });
});
