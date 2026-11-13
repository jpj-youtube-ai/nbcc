import { describe, it, expect } from "vitest";
import {
  badgeWords,
  buildElfClueEmail,
  buildElfFindAlertEmail,
  buildElfMorningEmail,
  buildElfPhotoAlertEmail,
  buildElfPlaceReminderEmail,
  buildElfProudEmail,
  buildElfSignInCodeEmail,
  buildElfTestAlertEmail,
  buildElfWelcomeEmail,
  ELF_PHOTO_TEXT,
  ELF_TEST_TEXT,
  type BuiltEmail,
} from "../../src/elf/emails";
import { findEmail } from "../../src/email/catalogue";

// NBCC Elf Detective School: the welcome email and the sign in code. Every family is invented.

const welcome = () =>
  buildElfWelcomeEmail({
    grownUpName: "Sam Example",
    detectives: [
      { name: "Detective Ruby Tinselfoot", badge: badgeWords(1) },
      { name: "Detective Leo Frostwhistle", badge: badgeWords(42) },
    ],
    hqUrl: "https://nbcc.scot/elf/hq",
    signInUrl: "https://nbcc.scot/elf/sign-in",
    firstClueAt: new Date("2026-12-01T17:30:00.000Z"),
  });

describe("the welcome email", () => {
  it("names each detective by detective name, with their badge number", () => {
    const e = welcome();
    expect(badgeWords(1)).toBe("EDS 0001");
    expect(e.html).toContain("Detective Ruby Tinselfoot");
    expect(e.html).toContain("EDS 0042");
    expect(e.text).toContain("Detective Leo Frostwhistle, badge EDS 0042");
    expect(e.subject).toContain("Welcome to NBCC Elf Detective School");
  });

  it("says when Elf Detective School starts, by its full name, and how to sign in", () => {
    const e = welcome();
    expect(e.text).toContain("Elf Detective School starts on Tuesday 1 December at 5:30pm");
    expect(e.html).toContain("Elf Detective School starts on Tuesday 1 December at 5:30pm");
    expect(e.text).toContain("https://nbcc.scot/elf/sign-in");
    expect(e.html).toContain('href="https://nbcc.scot/elf/hq');
  });

  it("greets the grown up by first name only", () => {
    expect(welcome().text.startsWith("Hi Sam,")).toBe(true);
  });

  // The paper wardrobe (docs/superpowers/specs/2026-11-04-elf-paper-design.md): two costumes unlock
  // with every door done, so the email says costumes and doors, not clothes and finding elves.
  it("says that more costumes unlock as the detectives crack doors", () => {
    const e = welcome();
    expect(e.text).toContain("More costumes unlock as they crack doors in December.");
    expect(e.html).toContain("More costumes unlock as they crack doors in December.");
    expect(e.text).not.toContain("clothes");
  });

  it("uses no dashes, and says what money could do", () => {
    const e = welcome();
    const words = `${e.subject}\n${e.text}`;
    expect(words).not.toMatch(/[‒–—―]| - /);
    for (const line of e.text.split("\n")) {
      if (/\b(pounds?|gifts?|donations?|money)\b[^.]*\b(helps?|pays?|buys?|will)\b/i.test(line)) expect(line).toMatch(/\bcould\b/);
    }
  });
});

describe("the sign in code", () => {
  it("carries the code and no link", () => {
    const e = buildElfSignInCodeEmail("123456");
    expect(e.text).toContain("123456");
    expect(e.subject).toBe("Your Elf Detective School sign in code: 123 456");
    expect(e.html).not.toMatch(/href="https?:\/\/[^"]*elf/);
  });
});

// ---- wave 2: the December emails (Plan 2b, Task 2). Every family and place here is invented. ----

const C1 = new Date("2026-12-07T17:30:00.000Z");
const C2 = new Date("2026-12-07T18:30:00.000Z");
const C3 = new Date("2026-12-07T19:30:00.000Z");
const REVEAL = new Date("2026-12-07T20:30:00.000Z");
const MORNING_CLUE = new Date("2026-12-05T10:00:00.000Z");
const FACT = { door: 7, title: "Example", grownUp: "An example fact for grown ups.", doorLine: "x" };
const clue = (o: Partial<Parameters<typeof buildElfClueEmail>[0]> = {}) =>
  buildElfClueEmail({
    grownUpName: "Sam Example",
    door: 7,
    elfName: "Pip",
    clue: { words: "I live where the pine cones are.", pictureAlt: null },
    clue1At: C1,
    clue2At: C2,
    clue3At: C3,
    revealAt: REVEAL,
    closesAt: null,
    hqUrl: "https://nbcc.scot/elf/hq",
    fact: FACT,
    giveUrl: "https://nbcc.scot/donate",
    ...o,
  });
