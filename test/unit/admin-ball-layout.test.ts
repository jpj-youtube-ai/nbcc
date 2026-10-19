import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The Festive Ball admin screen's layout, and the safety net under it.
//
// TASK-422 turned thirteen interleaved sections into three bands with a jump bar. In October 2026
// Jaimie asked for a "huge visual overhaul" so it would read like a website and stop being "one
// big list of everything", and, twice, for nothing it does to change: "don't lose any
// functionality and don't change any of the functionality of the system". So the screen is now a
// band in the Ball's colours, six sections chosen with a row of buttons, and Set up as drop downs.
// Everything inside moved; nothing inside changed.
//
// THIS FILE IS THE SAFETY NET. The markup and the code are joined only by element ids, and nothing
// type-checks that join: a field that lost its id, or a button that became a link, still renders
// and simply does nothing when pressed. Every id the screen had before the overhaul is listed here
// with the element it was and its type. Losing one, or changing what one is, fails by name.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const admin = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

function ballView(): string {
  const start = admin.indexOf('id="view-ball"');
  const end = admin.indexOf('<section class="admin-view"', start + 10);
  return admin.slice(start, end === -1 ? undefined : end);
}

// Every element with an id in #view-ball on main at 2ad1e175, the day before the overhaul: the id,
// the element, and its type attribute when it had one. Captured by script from the file itself, not
// typed from memory. Do not prune or edit this list to make a test pass.
const BEFORE: ReadonlyArray<readonly [string, string, string]> = [
  ["ball-heading", "h2", ""], ["ballStats", "div", ""], ["ballGateState", "p", ""],
  ["ballGateForm", "form", ""], ["ballGateToggle", "button", "submit"],
  ["ballGateOpensAt", "input", "datetime-local"], ["ballGateSchedule", "button", "button"],
  ["ballGateStatus", "p", ""], ["ballPasswordForm", "form", ""], ["ballPreviewPassword", "input", "text"],
  ["ballPasswordSave", "button", "submit"], ["ballPasswordStatus", "p", ""], ["ballCapacityForm", "form", ""],
  ["ballTotalTables", "input", "number"], ["ballSeatsPerTable", "input", "number"],
  ["ballHeldSeats", "input", "number"], ["ballSalesCloseAt", "input", "datetime-local"],
  ["ballSalesClosed", "input", "checkbox"], ["ballCapacitySave", "button", "submit"],
  ["ballCapacityStatus", "p", ""], ["ballHoldForm", "form", ""], ["ballHoldName", "input", "text"],
  ["ballHoldQuantity", "input", "number"], ["ballHoldKind", "select", ""],
  ["ballHoldExpires", "input", "datetime-local"], ["ballHoldNote", "input", "text"],
  ["ballHoldSave", "button", "submit"], ["ballHoldStatus", "p", ""], ["ballHolds", "div", ""],
  ["ballFeeForm", "form", ""], ["ballCardFeePercent", "input", "number"], ["ballCardFeeFixed", "input", "number"],
  ["ballFeeSave", "button", "submit"], ["ballFeeExample", "p", ""], ["ballFeeStatus", "p", ""],
  ["ballTransferForm", "form", ""], ["ballTransferAccountName", "input", "text"],
  ["ballTransferSortCode", "input", "text"], ["ballTransferAccountNumber", "input", "text"],
  ["ballTransferLastDay", "input", "date"], ["ballTransferOn", "input", "checkbox"],
  ["ballTransferSave", "button", "submit"], ["ballTransferStatus", "p", ""], ["ballDetailsForm", "form", ""],
  ["ballArrivalTime", "input", "text"], ["ballIncludedNote", "input", "text"], ["ballLineUpNote", "input", "text"],
  ["ballDetailsSave", "button", "submit"], ["ballDetailsStatus", "p", ""], ["ballMenuForm", "form", ""],
  ["ballMenuOptions", "textarea", ""], ["ballMenuNote", "textarea", ""], ["ballMenuStatus", "span", ""],
  ["ballLockForm", "form", ""], ["ballLockAt", "input", "datetime-local"], ["ballLockStatus", "span", ""],
  ["ballAddTransferOpen", "button", "button"], ["ballAddTransferForm", "form", ""],
  ["ballAddQuantity", "input", "number"], ["ballAddKind", "select", ""], ["ballAddDonation", "input", "number"],
  ["ballAddFirstName", "input", "text"], ["ballAddSurname", "input", "text"], ["ballAddEmail", "input", "email"],
  ["ballAddBuyerPhone", "input", "tel"], ["ballAddInvoice", "input", "checkbox"], ["ballAddInvoiceFields", "div", ""],
  ["ballAddCompany", "input", "text"], ["ballAddAddress", "textarea", ""], ["ballAddPo", "input", "text"],
  ["ballAddAccountsEmail", "input", "email"], ["ballAddPhone", "input", "tel"], ["ballAddTerms", "input", "checkbox"],
  ["ballAddSave", "button", "submit"], ["ballAddCancel", "button", "button"], ["ballAddStatus", "p", ""],
  ["ballTransferSearch", "input", "search"], ["ballTransfers", "div", ""], ["ballExports", "p", ""],
  ["ballDoorList", "a", ""], ["ballCatering", "a", ""], ["ballBookingsCsv", "a", ""], ["ballNoPhone", "div", ""],
  ["ballNoPhoneCount", "b", ""], ["ballNoPhoneHow", "span", ""], ["ballNoPhoneOnlyLabel", "p", ""],
  ["ballNoPhoneOnly", "input", "checkbox"], ["ballBookings", "div", ""], ["ballMenuProgress", "div", ""],
  ["ballMenuOutstanding", "div", ""], ["ballGuestProgress", "div", ""], ["ballOutstanding", "div", ""],
  ["ballChase", "button", "button"], ["ballChaseStatus", "span", ""], ["ballSendReminders", "button", "button"],
  ["ballReminderCount", "span", ""], ["ballReminderStatus", "p", ""], ["ballSendMenuEmail", "button", "button"],
  ["ballMenuEmailCount", "span", ""], ["ballMenuEmailStatus", "p", ""],
];
// Only the jump links pointed at these three band headings, and the jump links are gone with the
// bands. No script ever reached for them (ball-admin-view.test.ts checks every id the code uses).
const RETIRED = ["ball-setup", "ball-state", "ball-send"];
// Something a person types into, chooses, presses or follows must still be exactly that.
// A box that only holds what the code writes into it (a div, a p, a span) may become another box.
const CONTROLS = new Set(["form", "input", "select", "textarea", "button", "a"]);

