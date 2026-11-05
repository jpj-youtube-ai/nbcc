// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  claimRefusalWords,
  claimWinHtml,
  posterState,
  renderPosterPage,
  stampRefusalWords,
  stampWinHtml,
} from "../../src/elf/pages/poster";
import type { PosterOutcome, PosterView } from "../../src/elf/pages/types";
import type { ClaimRefusal } from "../../src/elf/claim";
import type { StampRefusal } from "../../src/elf/stamps";
import { claimWin, posterView, stampWin } from "./elf-fixtures";

// NBCC Elf Detective School: the page a poster's QR code opens. A family claims an elf here by
// typing the secret word on its tag, and checks in for a candy cane once the place's door is open.
// Every shop, family and detective here is invented (see elf-fixtures.ts).

const page = (v: PosterView = posterView(), outcome?: PosterOutcome) => new DOMParser().parseFromString(renderPosterPage(v, outcome), "text/html");
const piece = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const CLAIM_REASONS: ClaimRefusal[] = ["already-found", "no-detectives", "not-your-detective", "too-many-tries", "wrong-word", "too-early", "already-won"];
const STAMP_REASONS: StampRefusal[] = ["door-not-open", "no-detectives", "not-your-detective", "nothing-new", "too-far", "place-unknown", "no-proof"];

describe("what the page is told about the door", () => {
  it("is the same for a door that is shut and one whose elf is being hunted", () => {
    expect(posterState("shut")).toEqual({ open: false, claimable: true });
    expect(posterState("hunting")).toEqual(posterState("shut"));
  });

  it("opens the check in once the door is open, and stops claims once the elf is found", () => {
    expect(posterState("revealed")).toEqual({ open: true, claimable: true });
    expect(posterState("found")).toEqual({ open: true, claimable: false });
  });

  it("so the page for a place is word for word the same whether or not its elf is out today", () => {
    const quiet = renderPosterPage(posterView(posterState("shut")));
    const today = renderPosterPage(posterView(posterState("hunting")));
    expect(today).toBe(quiet);
  });
});

describe("the page", () => {
  it("is named after the place, is private, and loads its script", () => {
    const doc = page();
    expect(words(doc.querySelector("h1"))).toBe("The Toy Shop");
    expect(doc.title).toBe("The Toy Shop | Night Before Christmas Campaign");
    expect(doc.querySelector('meta[name="robots"]')!.getAttribute("content")).toBe("noindex, nofollow");
    expect([...doc.querySelectorAll("script[src]")].map((s) => s.getAttribute("src"))).toEqual(["/assets/js/elf-poster.js"]);
    expect(doc.querySelector('.nav-cta[href="/elf"]')).not.toBeNull();
  });

  it("never says which door the place belongs to, or that today is its day", () => {
    const text = words(page().querySelector("main"));
    expect(text).not.toMatch(/\bdoor \d/i);
    expect(text).not.toMatch(/\btoday\b/i);
  });

  it("has a place for the answer that a screen reader is told about", () => {
    const result = page().querySelector("#elf-result")!;
    expect(result.getAttribute("aria-live")).toBe("polite");
    expect(result.getAttribute("tabindex")).toBe("-1");
    expect(words(result)).toBe("");
  });
});

describe("the reminder for children", () => {
  it("tells under 16s to bring a grown up, whoever is looking and whatever the door is doing", () => {
    const views = [posterView(), posterView({ open: true, claimable: true }), posterView({ open: true, claimable: false }), posterView({ signedIn: false, detectives: [] })];
    for (const view of views) expect(words(page(view).querySelector("main"))).toContain("Under 16? Bring a grown up with you to every hiding place.");
  });
});

describe("a visitor who is not signed in", () => {
  const doc = page(posterView({ signedIn: false, detectives: [] }));

  it("is asked to join, or to sign in", () => {
    expect(doc.querySelector('a[href="/elf/join"]')).not.toBeNull();
    expect(words(doc.querySelector('a[href="/elf/join"]'))).toBe("Join Elf Detective School");
    expect(words(doc.querySelector('a[href="/elf/sign-in"]'))).toBe("I am already a detective");
    expect(words(doc.querySelector("main"))).toContain("one of this year's hiding places");
  });

  it("is given no form to fill in", () => {
    expect(doc.querySelector("form")).toBeNull();
  });
});

