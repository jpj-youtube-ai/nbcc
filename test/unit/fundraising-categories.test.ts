import { describe, it, expect, beforeEach } from "vitest";
import {
  BUILT_IN_CATEGORIES,
  LEGACY_CATEGORIES,
  OTHER_KIND,
  STARTING_CATEGORIES,
  categoryKeyFor,
  categoryLabel,
  categoryLabelSchema,
  formCategories,
  isActiveCategory,
  isKind,
  rememberCategories,
  sortCategories,
  type Category,
} from "../../src/fundraising/categories";
import { adminPatchSchema, publicCard, signUpSchema, meter, type FundraiserRecord } from "../../src/fundraising/model";

// Fundraising categories: one category each, A to Z, and staff can add more. The pure rules: the
// starting list, the old categories kept for the sign ups that chose them, the order on the form,
// the names people read, and which keys a sign up may use. Every name here is invented.

beforeEach(() => rememberCategories(BUILT_IN_CATEGORIES));

const labels = (list: Category[]) => list.map((c) => c.label);

describe("the starting list", () => {
  it("is one category each, A to Z, with Something else last", () => {
    expect(labels(formCategories())).toEqual([
      "Bake sale",
      "Birthday",
      "Coffee morning",
      "Party",
      "Quiz",
      "Run",
      "Santa dash",
      "School collection",
      "Walk",
      "Workplace collection",
      "Something else",
    ]);
  });

  it("names each as a plain noun: no 'A ...', no 'this or that'", () => {
    for (const c of STARTING_CATEGORIES) {
      expect(c.label).not.toMatch(/^An? /);
      expect(c.label).not.toMatch(/ or /);
      expect(c.label).toMatch(/^[A-Z]/);
      expect(c.active).toBe(true);
    }
  });

  it("keeps Something else under its old key, so its text box still works", () => {
    expect(formCategories().at(-1)).toMatchObject({ key: OTHER_KIND, label: "Something else" });
    expect(OTHER_KIND).toBe("other");
  });

  it("keeps the keys that never changed meaning (Santa dash, Birthday)", () => {
    expect(categoryLabel("santa_dash")).toBe("Santa dash");
    expect(categoryLabel("birthday")).toBe("Birthday");
    expect(isActiveCategory("santa_dash")).toBe(true);
    expect(isActiveCategory("birthday")).toBe(true);
  });
});