// Every element with an id in the view: [id, element, type].
function idsNow(view: string): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  for (const m of view.matchAll(/<(\w+)\b([^>]*?)\sid="([^"]+)"([^>]*)>/g)) {
    const attrs = m[2] + " " + m[4];
    out.push([m[3], m[1].toLowerCase(), (attrs.match(/\btype="([^"]+)"/) || [])[1] || ""]);
  }
  return out;
}

describe("nothing was lost in the overhaul", () => {
  const view = ballView();
  const now = new Map(idsNow(view).map(([id, tag, type]) => [id, { tag, type }]));

  it("captured the whole screen as it stood", () => {
    expect(BEFORE.length + RETIRED.length).toBe(103);
  });

  it.each(BEFORE.map(([id]) => [id]))("still has #%s", (id) => {
    expect(now.has(id), `#${id} is gone`).toBe(true);
  });

  it.each(BEFORE.filter(([, tag]) => CONTROLS.has(tag)).map(([id, tag, type]) => [id, tag, type]))(
    "#%s is still a <%s> of type %j",
    (id, tag, type) => {
      expect(now.get(id)).toEqual({ tag, type });
    },
  );

  it("retired only the three band headings, which only the jump links used", () => {
    for (const id of RETIRED) expect(now.has(id)).toBe(false);
    const code = read("assets/js/admin/app.js");
    for (const id of RETIRED) expect(code).not.toContain(id);
  });

  it("has every id once, so nothing was copied either", () => {
    const ids = idsNow(view).map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // A moved block that lost its <form> would still have every id and would still not save.
  it("keeps all ten forms, and no more", () => {
    expect((view.match(/<form\b/g) || []).length).toBe(10);
  });
});

// The parts, in the order you work: what is happening, the bookings and the money they owe, the
// guests' names and dinners, then the two emails that cannot be taken back, then the settings.
const SECTIONS: ReadonlyArray<readonly [string, string]> = [
  ["overview", "Overview"],
  ["bookings", "Bookings"],
  ["transfers", "Awaiting transfer"],
  ["guests", "Guests and menu"],
  ["emails", "Emails"],
  ["setup", "Set up"],
];

function part(view: string, name: string): string {
  const open = view.indexOf(`data-ball-part="${name}"`);
  expect(open, `no part for ${name}`).toBeGreaterThan(-1);
  const next = view.indexOf("data-ball-part=", open + 10);
  return view.slice(open, next === -1 ? undefined : next);
}

describe("the band at the top", () => {
  const view = ballView();
  const band = view.slice(view.indexOf('class="ball-hero"'), view.indexOf('id="ballSections"'));

  it("comes first, in the Ball's own colours, with the screen's heading in it", () => {
    expect(view.indexOf('class="ball-hero"')).toBeGreaterThan(-1);
    expect(view.indexOf('class="ball-hero"')).toBeLessThan(view.indexOf('id="ballSections"'));
    expect(band).toContain('<h2 id="ball-heading">Festive Ball</h2>');
  });

  it("says when and where, and the two prices printed in the advert", () => {
    expect(band).toContain("Saturday 7 November 2026");
    expect(band).toContain("The Park Hotel, Kilmarnock");
    expect(band).toContain("&pound;100");
    expect(band).toContain("&pound;1,000");
  });

  it("has a place for how long is left and for whether the ticket page is public", () => {
    expect(band).toMatch(/id="ballHeroCountdown"[^>]*data-ball-date="2026-11-07"/);
    expect(band).toContain('id="ballHeroPage"');
  });
});

describe("six sections, one on screen at a time", () => {
  const view = ballView();

  it("offers them as one row of buttons, in this order", () => {
    const row = view.slice(view.indexOf('id="ballSections"'), view.indexOf("</div>", view.indexOf('id="ballSections"')));
    const found = [...row.matchAll(/data-ball-section="([a-z]+)"[^>]*>([^<]+)</g)].map((m) => [m[1], m[2].trim()]);
    expect(found).toEqual(SECTIONS.map(([key, label]) => [key, label]));
    expect(row).toMatch(/role="group"/);
    // The first is pressed until the script says otherwise.
    expect(row).toMatch(/data-ball-section="overview"[^>]*aria-pressed="true"/);
  });

  // None is hidden by the markup. The script shows the chosen one before the screen is first drawn
  // (selectView, then loadBall, in one go; admin-ball-sections.test.ts checks only one shows). And a
  // browser that meets this page with the script from before it, for the minutes a deploy takes to
  // roll out, gets every section on one long page, as the screen used to be, not five it cannot reach.
  it("has one part for each, none hidden by the markup itself", () => {
    for (const [key] of SECTIONS) {
      const tag = view.slice(view.lastIndexOf("<", view.indexOf(`data-ball-part="${key}"`)), view.indexOf(">", view.indexOf(`data-ball-part="${key}"`)) + 1);
      expect(tag, key).not.toMatch(/\shidden[\s>]/);
    }
    expect((view.match(/data-ball-part="/g) || []).length).toBe(SECTIONS.length);
  });

  // The server tells staff to "Enter the bank details under Set up first", and the email to events@
  // about a new bank transfer booking says an admin "marks it paid under Festive Ball, Awaiting
  // transfer". Renaming either section would leave an email pointing at something that is not there,
  // and changing the email is not this job (nothing Ball related, emails least of all).
  it("keeps the two names an email and a server message point people to", () => {
    expect(read("src/ball/place-transfer-booking.ts")).toContain("Enter the bank details under Set up first.");
    expect(read("src/ball/transfer-staff-email.ts")).toContain("under Festive Ball, Awaiting transfer");
    expect(view).toMatch(/data-ball-section="setup"[^>]*>Set up</);
    expect(view).toMatch(/data-ball-section="transfers"[^>]*>Awaiting transfer</);
    expect(part(view, "transfers")).toContain(">Awaiting transfer</h3>");
  });

  it("puts each thing in the section it belongs to", () => {
    const where: Record<string, readonly string[]> = {
      overview: ["ballStats", "ballNeeds"],
      bookings: ["ballExports", "ballDoorList", "ballCatering", "ballBookingsCsv", "ballNoPhone", "ballNoPhoneOnly", "ballBookings"],
      transfers: ["ballTransferSearch", "ballAddTransferOpen", "ballAddTransferForm", "ballAddStatus", "ballTransfersFiltered", "ballShowAllTransfers", "ballTransfers"],
      guests: ["ballGuestProgress", "ballOutstanding", "ballChase", "ballChaseStatus", "ballMenuProgress", "ballMenuOutstanding"],
      emails: ["ballSendReminders", "ballReminderCount", "ballReminderStatus", "ballSendMenuEmail", "ballMenuEmailCount", "ballMenuEmailStatus"],
      setup: [
        "ballGateForm", "ballGateState", "ballGateStatus", "ballPasswordForm", "ballPasswordStatus", "ballCapacityForm",
        "ballCapacityStatus", "ballHoldForm", "ballHoldStatus", "ballHolds", "ballFeeForm", "ballFeeExample", "ballFeeStatus",
        "ballTransferForm", "ballTransferStatus", "ballDetailsForm", "ballDetailsStatus", "ballMenuForm", "ballMenuStatus",
        "ballLockForm", "ballLockStatus",
      ],
    };
    for (const [key, ids] of Object.entries(where)) {
      const body = part(view, key);
      for (const id of ids) expect(body, `#${id} should be in ${key}`).toContain(`id="${id}"`);
    }
  });

  // Each of the two emails everyone who has paid and cannot be taken back. They have a section of
  // their own, after the numbers that tell you whether to press them, with nothing else to press in it.
  it("keeps the two sends on their own, after the sections that tell you whether to send", () => {
    const body = part(view, "emails");
    const buttons = [...body.matchAll(/<button\b[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(buttons).toEqual(["ballSendReminders", "ballSendMenuEmail"]);
    expect(body).not.toMatch(/<form\b/);
    expect(view.indexOf('data-ball-part="guests"')).toBeLessThan(view.indexOf('data-ball-part="emails"'));
  });

  it("keeps the two chase lists together", () => {
    const body = part(view, "guests");
    expect(body).toContain('id="ballGuestProgress"');
    expect(body).toContain('id="ballMenuProgress"');
    // Names first: nobody can choose a dinner for a guest nobody has named.
    expect(body.indexOf('id="ballGuestProgress"')).toBeLessThan(body.indexOf('id="ballMenuProgress"'));
  });
});

describe("Set up as drop downs", () => {
  const NOW = ["page", "seats", "fee", "transfer", "details", "menu", "lock"];

  it("has seven, closed until opened, each saying on its closed line what it is set to", () => {
    const body = part(ballView(), "setup");
    const groups = [...body.matchAll(/<details class="ball-setting"([^>]*)>([\s\S]*?)<\/details>/g)];
    expect(groups.length).toBe(NOW.length);
    groups.forEach((g, i) => {
      expect(g[1]).not.toMatch(/\sopen\b/);
      const summary = g[2].slice(g[2].indexOf("<summary"), g[2].indexOf("</summary>"));
      expect(summary).toContain(`data-ball-now="${NOW[i]}"`);
    });
  });

  it("puts every settings form inside one of them", () => {
    const body = part(ballView(), "setup");
    const forms = [...body.matchAll(/<form id="([^"]+)"/g)].map((m) => m[1]);
    // The ten less the one that adds a booking, which lives with the bookings it adds to.
    expect(forms.length).toBe(9);
    for (const id of forms) {
      const at = body.indexOf(`<form id="${id}"`);
      expect(body.lastIndexOf("<details", at)).toBeGreaterThan(body.lastIndexOf("</details>", at));
    }
  });
});

describe("what the old layout used is gone with it", () => {
  const view = ballView();

  it("has no jump bar and no bands", () => {
    expect(view).not.toContain("admin-jump");
    expect(view).not.toContain("admin-band");
  });

  // House rule: the wording on screen has no en or em dashes.
  it("has no dash in anything it shows", () => {
    const shown = view.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ");
    expect(shown).not.toMatch(/&mdash;|&ndash;|—|–/);
  });
});

describe("the stylesheet", () => {
  const css = read("assets/css/admin.css");

  it("keeps the whole file parseable, since one stray */ silently kills every rule after it", () => {
    expect((css.match(/\/\*/g) || []).length).toBe((css.match(/\*\//g) || []).length);
    expect((css.match(/\{/g) || []).length).toBe((css.match(/\}/g) || []).length);
  });

  it("has nothing left for the jump bar or the bands, which nothing uses now", () => {
    expect(admin).not.toContain("admin-jump");
    expect(admin).not.toContain("admin-band");
    expect(css).not.toMatch(/\.admin-jump\b/);
    expect(css).not.toMatch(/\.admin-band\b/);
  });

  // The site wide form rule (styles.css) draws every form as a card, and a drop down already is one.
  it("draws the forms inside Set up flat, so there is no box in a box", () => {
    expect(css).toMatch(/#view-ball \.ball-setting-body form\{[^}]*background:none[^}]*border:0[^}]*box-shadow:none/);
  });

  it("sets the six section buttons out two by two on a phone, not in three ragged rows", () => {
    const phone = css.slice(css.indexOf("@media (max-width:760px)", css.indexOf("Festive Ball: the new look")));
    expect(phone).toMatch(/#view-ball \.ball-sections\{[^}]*display:grid[^}]*grid-template-columns:1fr 1fr/);
  });

  it("keeps a payment's lines together on a phone card, and Overdue in one piece", () => {
    expect(css).toMatch(/\.ball-cell\{[^}]*display:block/);
    expect(css).toMatch(/\.ball-cell \.admin-pill\{[^}]*white-space:nowrap/);
  });

  it("turns the two chase lists into labelled cards when they are narrow, as the payments are", () => {
    expect(css).toContain("#ballOutstanding,#ballMenuOutstanding{container:bclist / inline-size}");
    const at = css.indexOf("@container bclist (max-width:599px)");
    expect(at).toBeGreaterThan(-1);
    const narrow = css.slice(at, css.indexOf("\n}", at));
    expect(narrow).toMatch(/\.ball-chase-table td::before\{content:attr\(data-label\)/);
    expect(narrow).toMatch(/\.ball-chase-table thead\{[^}]*clip:rect\(0 0 0 0\)/);
    expect(narrow).toMatch(/\.ball-chase-table td:nth-child\(n\)\{width:auto\}/);
  });

  it("keeps Cancel and Release 44px tall, the size a thumb can hit", () => {
    expect(css).toMatch(/#view-ball \.ball-bookings-table \.btn-danger,#view-ball #ballHolds \.btn\{min-height:44px/);
  });

  // At 320px the band has 250px across, and two columns of at least 124px do not fit in it.
  it("lets the band's facts share a small phone's width", () => {
    const phone = css.slice(css.indexOf("@media (max-width:760px)", css.indexOf("Festive Ball: the new look")));
    expect(phone).toMatch(/#view-ball \.ball-hero-facts\{[^}]*grid-template-columns:repeat\(2,minmax\(0,auto\)\)/);
  });

  it("turns the seats held back list into labelled cards when it is narrow", () => {
    expect(css).toContain("#ballHolds{container:bhlist / inline-size}");
    const at = css.indexOf("@container bhlist (max-width:599px)");
    expect(at).toBeGreaterThan(-1);
    const narrow = css.slice(at, css.indexOf("\n}", at));
    expect(narrow).toMatch(/\.ball-holds-table td::before\{content:attr\(data-label\)/);
    expect(narrow).toMatch(/\.ball-holds-table thead\{[^}]*clip:rect\(0 0 0 0\)/);
    expect(narrow).toMatch(/\.ball-holds-table td\{[^}]*display:flex/);
  });

  it("makes every tick box on the screen a 44px target", () => {
    expect(css).toMatch(/#view-ball label\.ty-inline:has\(> input\[type="checkbox"\]\)\{min-height:44px/);
  });

  it("never draws an empty card where a list has nothing in it yet", () => {
    expect(css).toContain("#view-ball .admin-table-wrap:empty{display:none}");
  });

  // From TASK-454, still true: on a phone the long fields and the button rows wrap, never
  // drag the page sideways.
  it("does not let the 420px fields drag the page sideways on a phone", () => {
    const narrow = css.slice(css.indexOf("@media (max-width:760px)"));
    expect(narrow).toMatch(/\.ty-inline\{[^}]*max-width:100%/);
    expect(narrow).toMatch(/\.ty-inline input[^{]*\{[^}]*max-width:100%/);
    expect(narrow).toMatch(/\.admin-segmented\{[^}]*flex-wrap:wrap/);
  });

  // The nav going static on a phone was the original complaint: changing view meant scrolling
  // all the way back up a seven thousand pixel page.
  it("keeps the view switcher pinned on a phone instead of stranding it at the top", () => {
    const narrow = css.slice(css.indexOf("@media (max-width:860px)"));
    expect(narrow).toMatch(/\.admin-nav\{[^}]*position:sticky/);
    expect(narrow).toMatch(/\.admin-nav-toggle\{display:flex/);
    expect(narrow).not.toMatch(/\.admin-nav ul\{[^}]*overflow(-x)?:(auto|scroll)/);
    expect(narrow).toMatch(/\.admin-body-grid\{display:block\}/);
  });
});