describe("claiming an elf", () => {
  it("is a form that posts with no script: who found it, and the secret word", () => {
    const doc = page();
    const form = doc.querySelector<HTMLFormElement>("form.elf-claim")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/elf/p/toy-shop-k4f9/claim");
    expect(form.getAttribute("data-api")).toBe("/api/elf/claim");
    expect(form.querySelector<HTMLInputElement>('input[name="code"]')!.value).toBe("toy-shop-k4f9");
    const ticks = [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="detective"]')];
    expect(ticks.map((t) => t.value)).toEqual(["d1", "d2"]);
    expect(ticks.map((t) => words(doc.querySelector(`label[for="${t.id}"]`)))).toEqual(["Detective Ruby Tinselfoot", "Detective Leo Frostwhistle"]);
    expect(words(form.querySelector("legend"))).toBe("Who found it?");
    const word = form.querySelector<HTMLInputElement>('input[name="word"]')!;
    expect(words(doc.querySelector(`label[for="${word.id}"]`))).toBe("The secret word on the elf's tag");
    expect(word.required).toBe(true);
    expect(word.getAttribute("autocomplete")).toBe("off");
    expect(words(doc.getElementById(word.getAttribute("aria-describedby")!))).toContain("SNOWBALL 472");
    expect(words(form.querySelector('button[type="submit"]'))).toBe("We found the elf!");
    expect(form.querySelector(".elf-form-status")!.getAttribute("role")).toBe("status");
  });

  it("ticks the detective for a family with only one, and nobody for a family with more", () => {
    const one = page(posterView({ detectives: [{ id: "d1", name: "Detective Ruby Tinselfoot", hasStamp: false }] }));
    expect(one.querySelector<HTMLInputElement>('form.elf-claim input[name="detective"]')!.checked).toBe(true);
    const two = page();
    expect([...two.querySelectorAll<HTMLInputElement>('form.elf-claim input[name="detective"]')].map((t) => t.checked)).toEqual([false, false]);
  });

  it("is on offer until the elf is found, and gone after", () => {
    expect(page(posterView({ open: false, claimable: true })).querySelector("form.elf-claim")).not.toBeNull();
    expect(page(posterView({ open: true, claimable: true })).querySelector("form.elf-claim")).not.toBeNull();
    const found = page(posterView({ open: true, claimable: false }));
    expect(found.querySelector("form.elf-claim")).toBeNull();
    expect(words(found.querySelector("main"))).toContain("The elf that hid here has been found");
  });

  it("says the elf is still waiting at a place that closed with it unfound", () => {
    expect(words(page(posterView({ open: true, claimable: true })).querySelector(".elf-claim-card"))).toContain("still waiting here");
  });
});

