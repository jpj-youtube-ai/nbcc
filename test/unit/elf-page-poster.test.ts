// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { claimWinHtml, renderPosterPage, visitWinHtml, wordRefusalWords } from "../../src/elf/pages/poster";
import type { PosterOutcome, PosterView } from "../../src/elf/pages/types";
import type { WordRefusal } from "../../src/elf/claim";
import { at, claimWin, posterView, visitWin } from "./elf-fixtures";

// NBCC Elf Detective School: the page a poster's QR code opens. A family types the word on the elf's
// tag here: the first family wins the prize, and every family after collects a candy cane, puts its
// elves on the door and can add a photo. Every shop, family and detective here is invented (see
// elf-fixtures.ts).

const page = (v: PosterView = posterView(), outcome?: PosterOutcome) => new DOMParser().parseFromString(renderPosterPage(v, outcome), "text/html");
const piece = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const REASONS: WordRefusal[] = ["no-detectives", "not-your-detective", "too-many-tries", "wrong-word", "too-early", "gone-home", "nothing-new"];
const OPEN = { open: true, claimable: false };
const HIDDEN = { open: false, claimable: false, foundHidden: true, revealAt: at("2026-12-07T19:00:00.000Z") };
const lede = (doc: Document) => words(doc.querySelector(".elf-poster-top .lede"));

describe("the page", () => {
  it("is named after the place, is private, and loads its script", () => {
    const doc = page();
    expect(words(doc.querySelector("h1"))).toBe("The Toy Shop");
    expect(doc.title).toBe("The Toy Shop | Night Before Christmas Campaign");
    expect(doc.querySelector('meta[name="robots"]')!.getAttribute("content")).toBe("noindex, nofollow");
    // The site's own script first, for the site's menu on a phone (TASK-615).
    expect([...doc.querySelectorAll("script[src]")].map((s) => s.getAttribute("src"))).toEqual(["/assets/js/main.js", "/assets/js/elf-poster.js"]);
    expect(doc.querySelector('nav.elf-bar a.elf-bar__go[href="/elf"]')).not.toBeNull();
  });

  it("names each part of the page once", () => {
    for (const v of [posterView(), posterView(OPEN), posterView({ signedIn: false, detectives: [] }), posterView({ detectives: [] })]) {
      const named = [...page(v).querySelectorAll("main [aria-labelledby]")].map((el) => el.getAttribute("aria-labelledby"));
      expect(new Set(named).size, named.join(" ")).toBe(named.length);
    }
  });

  it("has a place for the answer that a screen reader is told about", () => {
    const result = page().querySelector("#elf-result")!;
    expect(result.getAttribute("aria-live")).toBe("polite");
    expect(result.getAttribute("tabindex")).toBe("-1");
    expect(words(result)).toBe("");
  });
});

// ONE RULE SHAPES THIS PAGE: anyone can open any place's page from home, so before a door is open the
// page must say nothing that ties the place to a door or a day.
describe("a place whose door is not open", () => {
  it("is word for word the same whatever the door, the elf or the day", () => {
    const one = renderPosterPage(posterView({ door: 7, elfName: "Bauble" }));
    const other = renderPosterPage(posterView({ door: 12, elfName: "Glitter" }));
    expect(other).toBe(one);
    // A snow day is not open either, and says nothing of its own.
    expect(renderPosterPage(posterView({ door: 3, elfName: "Tinsel", claimable: false }))).toBe(one);
  });

  it("never names the elf, its door, or today", () => {
    const text = words(page(posterView({ elfName: "Bauble" })).querySelector("main"));
    expect(text).not.toContain("Bauble");
    expect(text).not.toMatch(/\bdoor \d/i);
    expect(text).not.toMatch(/\btoday\b/i);
  });

  it("asks whether the family found the elf or came for a candy cane", () => {
    expect(lede(page())).toBe("Found the elf? Or here for a candy cane?");
  });

  // The page keeps its own rule whatever the view holds: before its door is open, nothing on it names
  // the elf or its door.
  it("changes nothing for a gone home flag on a door that is not open", () => {
    expect(renderPosterPage(posterView({ goneHome: true, elfName: "Glitter" }))).toBe(renderPosterPage(posterView()));
  });

  it("never writes the door's number for the family's photo before the door is open", () => {
    const doc = page(posterView({ yourPhoto: { token: "tok8", status: "approved" } }));
    const box = doc.querySelector(".elf-your-photo")!;
    expect(words(box)).toContain("Thank you! A head elf will look at your photo soon.");
    expect(words(box)).toContain("Take it down");
    expect(words(doc.querySelector("main"))).not.toMatch(/\bdoor \d/i);
    // Send another opens a sheet that names the door, so it waits until the door is open.
    expect(box.querySelector(".elf-photo-sheet, summary")).toBeNull();
  });
});