/** An email's html as words: what escapeHtml makes of an apostrophe, read back. */
const htmlWords = (html: string) => html.replace(/&#39;/g, "'");
const morning = (o: Partial<Parameters<typeof buildElfMorningEmail>[0]> = {}) =>
  buildElfMorningEmail({
    day: new Date("2026-12-08T08:00:00.000Z"),
    today: { door: 8, ready: true, toDo: [], clue1At: C1, snow: false, canRun: true },
    yesterday: {
      door: 7,
      finders: [{ firstName: "Ruby", surname: "Tinselfoot", approved: false }],
      foundAt: C1,
      place: { name: "Pine Cone Café", town: "Snowford" },
      state: "found",
      snow: false,
    },
    photosWaiting: 3,
    posts: { today: "Today post", yesterday: "Yesterday post" },
    pictures: { today: null, yesterday: null },
    adminUrl: "https://nbcc.scot/admin",
    ...o,
  });
const reminder = (o: Partial<Parameters<typeof buildElfPlaceReminderEmail>[0]> = {}) =>
  buildElfPlaceReminderEmail({ contactName: "Alex Example", placeName: "Pine Cone Café", elfName: "Pip", door: 7, clue1At: C1, closesAt: "5pm", phone: "01632 960 123", ...o });
const findAlert = () =>
  buildElfFindAlertEmail({ door: 7, elfName: "Pip", detectives: ["Ruby Example"], grownUpName: "Sam Example", at: C1, placeName: "Pine Cone Café", adminUrl: "https://nbcc.scot/admin" });
const photoAlert = (door: Parameters<typeof buildElfPhotoAlertEmail>[0]["door"] = 7) => buildElfPhotoAlertEmail({ door, adminUrl: "https://nbcc.scot/admin" });
const testAlert = () => buildElfTestAlertEmail({ name: "Alex", adminUrl: "https://nbcc.scot/admin" });
const proud = (o: Partial<Parameters<typeof buildElfProudEmail>[0]>) =>
  buildElfProudEmail({ kind: "won", grownUpName: "Sam Example", detectiveName: "Detective Ruby Tinselfoot", hqUrl: "https://nbcc.scot/elf/hq", giveUrl: "https://nbcc.scot/donate", ...o });

describe("the clue email", () => {
  it("has its subject, the quote box, the times and the button", () => {
    const e = clue();
    expect(e.subject).toBe("Door 7: the first clue is out");
    expect(e.html).toContain("I live where the pine cones are.");
    expect(e.text).toContain("Clue 2 comes out at 6:30pm and clue 3 at 7:30pm, in Detective HQ.");
    expect(e.html).toContain("Open Detective HQ");
    expect(e.text).toContain("If you are reading this a little late, the clue has been in Detective HQ since 5:30pm.");
    expect(e.text).toContain("Did you know?");
    expect(e.text).toContain("An example fact for grown ups.");
    expect(e.html).toContain('href="https://nbcc.scot/donate"');
    expect(e.text).toContain("Every pound could help a child wake up to a Red Bag Full of Joy.");
  });

  it("describes a picture only clue in words, with no picture", () => {
    const e = clue({ clue: { words: null, pictureAlt: "a pine cone on a wall" } });
    expect(e.text).toContain("Clue 1 is a picture: a pine cone on a wall. See it in Detective HQ.");
    expect(e.html.match(/<img/g)?.length).toBe(1); // only the NBCC logo
    expect(e.html).not.toContain("/elf/hq/clue/");
  });

  it("points words and a picture at Detective HQ", () => {
    const e = clue({ clue: { words: "Some words.", pictureAlt: "a pine cone" } });
    expect(e.text).toContain("See the picture in Detective HQ.");
    expect(e.html).toContain("See the picture in Detective HQ.");
    expect(e.html.match(/<img/g)?.length).toBe(1); // only the NBCC logo
  });

  it("leaves out the fact when there is none", () => {
    expect(clue({ fact: null }).text).not.toContain("Did you know?");
  });
});

// Plan 2c-1, Task 9: a family sees a door's place only once it has had its guess or been there, so the clue
// email no longer says when the place "is shown". It says when the family finds out whether it cracked the
// case, when the place closes on its day (a closing time typed in Doors), and that a missed hunt can still be
// cracked later in Detective HQ. Door 7 is a Monday evening; door 5 a Saturday morning.
describe("the clue email, on finding out and catching up", () => {
  const SIX = new Date("2026-12-07T18:00:00.000Z");
  const SIX_30 = new Date("2026-12-07T18:30:00.000Z");
  const SEVEN = new Date("2026-12-07T19:00:00.000Z");
  const EIGHT = new Date("2026-12-07T20:00:00.000Z");
  const evening = (o: Partial<Parameters<typeof buildElfClueEmail>[0]> = {}) =>
    clue({ clue1At: C1, clue2At: SIX, clue3At: SIX_30, revealAt: SEVEN, closesAt: EIGHT, ...o });
  const at = (hm: string) => new Date(`2026-12-05T${hm}:00.000Z`);
  const morning = (o: Partial<Parameters<typeof buildElfClueEmail>[0]> = {}) =>
    clue({ door: 5, clue1At: MORNING_CLUE, clue2At: at("10:30"), clue3At: at("11:00"), revealAt: at("11:30"), ...o });

  it("says when the next clues come, when the place closes, when you find out, and that a missed hunt can be cracked later", () => {
    const e = evening();
    for (const said of [
      "Clue 2 comes out at 6pm and clue 3 at 6:30pm, in Detective HQ.",
      "The hiding place closes at 8pm today.",
      "You find out whether you cracked it at 7pm, or later if the elf is still hiding then.",
      "If you miss tonight's hunt, you can still crack this case later in Detective HQ, with one guess.",
    ]) {
      expect(e.text, said).toContain(said);
      expect(htmlWords(e.html), said).toContain(said);
    }
    expect(e.text).not.toContain("is shown at");
    expect(e.html).not.toContain("is shown at");
  });

  it("says today's hunt for a 10am clue, and never tonight", () => {
    const e = morning();
    expect(e.text).toContain("If you miss today's hunt, you can still crack this case later in Detective HQ, with one guess.");
    expect(htmlWords(e.html)).toContain("If you miss today's hunt, you can still crack this case later in Detective HQ, with one guess.");
    expect(e.text.toLowerCase()).not.toContain("tonight");
    expect(e.html.toLowerCase()).not.toContain("tonight");
  });

  // Ruling F13: with no closing time typed the place still closes, at the 8pm a door falls back to, so the
  // family may find out later than the reveal; and a closing time not given at all reads as none.
  it("says nothing of closing with no closing time, and that the family may find out later", () => {
    const notGiven: Record<string, unknown> = {
      grownUpName: "Sam Example",
      door: 7,
      elfName: "Pip",
      clue: { words: "I live where the pine cones are.", pictureAlt: null },
      clue1At: C1,
      clue2At: SIX,
      clue3At: SIX_30,
      revealAt: SEVEN,
      hqUrl: "https://nbcc.scot/elf/hq",
      fact: null,
      giveUrl: "https://nbcc.scot/donate",
    };
    const built = [evening({ closesAt: null }), buildElfClueEmail(notGiven as Parameters<typeof buildElfClueEmail>[0]), evening({ closesAt: new Date("nonsense") })];
    for (const e of built) {
      expect(e.text).not.toContain("closes at");
      expect(e.html).not.toContain("closes at");
      expect(e.text).toContain("You find out whether you cracked it at 7pm, or later if the elf is still hiding then.");
    }
  });

  it("says only when the family finds out when the place closes as it is shown, or before", () => {
    for (const closes of ["11:30", "11:00"]) {
      const e = morning({ closesAt: at(closes) });
      expect(e.text).toContain(`The hiding place closes at ${closes === "11:30" ? "11:30am" : "11am"} today.`);
      expect(e.text).toContain("You find out whether you cracked it at 11:30am.");
      expect(e.text).not.toContain("or later if the elf is still hiding then");
      expect(e.html).not.toContain("or later if the elf is still hiding then");
    }
    expect(morning({ closesAt: at("16:00") }).text).toContain("You find out whether you cracked it at 11:30am, or later if the elf is still hiding then.");
  });
});

describe("the place reminder", () => {
  it("says Today for a 10am clue and never tonight", () => {
    const e = reminder({ contactName: null, door: 5, clue1At: MORNING_CLUE, closesAt: null });
    expect(e.subject).toBe("Today is your Elf Detective School day");
    expect(e.text).toContain("Today at 10am, please put Pip and the poster out together, with Pip wearing its tag. Until then keep them both out of sight.");
    expect(e.text.toLowerCase()).not.toContain("tonight");
    expect(e.text).toContain("Anything at all, ring NBCC on 01632 960 123.");
  });

  it("says Tonight for an evening clue", () => {
    expect(reminder().text).toContain("Tonight at 5:30pm, please put Pip");
  });

  // Settings may have no phone number for places yet: the reminder still goes, and a reply reaches NBCC.
  it("leaves out the ring line when there is no phone number to give", () => {
    const e = reminder({ phone: null });
    expect(e.text).toContain("Tonight at 5:30pm, please put Pip");
    expect(e.text).not.toContain("ring NBCC");
    expect(e.html).not.toContain("ring NBCC");
    expect(reminder().html).toContain("Anything at all, ring NBCC on 01632 960 123.");
  });
});

describe("the morning email", () => {
  it("has its subject, today's door and yesterday's find by the public name", () => {
    const e = morning();
    expect(e.subject).toBe("Elf HQ: Tuesday 8 December");
    expect(e.text).toContain("Door 8 is ready. The first clue comes out at 5:30pm.");
    expect(e.text).toContain("Detective R. Tinselfoot found door 7's elf at 5:30pm.");
    expect(e.text).not.toContain("Ruby");
    expect(e.text).toContain("3 photos waiting to be checked");
    expect(e.html).toContain("Open Head Elf HQ");
    expect(e.text).toContain("Today's posts, ready to copy");
    expect(e.html).toContain("Yesterday post");
  });

  // From the present PR's review: the worker snows in only a door that cannot open (canRun in
  // src/db/elf-game.ts: no place, no usable word on its tag, or no first clue). Anything else still to do is a
  // to do, not a snow day.
  it("says a door is not ready, and what to fix, with no snow day for a door that can still open", () => {
    const e = morning({ today: { door: 8, ready: false, toDo: ["the prize", "dropped off"], clue1At: C1, snow: false, canRun: true } });
    expect(e.text).toContain("Door 8 is NOT ready: the prize, dropped off. Fix it in Doors before 5:30pm.");
    expect(e.text).not.toContain("snow day");
    expect(e.html).not.toContain("snow day");
  });

  it("says a door that cannot open becomes a snow day, and what a door needs to open", () => {
    const e = morning({ today: { door: 8, ready: false, toDo: ["the elf and its tag", "the three clues"], clue1At: C1, snow: false, canRun: false } });
    expect(e.text).toContain(
      "Door 8 is NOT ready: the elf and its tag, the three clues. Fix it in Doors before 5:30pm. Without its place, the word on its tag or its first clue, it becomes a snow day.",
    );
  });

  it("says a snow day, and that nobody found an elf", () => {
    expect(morning({ today: { door: 8, ready: false, toDo: [], clue1At: C1, snow: true, canRun: false } }).text).toContain("Door 8 is a snow day.");
    expect(morning({ yesterday: { door: 7, finders: [], foundAt: null, place: null, state: "revealed", snow: false } }).text).toContain("Nobody found door 7's elf; its place was shown.");
    expect(morning({ yesterday: { door: 7, finders: [], foundAt: null, place: null, state: "snow", snow: true } }).text).toContain("Door 7 was a snow day.");
  });

  it("says a find is not public yet when there is no post for it", () => {
    expect(morning({ posts: { today: "Today post", yesterday: null } }).text).toContain("Yesterday's find is not public yet, so there is no post for it.");
  });

  it("shows a post's picture when there is one", () => {
    expect(morning({ pictures: { today: "https://nbcc.scot/assets/img/elf/door-8.webp", yesterday: null } }).html.match(/<img/g)?.length).toBe(2);
  });
});

describe("the alerts", () => {
  it("the find alert may use full names", () => {
    const e = findAlert();
    expect(e.subject).toBe("Door 7's elf has been found");
    expect(e.text).toContain("Ruby Example (Sam Example's family) found Pip at Pine Cone Café at 5:30pm.");
    expect(e.html).toContain("Open Finds");
  });

  it("the photo alert never names a family and is one for a start, not each photo", () => {
    const e = photoAlert();
    expect(e.subject).toBe("A photo is waiting to be checked");
    expect(e.text).toContain("A family has sent a photo from door 7 of Elf Detective School. Nobody sees it until a head elf approves it.");
    expect(e.html).toContain("Check the photos");
    expect(e.text).toContain("You get one of these when photos start waiting, not one for every photo.");
    expect(photoAlert(0).text).toContain("from the practice door of Elf Detective School");
  });

  it("the test alert greets by name", () => {
    const e = testAlert();
    expect(e.subject).toBe("Your test alert from Elf Detective School");
    expect(e.text).toContain("Hi Alex, this is the email half of a test alert. If you gave a mobile number, a text has gone too.");
  });

  it("the texts are short and name the game in full", () => {
    expect(ELF_PHOTO_TEXT.length).toBeLessThan(160);
    expect(ELF_PHOTO_TEXT).toBe("Elf Detective School: a photo is waiting for a head elf to check. nbcc.scot/admin");
    expect(ELF_TEST_TEXT).toBe("Elf Detective School: this is your test alert. nbcc.scot/admin");
  });
});

describe("the proud emails", () => {
  it("has the three subjects and the give line", () => {
    expect(proud({ kind: "won", elfName: "Pip" }).subject).toBe("You found Pip!");
    expect(proud({ kind: "promoted", rank: "Junior Detective" }).subject).toBe("Detective Ruby Tinselfoot is now a Junior Detective");
    const g = proud({ kind: "graduated" });
    expect(g.subject).toBe("Detective Ruby Tinselfoot has graduated!");
    expect(g.text).toContain("If Elf Detective School has given your family a smile, a little more could help another family this Christmas.");
    expect(g.html).toContain("Give a little more");
    expect(g.html).toContain('href="https://nbcc.scot/donate"');
  });

  it("says was for one detective who found the elf, and were for more", () => {
    expect(proud({ kind: "won", elfName: "Pip", door: 7 }).text).toContain("Detective Ruby Tinselfoot was the first to find Pip on door 7, and has won the prize.");
    const two = proud({ kind: "won", elfName: "Pip", door: 7, detectiveName: ["Detective Ruby Tinselfoot", "Detective Leo Frostwhistle"] });
    expect(two.text).toContain("Detective Ruby Tinselfoot and Detective Leo Frostwhistle were the first to find Pip on door 7, and have won the prize.");
    expect(two.html).toContain("Detective Ruby Tinselfoot and Detective Leo Frostwhistle were the first to find Pip on door 7, and have won the prize.");
  });
});

describe("typed names are escaped in every wave 2 email", () => {
  it("never lets an elf name with & and < through raw", () => {
    const elf = "Pip & <b>Co";
    const built = [
      proud({ kind: "won", elfName: elf, door: 7 }),
      clue({ elfName: elf }),
      reminder({ elfName: elf, placeName: "Pine & <i>Cone" }),
      findAlert(),
    ];
    for (const e of built) {
      expect(e.html).not.toContain("<b>Co");
      expect(e.html).not.toContain("<i>Cone");
    }
    expect(built[0].html).toContain("You found Pip &amp; &lt;b&gt;Co!");
  });
});

describe("their lines in All emails, for staff", () => {
  // In December the first detective to find the elf wins that door's prize and the elf stays (design
  // decision 1), and one Send me alerts tick covers the find alert and the photo alert alike.
  it("say the finder wins a door's prize, and that both alerts go to head elves whose alerts are on", () => {
    expect(findEmail("elf-proud")!.who).toBe("Goes to the grown up when their detective wins a door's prize, is promoted or graduates.");
    expect(findEmail("elf-find-alert")!.who).toBe("Goes to head elves whose alerts are on, as soon as an elf is found.");
    expect(findEmail("elf-photo-alert")!.who).toBe("Goes to head elves whose alerts are on, when photos start waiting. Never one for every photo.");
  });

  // Plan 2c-1, Task 9: staff read the clue email as families get it, with a place's closing time typed.
  it("show the clue email with when the place closes and when the family finds out, never when the place is shown", () => {
    for (const version of findEmail("elf-clue")!.versions) {
      const html = htmlWords(version.render("https://nbcc.scot").html);
      expect(html, version.id).toContain("closes at");
      expect(html, version.id).toContain("You find out whether you cracked it at");
      expect(html, version.id).toContain("you can still crack this case later in Detective HQ, with one guess.");
      expect(html, version.id).not.toContain("is shown at");
    }
  });

  // From the present PR's review: staff see both of the 8am email's not ready lines.
  it("show the 8am email's snow day only for a door that cannot open", () => {
    const render = (id: string) => findEmail("elf-morning")!.versions.find((v) => v.id === id)!.render("https://nbcc.scot").html;
    expect(render("snow")).toContain("Without its place, the word on its tag or its first clue, it becomes a snow day.");
    expect(render("todo")).toContain("is NOT ready:");
    expect(render("todo")).not.toContain("becomes a snow day");
  });
});

describe("every wave 2 email", () => {
  it("is from the apex, never news.nbcc.scot, and has no dashes", () => {
    const built: BuiltEmail[] = [clue(), reminder(), morning(), findAlert(), photoAlert(), testAlert(), proud({ kind: "won", elfName: "Pip", door: 7 })];
    for (const e of built) {
      expect(e.html).not.toContain("news.nbcc.scot");
      expect(e.text).not.toContain("news.nbcc.scot");
      expect(`${e.subject}\n${e.text}`).not.toMatch(/[‒–—―]| - /);
    }
  });
});
