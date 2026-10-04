import { describe, it, expect, vi } from "vitest";

// All emails (Admin > Fundraising): the one list of every email the fundraising, pledge, ticket and
// Festive Ball code can send. Each entry renders with the REAL builder and invented sample data, so
// what an admin reads here is what goes. Every name and address below is invented.

vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    PORTAL_BASE_URL: "https://nbcc.test",
    BALL_BASE_URL: "https://nbcc.test",
    BALL_FROM_EMAIL: "events@nbcc.test",
    FUNDRAISING_EMAIL: "events@nbcc.test",
    CONTACT_EMAIL: "hello@nbcc.test",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import {
  CATALOGUE,
  CATALOGUE_GROUPS,
  catalogueApprovalKeys,
  emailState,
  findEmail,
  findVersion,
  renderVersion,
} from "../../src/email/catalogue";
import { WORDING_KEYS } from "../../src/fundraising/touch-rules";
import { PLEDGE_WORDING_KEYS } from "../../src/pledges/model";
import { INVITE_WORDING_KEYS } from "../../src/fundraising/invite";

const BASE = "https://nbcc.test";

describe("the groups", () => {
  it("are the ten agreed, in the agreed order", () => {
    expect(CATALOGUE_GROUPS.map((g) => g.name)).toEqual([
      "Signing up and approval",
      "Invites from staff",
      "Teams",
      "Keeping in touch (automatic)",
      "Finishing and paying in",
      "In memory",
      "Sponsor pledges",
      "Event pages and tickets",
      "The Festive Ball",
      "Staff notices",
    ]);
  });

  it("every email is in a known group, and no group is empty", () => {
    const ids = CATALOGUE_GROUPS.map((g) => g.id);
    for (const e of CATALOGUE) expect(ids).toContain(e.group);
    for (const id of ids) expect(CATALOGUE.some((e) => e.group === id)).toBe(true);
  });

  it("keeps each group's emails together, in the order of the groups", () => {
    const order = CATALOGUE_GROUPS.map((g) => g.id);
    const seen = CATALOGUE.map((e) => order.indexOf(e.group));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });
});