describe("the old categories", () => {
  it("are kept, no longer offered, and still named for the sign ups that chose them", () => {
    expect(LEGACY_CATEGORIES.map((c) => [c.key, c.label, c.active])).toEqual([
      ["run_walk", "Run or walk", false],
      ["bake_sale", "Bake sale or coffee morning", false],
      ["quiz_party", "Quiz or party", false],
      ["collection", "Workplace or school collection", false],
    ]);
    for (const c of LEGACY_CATEGORIES) {
      expect(categoryLabel(c.key)).toBe(c.label);
      expect(isActiveCategory(c.key)).toBe(false);
    }
    expect(formCategories().map((c) => c.key)).not.toEqual(expect.arrayContaining(["run_walk"]));
  });

  it("never share a key with a new one", () => {
    const keys = BUILT_IN_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("a category's name", () => {
  it("is the stored one once the list has been read", () => {
    rememberCategories([...BUILT_IN_CATEGORIES, { key: "sponsored_silence", label: "Sponsored silence", active: true }]);
    expect(categoryLabel("sponsored_silence")).toBe("Sponsored silence");
    rememberCategories(BUILT_IN_CATEGORIES.map((c) => (c.key === "quiz" ? { ...c, label: "Quiz night" } : c)));
    expect(categoryLabel("quiz")).toBe("Quiz night");
  });

  it("falls back to the built in names, then to the key made readable, and never to nothing", () => {
    rememberCategories([]);
    expect(categoryLabel("run_walk")).toBe("Run or walk");
    expect(categoryLabel("bake_sale_2")).toBe("Bake sale");
    expect(categoryLabel("sponsored_silence")).toBe("Sponsored silence");
    expect(categoryLabel("")).toBe("Something else");
  });
});

describe("the order", () => {
  it("is A to Z whatever the case or the order they came in, with Something else last", () => {
    const list: Category[] = [
      { key: "other", label: "Something else", active: true },
      { key: "zumba", label: "zumba class", active: true },
      { key: "abseil", label: "Abseil", active: true },
      { key: "matches", label: "Matched giving", active: true },
    ];
    expect(sortCategories(list).map((c) => c.key)).toEqual(["abseil", "matches", "zumba", "other"]);
  });

  it("puts a category staff add into its place, A to Z", () => {
    rememberCategories([...BUILT_IN_CATEGORIES, { key: "sponsored_silence", label: "Sponsored silence", active: true }]);
    const shown = labels(formCategories());
    expect(shown.indexOf("Sponsored silence")).toBe(shown.indexOf("School collection") + 1);
    expect(shown.at(-1)).toBe("Something else");
  });

  it("leaves a hidden category off the form", () => {
    rememberCategories(BUILT_IN_CATEGORIES.map((c) => (c.key === "party" ? { ...c, active: false } : c)));
    expect(labels(formCategories())).not.toContain("Party");
    expect(isActiveCategory("party")).toBe(false);
    expect(categoryLabel("party")).toBe("Party");
  });
});

describe("a new category's key", () => {
  it("is made from its name, in small letters and underscores", () => {
    expect(categoryKeyFor("Sponsored silence", [])).toBe("sponsored_silence");
    expect(categoryKeyFor("  Fun   Run! ", [])).toBe("fun_run");
    expect(categoryKeyFor("Café crawl", [])).toBe("cafe_crawl");
  });

  it("never takes a key already used, old ones included", () => {
    expect(categoryKeyFor("Bake sale", ["bake_sale"])).toBe("bake_sale_2");
    expect(categoryKeyFor("Bake sale", ["bake_sale", "bake_sale_2"])).toBe("bake_sale_3");
  });

  it("starts with a letter and stays short", () => {
    expect(categoryKeyFor("5k run", [])).toBe("k_5k_run");
    expect(categoryKeyFor("x".repeat(80), []).length).toBeLessThanOrEqual(40);
    expect(categoryKeyFor("!!!", [])).toBe("category");
  });
});

describe("the name staff type for a category", () => {
  const parse = (v: unknown) => categoryLabelSchema.safeParse(v);

  it("is tidied: trimmed, single spaced, a capital first", () => {
    expect(parse("  sponsored   silence ").data).toBe("Sponsored silence");
  });

  it.each([
    ["nothing", ""],
    ["one letter", "a"],
    ["too long", "a".repeat(41)],
    ["not words", "<b>Quiz</b>"],
    ["not text", 5],
  ])("is refused when it is %s", (_why, value) => {
    expect(parse(value).success).toBe(false);
  });

  it("takes apostrophes and ampersands", () => {
    expect(parse("Pie & mash night").data).toBe("Pie & mash night");
    expect(parse("Mum's tea party").data).toBe("Mum's tea party");
  });
});

describe("isKind, for code that suggests things by kind", () => {
  it("matches a key exactly", () => {
    expect(isKind("santa_dash", "santa_dash")).toBe(true);
    expect(isKind("quiz", "party")).toBe(false);
  });

  it("matches an old category to the ones it was split into, either way round", () => {
    for (const k of ["bake_sale", "bake_sale_2", "coffee_morning"]) expect(isKind(k, "bake_sale")).toBe(true);
    for (const k of ["run_walk", "run", "walk"]) expect(isKind(k, "run_walk")).toBe(true);
    for (const k of ["quiz_party", "quiz", "party"]) expect(isKind(k, "quiz_party")).toBe(true);
    for (const k of ["collection", "school_collection", "workplace_collection"]) expect(isKind(k, "collection")).toBe(true);
    expect(isKind("run_walk", "run")).toBe(true);
    expect(isKind("walk", "run")).toBe(false);
  });

  it("takes several, and is false for nothing", () => {
    expect(isKind("walk", "bake_sale", "run_walk", "santa_dash")).toBe(true);
    expect(isKind(null, "run_walk")).toBe(false);
    expect(isKind("birthday")).toBe(false);
  });
});

describe("the sign up form takes only categories on offer", () => {
  const signUp = (kind: unknown) => ({
    path: "raising",
    kind,
    kindOther: "",
    title: "Sam's Silence",
    description: "A day without talking.",
    public: true,
    firstName: "Sam",
    lastName: "Sample",
    email: "sam@example.com",
    phone: "07700 900456",
    socialOk: false,
    wants: { shoutOut: false, attend: false },
  });
  const kindError = (kind: unknown) => {
    const r = signUpSchema.safeParse(signUp(kind));
    return r.success ? null : r.error.issues.find((i) => i.path[0] === "kind")?.message;
  };

  it.each(STARTING_CATEGORIES.filter((c) => c.key !== OTHER_KIND).map((c) => c.key))("takes %s", (key) => {
    expect(signUpSchema.safeParse(signUp(key)).success).toBe(true);
  });

  it.each(["run_walk", "bake_sale", "quiz_party", "collection", "skydive", "", 7])("refuses %s, asking them to choose", (key) => {
    expect(kindError(key)).toBe("Choose what you are doing to raise money.");
  });

  it("takes a category staff have added, once the list has been read", () => {
    expect(kindError("sponsored_silence")).toBeTruthy();
    rememberCategories([...BUILT_IN_CATEGORIES, { key: "sponsored_silence", label: "Sponsored silence", active: true }]);
    expect(signUpSchema.safeParse(signUp("sponsored_silence")).success).toBe(true);
  });

  it("refuses one staff have hidden", () => {
    rememberCategories(BUILT_IN_CATEGORIES.map((c) => (c.key === "walk" ? { ...c, active: false } : c)));
    expect(kindError("walk")).toBeTruthy();
  });
});

describe("staff changing a sign up's category", () => {
  it("may choose any category on offer", () => {
    expect(adminPatchSchema.safeParse({ kind: "coffee_morning" }).success).toBe(true);
  });

  it("may not choose an old one or one that does not exist", () => {
    for (const kind of ["run_walk", "nope"]) {
      const r = adminPatchSchema.safeParse({ kind });
      expect(r.success).toBe(false);
      expect(r.success ? "" : r.error.issues[0].message).toBe("Choose one of the categories on the list.");
    }
  });
});

describe("an old sign up, as the public sees it", () => {
  const old = (kind: string, kindLabel?: string) =>
    ({ id: 3, slug: "x", path: "raising", kind, kindLabel, title: "X", description: "", eventDate: null, startTime: null, venue: "", town: "",
      imageSrc: null, name: "Sam Sample", creditName: null, access: [], timeTbc: false } as unknown as FundraiserRecord);
  const m = meter({ onlinePence: 0, cashPence: 0, targetPence: null });

  it("shows its old category's name", () => {
    expect(publicCard(old("run_walk"), m).kindLabel).toBe("Run or walk");
    expect(publicCard(old("bake_sale"), m).kindLabel).toBe("Bake sale or coffee morning");
    expect(publicCard(old("quiz_party"), m).kindLabel).toBe("Quiz or party");
    expect(publicCard(old("collection"), m).kindLabel).toBe("Workplace or school collection");
  });

  it("shows the name the database gave it, when it came with one (a rename shows at once)", () => {
    expect(publicCard(old("quiz", "Quiz night"), m).kindLabel).toBe("Quiz night");
  });
});

describe("an old sign up, on its card and its page", () => {
  const rec = (kind: string): FundraiserRecord =>
    ({
      id: 4, slug: "sams-walk", path: "raising", kind, title: "Sam's Walk", description: "Ten miles.", eventDate: "2099-11-14",
      startTime: null, venue: "", town: "Exampleton", targetPence: 50000, public: true, status: "approved", name: "Sam Sample",
      email: "sam@example.com", phone: "07700 900456", socialLink: null, socialOk: false,
      wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
      postAddress: null, postLine1: null, postLine2: null, postTown: null, postPostcode: null, newsletterOk: false, imageSrc: null,
      declinedReason: null, createdAt: "2026-10-02T10:00:00.000Z", approvedAt: null, approvedBy: null, updatedAt: "2026-10-02T10:00:00.000Z",
      updatedBy: null, cardLine: null, endTime: null, timeTbc: false, venueAddress: null, venuePostcode: null, access: [], price: null,
      booking: null, ticketUrl: null, ageLimit: null, dressCode: null, included: null, creditName: null,
    }) as FundraiserRecord;
  const m = meter({ onlinePence: 1000, cashPence: 0, targetPence: 50000 });

  it.each([
    ["run_walk", "Run or walk"],
    ["bake_sale", "Bake sale or coffee morning"],
    ["quiz_party", "Quiz or party"],
    ["collection", "Workplace or school collection"],
    ["santa_dash", "Santa dash"],
    ["birthday", "Birthday"],
  ])("a %s sign up is shown as %s", async (kind, label) => {
    const { renderFundraiserCard, renderFundraiserPage } = await import("../../src/fundraising/render");
    const { publicPage } = await import("../../src/fundraising/model");
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    expect(renderFundraiserCard(publicCard(rec(kind), m), "2026-10-03")).toContain(`<p class="ev-host">${label}</p>`);
    const template = readFileSync(resolve(__dirname, "../../fundraiser.html"), "utf8");
    const html = renderFundraiserPage(template, publicPage(rec(kind), m, []), { pageUrl: "https://nbcc.test/fundraise/sams-walk", now: new Date("2026-10-03T12:00:00Z") });
    expect(html).toContain(`<span class="eyebrow">${label}</span>`);
  });
});