describe("the word on the elf's tag", () => {
  it("is one form that posts with no script: who is here, and the word", () => {
    const doc = page();
    const forms = doc.querySelectorAll("main form");
    expect(forms.length).toBe(1);
    const form = doc.querySelector<HTMLFormElement>("form.elf-word")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/elf/p/toy-shop-k4f9/word");
    expect(form.getAttribute("data-api")).toBe("/api/elf/word");
    expect(form.querySelector<HTMLInputElement>('input[name="code"]')!.value).toBe("toy-shop-k4f9");
    const ticks = [...form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="detective"]')];
    expect(ticks.map((t) => t.value)).toEqual(["d1", "d2"]);
    expect(ticks.map((t) => words(doc.querySelector(`label[for="${t.id}"]`)))).toEqual(["Detective Ruby Tinselfoot", "Detective Leo Frostwhistle"]);
    expect(words(form.querySelector("legend"))).toBe("Who is here?");
    const word = form.querySelector<HTMLInputElement>('input[name="word"]')!;
    expect(words(doc.querySelector(`label[for="${word.id}"]`))).toBe("The secret word on the elf's tag");
    expect(word.required).toBe(true);
    expect(word.getAttribute("maxlength")).toBe("60");
    expect(word.getAttribute("autocomplete")).toBe("off");
    expect(words(doc.getElementById(word.getAttribute("aria-describedby")!))).toContain("SNOWBALL 472");
    expect(words(form.querySelector('button[type="submit"]'))).toBe("Type in the word");
    expect(form.querySelector(".elf-form-status")!.getAttribute("role")).toBe("status");
  });

  it("ticks the detective for a family with only one, and nobody for a family with more", () => {
    const one = page(posterView({ detectives: [{ id: "d1", name: "Detective Ruby Tinselfoot", hasStamp: false }] }));
    expect(one.querySelector<HTMLInputElement>('form.elf-word input[name="detective"]')!.checked).toBe(true);
    expect([...page().querySelectorAll<HTMLInputElement>('form.elf-word input[name="detective"]')].map((t) => t.checked)).toEqual([false, false]);
  });

  it("offers only the detectives who do not have this candy cane yet, and says who has", () => {
    const doc = page(posterView({ ...OPEN, detectives: [{ id: "d1", name: "Detective Ruby Tinselfoot", hasStamp: true }, { id: "d2", name: "Detective Leo Frostwhistle", hasStamp: false }] }));
    const ticks = [...doc.querySelectorAll<HTMLInputElement>('form.elf-word input[name="detective"]')];
    expect(ticks.map((t) => t.value)).toEqual(["d2"]);
    expect(ticks[0].checked).toBe(true);
    expect(words(doc.querySelector(".elf-word__have"))).toBe("Detective Ruby Tinselfoot already has this candy cane.");
  });

  it("has nothing left to ask once everyone has the candy cane", () => {
    const doc = page(posterView({ ...OPEN, detectives: [{ id: "d1", name: "Detective Ruby Tinselfoot", hasStamp: true }, { id: "d2", name: "Detective Leo Frostwhistle", hasStamp: true }] }));
    expect(doc.querySelector("form.elf-word")).toBeNull();
    expect(words(doc.querySelector(".elf-word__have"))).toBe("Detective Ruby Tinselfoot and Detective Leo Frostwhistle already have this candy cane.");
  });

  it("sits on a taped note, with a crimson torn paper button and none of the site's own", () => {
    const doc = page();
    const card = doc.querySelector("form.elf-word")!.closest(".elf-case")!;
    expect(card.classList.contains("elf-note")).toBe(true);
    expect(card.querySelector(":scope > .elf-tape")).not.toBeNull();
    expect(doc.querySelector('form.elf-word button[type="submit"]')!.className).toBe("elf-btn elf-btn--crimson");
    expect(doc.querySelector(".elf-poster .btn")).toBeNull();
  });

  it("gives every box and word a label, and nothing the same id", () => {
    const doc = page(posterView({ ...OPEN, yourPhoto: { token: "tok8", status: "approved" } }));
    const controls = [...doc.querySelectorAll<HTMLInputElement>('main input:not([type="hidden"])')];
    expect(controls.length).toBeGreaterThan(3);
    for (const input of controls) expect(doc.querySelector(`label[for="${input.id}"]`), input.id).not.toBeNull();
    const ids = [...doc.querySelectorAll("[id]")].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("what the page says about its elf", () => {
  it("names the elf once it has been found, while the place is hidden, and when the candy canes count from", () => {
    const doc = page(posterView(HIDDEN));
    expect(lede(doc)).toBe("Bauble has been found! Type the word on its tag and your candy canes count from 7pm.");
    expect(doc.querySelector("form.elf-word")).not.toBeNull();
  });

  it("says the elf is here all December once its door is open", () => {
    for (const v of [posterView(OPEN), posterView({ open: true, claimable: true })]) {
      expect(lede(page(v))).toBe("Bauble is here all December. Type the word on its tag for a candy cane.");
    }
  });

  it("says the elf has gone home, with no form", () => {
    const doc = page(posterView({ ...OPEN, goneHome: true }));
    expect(lede(doc)).toBe("Bauble has gone home, so there is nothing to find here now. Thank you for calling in!");
    expect(doc.querySelector("form")).toBeNull();
  });

  it("names the elf from the view, made safe", () => {
    const doc = page(posterView({ ...OPEN, elfName: "<b>Bauble</b>" }));
    expect(lede(doc)).toContain("<b>Bauble</b> is here all December.");
    expect(doc.querySelector(".lede b")).toBeNull();
  });
});

describe("the reminder for children", () => {
  it("tells under 16s to bring a grown up, whoever is looking and whatever the door is doing", () => {
    const views = [posterView(), posterView(HIDDEN), posterView(OPEN), posterView({ ...OPEN, goneHome: true }), posterView({ signedIn: false, detectives: [] })];
    for (const view of views) expect(words(page(view).querySelector("main"))).toContain("Under 16? Bring a grown up with you to every hiding place.");
  });
});

describe("a visitor who is not signed in", () => {
  const doc = page(posterView({ signedIn: false, detectives: [] }));

  it("is asked to join, or to sign in, on torn paper buttons", () => {
    expect(words(doc.querySelector('a[href="/elf/join"]'))).toBe("Join Elf Detective School");
    expect(words(doc.querySelector('a[href="/elf/sign-in"]'))).toBe("I am already a detective");
    expect(doc.querySelector('a[href="/elf/join"]')!.classList.contains("elf-btn")).toBe(true);
    expect(words(doc.querySelector("main"))).toContain("one of this year's hiding places");
  });

  it("is given no form to fill in", () => {
    expect(doc.querySelector("form")).toBeNull();
  });
});

describe("the family's own photo for this door", () => {
  const photo = (status: "waiting" | "approved" | "declined", over: Partial<PosterView> = {}) =>
    page(posterView({ ...OPEN, yourPhoto: { token: "tok8", status }, ...over })).querySelector(".elf-your-photo")!;

  /** The family's own buttons, outside the sheet that Send another opens. */
  const buttons = (box: Element) => [...box.querySelectorAll("button")].filter((b) => !b.closest("details"));

  it("says a photo is waiting for a head elf, and can be taken down or sent again", () => {
    const box = photo("waiting");
    expect(words(box)).toContain("Thank you! A head elf will look at your photo soon.");
    expect(buttons(box).map(words)).toEqual(["Take it down"]);
    expect(buttons(box)[0].getAttribute("type")).toBe("button");
    expect(words(box.querySelector("summary"))).toBe("Send another");
  });

  it("says where an approved photo is", () => {
    const box = photo("approved");
    expect(words(box)).toContain("Your photo is on door 7.");
    expect(buttons(box).map(words)).toEqual(["Take it down"]);
    expect(words(photo("approved", { door: 0 }))).toContain("Your photo is on the practice door.");
  });

  it("is kind about a photo that could not be used, which has nothing to take down", () => {
    const box = photo("declined");
    expect(words(box)).toContain("We could not use that photo this time. You are welcome to send another.");
    expect(buttons(box)).toEqual([]);
    expect(words(box)).not.toContain("Take it down");
    expect(words(box.querySelector("summary"))).toBe("Send another");
  });

  it("opens the photo sheet again from Send another, with no script", () => {
    const sheet = photo("declined").querySelector("details .elf-photo-sheet")!;
    const form = sheet.querySelector("form")!;
    expect(form.getAttribute("action")).toBe("/api/elf/p/toy-shop-k4f9/photo");
    expect(form.querySelector('input[type="file"][name="photo"]')).not.toBeNull();
    expect(form.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  });

  it("is not there when the family has sent no photo", () => {
    expect(page(posterView(OPEN)).querySelector(".elf-your-photo")).toBeNull();
  });

  it("can still be taken down once the elves have gone home, with nothing to send and no form on the page", () => {
    const doc = page(posterView({ ...OPEN, goneHome: true, yourPhoto: { token: "tok8", status: "approved" } }));
    const box = doc.querySelector(".elf-your-photo")!;
    expect(buttons(box).map(words)).toEqual(["Take it down"]);
    expect(box.querySelector("summary, .elf-photo-sheet")).toBeNull();
    expect(words(box)).not.toContain("Send another");
    expect(doc.querySelector("form")).toBeNull();
  });
});

describe("the words for a word that is refused", () => {
  it("has plain words for every reason", () => {
    for (const reason of REASONS.filter((r) => r !== "not-your-detective")) {
      const said = wordRefusalWords(reason);
      expect(said.length, reason).toBeGreaterThan(10);
      expect(said, reason).not.toMatch(/[–—]|[A-Za-z0-9]-[A-Za-z0-9]/);
    }
  });

  it("says how many tries are left after a wrong word", () => {
    expect(wordRefusalWords("wrong-word", 3)).toBe("That is not the right word. Check the tag and try again. You have 3 tries left here.");
    expect(wordRefusalWords("wrong-word", 1)).toBe("That is not the right word. Check the tag and try again. You have 1 try left here.");
    expect(wordRefusalWords("wrong-word", 0)).toBe("That is not the right word. That was your last try here.");
    expect(wordRefusalWords("wrong-word")).toBe("That is not the right word. Check the tag and try again.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(wordRefusalWords("wrong-word", "3" as any)).toBe("That is not the right word. Check the tag and try again.");
  });

  it("gives nothing away with a wrong word, or with too many of them", () => {
    for (const said of [wordRefusalWords("wrong-word", 2), wordRefusalWords("too-many-tries")]) {
      expect(said).not.toMatch(/today|not here|no elf|wrong place|clue/i);
    }
  });

  it("tells only someone with the right word that it is too early or that the elf has gone home", () => {
    expect(wordRefusalWords("too-many-tries")).toBe(
      "That is too many wrong words here. If you are holding the elf, show it to the staff: they can phone NBCC and we will sort it out.",
    );
    expect(wordRefusalWords("too-early")).toBe("That is the right word, but this elf is not out yet. Come back once its clue is on the calendar to claim it.");
    expect(wordRefusalWords("gone-home")).toBe("This elf has gone home, so its word no longer gives a stamp. Thank you for calling in!");
  });

  it("has its own words for nothing new and nobody ticked", () => {
    expect(wordRefusalWords("nothing-new")).toBe("Everyone ticked already has this candy cane.");
    expect(wordRefusalWords("no-detectives")).toBe("Tick who is here.");
  });

  it("falls back to plain words for a reason it does not know", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(wordRefusalWords("<b>" as any)).toBe("Something went wrong. Refresh the page and try again.");
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
    expect(text).toContain("Badge 0427");
    expect(text).toContain("Junior Detective");
  });

  // Decision 1: the elf stays at its place all December; the finder gets the prize.
  it("tells the staff to give the prize, and that the elf stays for everyone else", () => {
    const text = words(piece(claimWinHtml(claimWin())));
    expect(text).toContain("Show this screen to the staff. They will give you the prize. Bauble stays here for everyone else to find.");
    expect(text).toContain("They will give you the prize");
    expect(text).toContain("stays here");
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

describe("the card for a visit", () => {
  const card = (over = {}) => piece(visitWinHtml(visitWin(over)));

  it("says the door is done and who has the candy cane for visiting", () => {
    const c = card();
    expect(c.querySelector(".elf-visit")).not.toBeNull();
    expect(c.querySelector(".elf-visit svg.elf-icon")).not.toBeNull();
    expect(words(c.querySelector("h2"))).toBe("Door 7 done!");
    expect(words(c)).toContain("Detective Ruby Tinselfoot and Detective Leo Frostwhistle have a candy cane stamp for visiting The Toy Shop.");
    const one = visitWin();
    one.detectives = [one.detectives[1]];
    expect(words(piece(visitWinHtml(one)))).toContain("Detective Leo Frostwhistle has a candy cane stamp for visiting The Toy Shop.");
  });

  it("says when a visit before the place is shown starts to count", () => {
    expect(words(card({ countsFrom: at("2026-12-07T19:00:00.000Z") }))).toContain("It counts from 7pm, when the hiding place is shown.");
    expect(words(card())).not.toContain("It counts from");
  });

  it("tells each detective how far they have come, and what the visit has earned", () => {
    const rows = [...card().querySelectorAll(".elf-visit__who li")].map(words);
    expect(rows[0]).toBe("Detective Ruby Tinselfoot: 6 doors done. Promoted to Junior Detective! 4 new things in the wardrobe. Dress the elf");
    expect(rows[1]).toBe("Detective Leo Frostwhistle: 1 door done.");
    expect(card().querySelector('a[href="/elf/hq/wardrobe/d1"]')).not.toBeNull();
  });

  it("puts the family's elves on the door", () => {
    expect(words(card())).toContain("Your elves are on door 7.");
  });

  it("offers a photo for the door, with the consent box unticked, a way to say no, and the promise", () => {
    const sheet = card().querySelector(".elf-photo-sheet")!;
    expect(words(sheet.querySelector("h3"))).toBe("Add a photo to door 7");
    expect(words(sheet)).toContain("It goes behind door 7 on the calendar, in a row of photos with no names.");
    const form = sheet.querySelector<HTMLFormElement>("form")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/api/elf/p/toy-shop-k4f9/photo");
    expect(form.getAttribute("enctype")).toBe("multipart/form-data");
    const file = form.querySelector<HTMLInputElement>('input[type="file"][name="photo"]')!;
    expect(file.getAttribute("accept")).toBe("image/*");
    expect(file.getAttribute("capture")).toBe("environment");
    const consent = form.querySelector<HTMLInputElement>(".elf-consent input[type='checkbox']")!;
    expect(consent.checked).toBe(false);
    expect(consent.hasAttribute("checked")).toBe(false);
    expect(consent.required).toBe(true);
    const said = words(sheet.querySelector(`label[for="${consent.id}"]`));
    expect(said).toBe("Yes, show this photo on door 7 Anyone looking at the calendar will see it. No names go with a photo.");
    expect(words(form.querySelector('button[type="submit"]'))).toBe("Send it to the head elves");
    expect(form.querySelector('button[type="submit"]')!.className).toBe("elf-btn elf-btn--crimson");
    expect(words(sheet.querySelector("a.elf-photo-sheet__skip"))).toBe("Not this time");
    expect(words(card())).toContain(
      "A head elf looks at every photo before anyone else can see it. We take out where and when it was taken. Every photo comes down at the end of January.",
    );
  });

  it("reads the practice door in place of door 0", () => {
    const c = card({ door: 0, photo: { door: 0, sendUrl: "/api/elf/p/practice/photo" } });
    const said = words(c);
    expect(words(c.querySelector("h2"))).toBe("The practice door done!");
    expect(said).toContain("Your elves are on the practice door.");
    expect(said).toContain("Add a photo to the practice door");
    expect(said).toContain("Yes, show this photo on the practice door");
    expect(said).not.toMatch(/door 0/i);
  });

  it("makes everything from data safe", () => {
    const win = visitWin({ placeName: "<script>x</script>", photo: { door: 7, sendUrl: "//example.com" } });
    win.detectives[0] = { ...win.detectives[0], name: "<b>R</b>", wardrobeUrl: "//example.com" };
    const c = piece(visitWinHtml(win));
    expect(c.querySelector("script, b > b")).toBeNull();
    for (const a of c.querySelectorAll("a")) expect(a.getAttribute("href")).toMatch(/^\/(?!\/)/);
    expect(c.querySelector("form")!.getAttribute("action")).toBe("/");
  });
});

// Decision 1 and C6: nobody hands an elf over, and a family that has already won is a visitor.
describe("words that are gone for good", () => {
  const GONE = ["hand over", "already won an elf", "leave this one hiding"];

  it("are nowhere in the poster page's source", () => {
    const source = readFileSync(resolve(__dirname, "../../src/elf/pages/poster.ts"), "utf8");
    for (const phrase of GONE) expect(source, phrase).not.toContain(phrase);
  });

  it("are on no page drawn for a win, a visit or any refusal", () => {
    const pages = [
      renderPosterPage(posterView(OPEN), { form: "word", ok: true, outcome: "won", win: claimWin() }),
      renderPosterPage(posterView(OPEN), { form: "word", ok: true, outcome: "visited", visit: visitWin() }),
      ...REASONS.map((reason) => renderPosterPage(posterView(), { form: "word", ok: false, reason, triesLeft: 2 })),
      ...REASONS.map((reason) => wordRefusalWords(reason)),
    ];
    for (const html of pages) for (const phrase of GONE) expect(html, phrase).not.toContain(phrase);
  });
});

describe("the word form sent too often with no script", () => {
  it("says so in the form's status line, made safe, and keeps the form", () => {
    const doc = page(posterView({ wordError: "Too many tries. Please wait a few minutes and try again. <i>x</i>" }));
    const status = doc.querySelector("form.elf-word .elf-form-status")!;
    expect(status.classList.contains("is-error")).toBe(true);
    expect(words(status)).toBe("Too many tries. Please wait a few minutes and try again. <i>x</i>");
    expect(status.querySelector("i")).toBeNull();
    expect(doc.querySelector('form.elf-word input[name="word"]')).not.toBeNull();
  });

  it("is the same at every place whose door is not open", () => {
    const one = renderPosterPage(posterView({ wordError: "Too many tries. Please wait a few minutes and try again." }));
    const other = renderPosterPage(posterView({ door: 12, elfName: "Pickle", wordError: "Too many tries. Please wait a few minutes and try again." }));
    expect(one).toBe(other);
  });
});

describe("the page drawn again after the form was posted with no script", () => {
  it("shows the gold card, and no form, after a win", () => {
    const doc = page(posterView(HIDDEN), { form: "word", ok: true, outcome: "won", win: claimWin() });
    expect(words(doc.querySelector("#elf-result h2"))).toBe("You're first!");
    expect(doc.querySelector("form.elf-word")).toBeNull();
  });

  it("shows the visit card, with its photo sheet, after a visit", () => {
    const doc = page(posterView(OPEN), { form: "word", ok: true, outcome: "visited", visit: visitWin() });
    expect(words(doc.querySelector("#elf-result h2"))).toBe("Door 7 done!");
    expect(doc.querySelector("#elf-result .elf-photo-sheet form")).not.toBeNull();
    expect(doc.querySelector("form.elf-word")).toBeNull();
  });

  it("keeps the form and says why after a refusal", () => {
    const doc = page(posterView(), { form: "word", ok: false, reason: "wrong-word", triesLeft: 4 });
    const status = doc.querySelector("form.elf-word .elf-form-status")!;
    expect(words(status)).toBe("That is not the right word. Check the tag and try again. You have 4 tries left here.");
    expect(status.classList.contains("is-error")).toBe(true);
    expect(words(doc.querySelector("#elf-result"))).toBe("");
  });

  it("says when everyone ticked already had the candy cane, in the same form", () => {
    const doc = page(posterView(OPEN), { form: "word", ok: false, reason: "nothing-new" });
    expect(words(doc.querySelector("form.elf-word .elf-form-status"))).toBe("Everyone ticked already has this candy cane.");
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

  it("draws a candy cane time that is not real as no time at all", () => {
    expect(() => visitWinHtml(visitWin({ countsFrom: new Date("x") }))).not.toThrow();
    expect(visitWinHtml(visitWin({ countsFrom: new Date("x") }))).not.toContain("It counts from");
    expect(() => renderPosterPage(posterView({ ...HIDDEN, revealAt: new Date("x") }))).not.toThrow();
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
    expect(doc.querySelector<HTMLInputElement>('form.elf-word input[name="code"]')!.value).toBe('"><script>x</script>');
    expect(words(doc.querySelector("h1"))).toBe('<img src=x onerror="alert(1)">');
  });

  it("keeps the forms and links on this site", () => {
    const doc = page(posterView({ open: true, yourPhoto: { token: "tok8", status: "waiting" }, wordUrl: "https://example.com/x", photoUrl: "//example.com", calendarUrl: "javascript:1", hqUrl: "http://x" }));
    for (const form of doc.querySelectorAll("form")) expect(form.getAttribute("action")).toBe("/");
    for (const a of doc.querySelectorAll("main a")) expect(a.getAttribute("href")).toMatch(/^\/(?!\/)/);
  });
});