describe("the entries", () => {
  it("lists all 69 emails from the audit", () => {
    expect(CATALOGUE.length).toBe(69);
  });

  it("gives each a unique, url safe id", () => {
    const ids = CATALOGUE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("gives each a name, a sentence about who gets it and when, and at least one version", () => {
    for (const e of CATALOGUE) {
      expect(e.name.trim(), e.id).not.toBe("");
      expect(e.who.trim(), e.id).toMatch(/\.$/);
      expect(["public", "staff"]).toContain(e.audience);
      expect(e.versions.length, e.id).toBeGreaterThan(0);
      const vids = e.versions.map((v) => v.id);
      expect(new Set(vids).size, e.id).toBe(vids.length);
      for (const v of e.versions) {
        expect(v.id, e.id).toMatch(/^[a-z0-9-]+$/);
        expect(v.label.trim(), e.id).not.toBe("");
      }
      expect(e.logKinds.length, e.id).toBeGreaterThan(0);
    }
  });

  it("staff notices are the staff emails, and every one of them carries the quiet note", () => {
    for (const e of CATALOGUE.filter((x) => x.group === "staff")) {
      expect(e.audience, e.id).toBe("staff");
      expect(e.note, e.id).toBeTruthy();
    }
  });

  it("follows the house style: no long dashes, no captain, T-shirt with a hyphen", () => {
    const words = [
      ...CATALOGUE_GROUPS.map((g) => g.name),
      ...CATALOGUE.flatMap((e) => [e.name, e.who, e.note ?? "", ...e.versions.map((v) => v.label)]),
    ].join("\n");
    expect(words).not.toMatch(/[–—]/);
    expect(words).not.toMatch(/captain/i);
    expect(words).not.toMatch(/t shirt|tshirt/i);
  });
});

describe("rendering", () => {
  it("renders every version of every email with the real builders", () => {
    for (const e of CATALOGUE) {
      for (const v of e.versions) {
        const mail = renderVersion(e, v, BASE);
        expect(mail.subject.trim(), `${e.id}/${v.id}`).not.toBe("");
        expect(mail.html, `${e.id}/${v.id}`).toMatch(/<(table|div|p)\b/i);
      }
    }
  });

  it("never shows a gap in the sample data: no undefined, NaN or object in what is read", () => {
    for (const e of CATALOGUE) {
      for (const v of e.versions) {
        const mail = renderVersion(e, v, BASE);
        const seen = (mail.subject + " " + mail.html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " "));
        expect(seen, `${e.id}/${v.id}`).not.toMatch(/\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b/);
        // A list with a gap in it joins to ", ,".
        expect(seen, `${e.id}/${v.id}`).not.toMatch(/,\s*,/);
      }
    }
  });

  it("only ever shows invented people: no address outside example.com and our own", () => {
    for (const e of CATALOGUE) {
      for (const v of e.versions) {
        const mail = renderVersion(e, v, BASE);
        const found = (mail.html + " " + mail.subject).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
        const strangers = found.filter((a) => !/@(example\.com|nbcc\.scot|nbcc\.test)$/i.test(a));
        expect(strangers, `${e.id}/${v.id}`).toEqual([]);
      }
    }
  });

  it("uses the address it is given for links, never a fixed one", () => {
    const e = findEmail("signup-page-live")!;
    expect(renderVersion(e, e.versions[0], "https://somewhere.test").html).toContain("https://somewhere.test/");
  });

  it("the versions of one email really differ", () => {
    for (const e of CATALOGUE.filter((x) => x.versions.length > 1)) {
      const bodies = e.versions.map((v) => {
        const m = renderVersion(e, v, BASE);
        return m.subject + "\n" + m.html;
      });
      expect(new Set(bodies).size, e.id).toBe(bodies.length);
    }
  });
});

describe("finding", () => {
  it("finds an email and a version by id, and nothing for an unknown one", () => {
    const e = findEmail("pledge-pay");
    expect(e?.name).toBeTruthy();
    expect(findVersion(e!, e!.versions[0].id)).toBe(e!.versions[0]);
    expect(findVersion(e!, "nope")).toBeNull();
    expect(findEmail("nope")).toBeNull();
    expect(findEmail("constructor")).toBeNull();
  });
});

describe("what is approval gated", () => {
  it("is exactly what is gated today: the automatic wording keys, the two pledge emails and the in memory invite", () => {
    const expected = [...WORDING_KEYS, ...PLEDGE_WORDING_KEYS, ...INVITE_WORDING_KEYS].sort();
    expect(catalogueApprovalKeys().sort()).toEqual(expected);
  });

  it("points each key at the endpoint that already approves it", () => {
    const paths = new Map<string, string>();
    for (const e of CATALOGUE) for (const v of e.versions) if (v.approval) paths.set(v.approval.key, v.approval.path);
    expect(paths.get("target")).toBe("/api/admin/fundraising/touch/approvals/target");
    expect(paths.get("finished_zero")).toBe("/api/admin/fundraising/touch/approvals/finished_zero");
    expect(paths.get("pledge_pay")).toBe("/api/admin/fundraising/pledges/approvals/pledge_pay");
    expect(paths.get("invite_memory")).toBe("/api/admin/fundraising/invite-wording/invite_memory/approval");
  });

  it("gates only the nothing raised version of How did it go? and A year ago today", () => {
    for (const id of ["touch-week-after", "touch-year-on"]) {
      const e = findEmail(id)!;
      const gated = e.versions.filter((v) => v.approval);
      expect(gated.map((v) => v.id), id).toEqual(["nothing-raised"]);
    }
  });

  it("gates both versions of the finished thank you, each with its own key", () => {
    const e = findEmail("touch-finished")!;
    expect(findVersion(e, "usual")!.approval!.key).toBe("finished");
    expect(findVersion(e, "nothing-raised")!.approval!.key).toBe("finished_zero");
  });

  it("gates every version of the in memory invite and of each pledge email with the one key", () => {
    for (const [id, key] of [["invite-memory", "invite_memory"], ["pledge-pay", "pledge_pay"], ["pledge-reminder", "pledge_reminder"]]) {
      const e = findEmail(id)!;
      expect(e.versions.map((v) => v.approval?.key), id).toEqual(e.versions.map(() => key));
    }
  });

  it("leaves the ungated emails alone", () => {
    for (const id of ["team-invite", "touch-first-gift", "pledge-confirm", "ball-confirmation", "invite-raising"]) {
      expect(findEmail(id)!.versions.every((v) => !v.approval), id).toBe(true);
    }
  });
});

describe("an email's state", () => {
  const e = () => findEmail("touch-finished")!;

  it("is nothing for an email with no approval", () => {
    expect(emailState(findEmail("team-invite")!, new Set())).toEqual({ state: null, waitingVersion: null });
  });

  it("is waiting, on the first version still to be signed off", () => {
    expect(emailState(e(), new Set())).toEqual({ state: "waiting", waitingVersion: "usual" });
    expect(emailState(e(), new Set(["finished"]))).toEqual({ state: "waiting", waitingVersion: "nothing-raised" });
  });

  it("is approved once every version that needs it has it", () => {
    expect(emailState(e(), new Set(["finished", "finished_zero"]))).toEqual({ state: "approved", waitingVersion: null });
  });
});