describe("checking in for a candy cane", () => {
  it("is not offered until the place's door is open, and the page says when it will be", () => {
    const doc = page();
    expect(doc.querySelector("form.elf-stamp")).toBeNull();
    expect(words(doc.querySelector(".elf-poster__later"))).toContain("once its door has opened on the calendar");
    expect(page(posterView({ open: true, claimable: false })).querySelector(".elf-poster__later")).toBeNull();
  });

  it("is a form that works with no script by sending a photo", () => {
    const doc = page(posterView({ open: true, claimable: false }));
    const form = doc.querySelector<HTMLFormElement>("form.elf-stamp")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/elf/p/toy-shop-k4f9/stamp");
    expect(form.getAttribute("enctype")).toBe("multipart/form-data");
    expect(form.getAttribute("data-api")).toBe("/api/elf/stamp");
    expect(form.querySelector<HTMLInputElement>('input[name="code"]')!.value).toBe("toy-shop-k4f9");
    expect(words(form.querySelector("legend"))).toBe("Who is here?");
    const photo = form.querySelector<HTMLInputElement>('input[type="file"][name="photo"]')!;
    expect(photo.getAttribute("accept")).toBe("image/*");
    expect(photo.required).toBe(true);
    expect(words(doc.querySelector(`label[for="${photo.id}"]`))).toBe("Take a photo here");
    expect(words(doc.getElementById(photo.getAttribute("aria-describedby")!))).toContain("never shown on the website");
    expect(words(form.querySelector('button[type="submit"]'))).toBe("Check in with a photo");
  });

  it("keeps the location button back for the script, and says nothing is kept", () => {
    const doc = page(posterView({ open: true, claimable: false }));
    const way = doc.querySelector<HTMLElement>(".elf-stamp__location")!;
    expect(way.hidden).toBe(true);
    const button = way.querySelector<HTMLButtonElement>("button")!;
    expect(button.type).toBe("button");
    expect(words(button)).toBe("Check in with my location");
    expect(words(way)).toContain("Nothing is kept");
  });

  it("offers only the detectives who do not have this candy cane yet", () => {
    const doc = page(
      posterView({
        open: true,
        claimable: false,
        detectives: [
          { id: "d1", name: "Detective Ruby Tinselfoot", hasStamp: true },
          { id: "d2", name: "Detective Leo Frostwhistle", hasStamp: false },
        ],
      }),
    );
    const ticks = [...doc.querySelectorAll<HTMLInputElement>('form.elf-stamp input[name="detective"]')];
    expect(ticks.map((t) => t.value)).toEqual(["d2"]);
    expect(ticks[0].checked).toBe(true);
    expect(words(doc.querySelector(".elf-stamp__have"))).toBe("Detective Ruby Tinselfoot already has this candy cane.");
  });

  it("has nothing left to ask once everyone has it", () => {
    const doc = page(
      posterView({
        open: true,
        claimable: false,
        detectives: [
          { id: "d1", name: "Detective Ruby Tinselfoot", hasStamp: true },
          { id: "d2", name: "Detective Leo Frostwhistle", hasStamp: true },
        ],
      }),
    );
    expect(doc.querySelector("form.elf-stamp")).toBeNull();
    expect(words(doc.querySelector(".elf-stamp-card"))).toContain("Detective Ruby Tinselfoot and Detective Leo Frostwhistle already have this candy cane.");
  });

  it("gives every box, word and photo a label", () => {
    const doc = page(posterView({ open: true, claimable: true }));
    const controls = [...doc.querySelectorAll<HTMLInputElement>('main input:not([type="hidden"])')];
    expect(controls.length).toBeGreaterThan(4);
    for (const input of controls) expect(doc.querySelector(`label[for="${input.id}"]`), input.id).not.toBeNull();
    const ids = [...doc.querySelectorAll("[id]")].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the words for a claim that is refused", () => {
  it("has plain words for every reason", () => {
    for (const reason of CLAIM_REASONS) {
      const said = claimRefusalWords(reason);
      expect(said.length, reason).toBeGreaterThan(10);
      expect(said, reason).not.toMatch(/[–—]|[A-Za-z0-9]-[A-Za-z0-9]/);
    }
  });

  it("says how many tries are left after a wrong word", () => {
    expect(claimRefusalWords("wrong-word", 3)).toBe("That is not the right word. Check the tag and try again. You have 3 tries left here.");
    expect(claimRefusalWords("wrong-word", 1)).toBe("That is not the right word. Check the tag and try again. You have 1 try left here.");
    expect(claimRefusalWords("wrong-word", 0)).toBe("That is not the right word. That was your last try here.");
    expect(claimRefusalWords("wrong-word")).toBe("That is not the right word. Check the tag and try again.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(claimRefusalWords("wrong-word", "3" as any)).toBe("That is not the right word. Check the tag and try again.");
  });

  it("gives nothing away with a wrong word, or with too many of them", () => {
    for (const said of [claimRefusalWords("wrong-word", 2), claimRefusalWords("too-many-tries")]) {
      expect(said).not.toMatch(/today|not here|no elf|wrong place|clue/i);
    }
  });

  it("tells only someone with the right word that it is too early, or that they have won before", () => {
    expect(claimRefusalWords("too-early")).toContain("the right word");
    expect(claimRefusalWords("already-won")).toContain("already won an elf");
    expect(claimRefusalWords("already-found")).toBe("This elf has already been found.");
    expect(claimRefusalWords("no-detectives")).toBe("Tick who found the elf.");
  });

  it("falls back to plain words for a reason it does not know", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(claimRefusalWords("<b>" as any)).toBe("Something went wrong. Refresh the page and try again.");
  });
});

describe("the words for a check in that is refused", () => {
  it("has plain words for every reason", () => {
    for (const reason of STAMP_REASONS) {
      const said = stampRefusalWords(reason);
      expect(said.length, reason).toBeGreaterThan(10);
      expect(said, reason).not.toMatch(/[–—]|[A-Za-z0-9]-[A-Za-z0-9]/);
    }
  });

  it("points to the photo when the location will not do", () => {
    expect(stampRefusalWords("too-far")).toContain("take a photo here instead");
    expect(stampRefusalWords("place-unknown")).toContain("take a photo here instead");
    expect(stampRefusalWords("nothing-new")).toBe("Everyone ticked already has this candy cane.");
    expect(stampRefusalWords("no-detectives")).toBe("Tick who is here.");
  });
});

describe("the gold card for the first to find an elf", () => {
  it("says who found which elf, where and when, for the staff to see", () => {
    const card = piece(claimWinHtml(claimWin()));
    expect(words(card.querySelector("h2"))).toBe("You're first!");
    const text = words(card);
    expect(text).toContain("Detective Ruby Tinselfoot found Bauble at The Toy Shop.");
    expect(text).toContain("Door 7");
    expect(text).toContain("Found at 5:47pm on Monday 7 December");
    expect(text).toContain("Show this screen to the staff");
    expect(text).toContain("Badge 0427");
    expect(text).toContain("Junior Detective");
  });

  it("shows each detective's elf", () => {
    const img = piece(claimWinHtml(claimWin())).querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/elf/pic/d1.svg");
    expect(img.getAttribute("alt")).toBe("Detective Ruby Tinselfoot's elf");
    expect(img.getAttribute("width")).not.toBeNull();
    expect(img.getAttribute("height")).not.toBeNull();
  });

  it("names everyone when more than one detective found it", () => {
    const win = claimWin({
      detectives: [
        { name: "Detective Ruby Tinselfoot", badgeNumber: "0427", rank: "Junior Detective", elfUrl: "/elf/pic/d1.svg" },
        { name: "Detective Leo Frostwhistle", badgeNumber: "0428", rank: "Trainee", elfUrl: "/elf/pic/d2.svg" },
      ],
    });
    const card = piece(claimWinHtml(win));
    expect(words(card)).toContain("Detective Ruby Tinselfoot and Detective Leo Frostwhistle found Bauble at The Toy Shop.");
    expect(card.querySelectorAll("img").length).toBe(2);
  });

  it("carries a clock for the script to tick, hidden until it does, so a picture of the card can be told from the card", () => {
    const now = piece(claimWinHtml(claimWin())).querySelector<HTMLElement>(".elf-win__now")!;
    expect(now.hidden).toBe(true);
    expect(now.querySelector(".elf-clock")!.getAttribute("data-now")).toBe("2026-12-07T17:47:13.000Z");
  });

  it("says the candy cane is theirs too, and where to go next", () => {
    const card = piece(claimWinHtml(claimWin()));
    expect(words(card)).toContain("candy cane");
    expect(card.querySelector('a[href="/elf/hq"]')).not.toBeNull();
  });

  it("makes everything from data safe", () => {
    const win = claimWin({
      elfName: "<b>Bauble</b>",
      placeName: '"><script>x</script>',
      detectives: [{ name: "<img src=x onerror=alert(1)>", badgeNumber: "<i>", rank: "Trainee", elfUrl: "javascript:alert(1)" }],
      hqUrl: "https://example.com",
    });
    const html = claimWinHtml(win);
    expect(html).toContain("&lt;b&gt;Bauble&lt;/b&gt;");
    const card = piece(html);
    expect(card.querySelector("script, b > b, p > b > b, i, [onerror]")).toBeNull();
    expect(card.querySelector(".elf-win__who b")).toBeNull();
    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelectorAll("a").length).toBeGreaterThan(0);
    for (const a of card.querySelectorAll("a")) expect(a.getAttribute("href")).toMatch(/^\/(?!\/)/);
  });
});

describe("the card for a candy cane", () => {
  it("says who has visited where", () => {
    const card = piece(stampWinHtml(stampWin()));
    expect(words(card.querySelector("h2"))).toBe("Candy cane collected!");
    expect(words(card)).toContain("Detective Ruby Tinselfoot and Detective Leo Frostwhistle have visited The Toy Shop.");
  });

  it("says one detective has visited, not have", () => {
    const win = stampWin();
    win.detectives = [win.detectives[1]];
    expect(words(piece(stampWinHtml(win)))).toContain("Detective Leo Frostwhistle has visited The Toy Shop.");
  });

  it("tells each detective how far they have come, and what the visit has earned", () => {
    const rows = [...piece(stampWinHtml(stampWin())).querySelectorAll(".elf-stamped__who li")].map(words);
    expect(rows[0]).toBe("Detective Ruby Tinselfoot: 6 doors done. Promoted to Junior Detective! 4 new things in the wardrobe. Dress the elf");
    expect(rows[1]).toBe("Detective Leo Frostwhistle: 1 door done.");
    expect(piece(stampWinHtml(stampWin())).querySelector('a[href="/elf/hq/wardrobe/d1"]')).not.toBeNull();
  });

  it("makes everything from data safe", () => {
    const win = stampWin({ placeName: "<script>x</script>" });
    win.detectives[0] = { ...win.detectives[0], name: "<b>R</b>", wardrobeUrl: "//example.com" };
    const card = piece(stampWinHtml(win));
    expect(card.querySelector("script, b > b")).toBeNull();
    for (const a of card.querySelectorAll("a")) expect(a.getAttribute("href")).toMatch(/^\/(?!\/)/);
  });
});

describe("the page drawn again after a form was posted with no script", () => {
  it("shows the gold card, and no claim form, after a win", () => {
    const doc = page(posterView({ open: true, claimable: false }), { form: "claim", ok: true, win: claimWin() });
    expect(words(doc.querySelector("#elf-result h2"))).toBe("You're first!");
    expect(doc.querySelector("form.elf-claim")).toBeNull();
  });

  it("keeps the claim form and says why after a refusal", () => {
    const doc = page(posterView(), { form: "claim", ok: false, reason: "wrong-word", triesLeft: 4 });
    const status = doc.querySelector("form.elf-claim .elf-form-status")!;
    expect(words(status)).toBe("That is not the right word. Check the tag and try again. You have 4 tries left here.");
    expect(status.classList.contains("is-error")).toBe(true);
    expect(words(doc.querySelector("#elf-result"))).toBe("");
  });

  it("shows the candy cane card after a check in", () => {
    const view = posterView({
      open: true,
      claimable: false,
      detectives: [
        { id: "d1", name: "Detective Ruby Tinselfoot", hasStamp: true },
        { id: "d2", name: "Detective Leo Frostwhistle", hasStamp: true },
      ],
    });
    const doc = page(view, { form: "stamp", ok: true, win: stampWin() });
    expect(words(doc.querySelector("#elf-result h2"))).toBe("Candy cane collected!");
    expect(doc.querySelector("form.elf-stamp")).toBeNull();
  });

  it("says why a check in was refused, in its own form", () => {
    const doc = page(posterView({ open: true, claimable: false }), { form: "stamp", ok: false, reason: "no-proof" });
    expect(words(doc.querySelector("form.elf-stamp .elf-form-status"))).toBe("We need your location or a photo taken here.");
    expect(doc.querySelector("form.elf-stamp .elf-form-status")!.classList.contains("is-error")).toBe(true);
  });
});

describe("data that is not what it should be", () => {
  it("draws the gold card without a time, rather than failing, when the time is not real", () => {
    const html = claimWinHtml(claimWin({ at: new Date("x"), now: new Date("x") }));
    expect(html).not.toContain("Found at");
    expect(piece(html).querySelector(".elf-clock")).toBeNull();
  });

  it("does not start a sentence with nobody", () => {
    expect(words(piece(claimWinHtml(claimWin({ detectives: [] }))).querySelector(".elf-win__who"))).toBe("Bauble has been found at The Toy Shop.");
  });

  it("sends a family with no detectives to add one, not to an empty form", () => {
    const doc = page(posterView({ detectives: [] }));
    expect(doc.querySelector("form")).toBeNull();
    expect(words(doc.querySelector("main"))).toContain("Add a detective first");
  });

  it("makes the town safe on the page a visitor who is not signed in sees", () => {
    const html = renderPosterPage(posterView({ signedIn: false, detectives: [], placeTown: "<b>Troon</b>", joinUrl: "javascript:1", signInUrl: "//x" }));
    expect(html).toContain("&lt;b&gt;Troon&lt;/b&gt;");
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const a of doc.querySelectorAll("main a")) expect(a.getAttribute("href")).toMatch(/^\/(?!\/)/);
  });
});

describe("what comes from data", () => {
  it("is escaped wherever it is shown", () => {
    const view = posterView({
      placeName: '<img src=x onerror="alert(1)">',
      placeTown: "<b>Troon</b>",
      code: '"><script>x</script>',
      detectives: [{ id: '"><i>', name: "<u>Ruby</u>", hasStamp: false }],
      open: true,
    });
    const doc = page(view);
    expect(doc.querySelector("script:not([src]), main img, main b > b, main u, main i, [onerror]")).toBeNull();
    expect(doc.querySelector<HTMLInputElement>('form.elf-claim input[name="code"]')!.value).toBe('"><script>x</script>');
    expect(words(doc.querySelector("h1"))).toBe('<img src=x onerror="alert(1)">');
  });

  it("keeps the forms and links on this site", () => {
    const doc = page(posterView({ open: true, claimUrl: "https://example.com/x", stampUrl: "//example.com", calendarUrl: "javascript:1", hqUrl: "http://x" }));
    expect(doc.querySelector("form.elf-claim")!.getAttribute("action")).toBe("/");
    expect(doc.querySelector("form.elf-stamp")!.getAttribute("action")).toBe("/");
    for (const a of doc.querySelectorAll("main a")) expect(a.getAttribute("href")).toMatch(/^\/(?!\/)/);
  });
});
