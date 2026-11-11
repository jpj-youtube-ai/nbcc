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
    hqUrl: "https://nbcc.scot/elf/hq",
    fact: FACT,
    giveUrl: "https://nbcc.scot/donate",
    ...o,
  });
const morning = (o: Partial<Parameters<typeof buildElfMorningEmail>[0]> = {}) =>
  buildElfMorningEmail({
    day: new Date("2026-12-08T08:00:00.000Z"),
    today: { door: 8, ready: true, toDo: [], clue1At: C1, snow: false },
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
    expect(e.text).toContain("Clue 2 comes out at 6:30pm and clue 3 at 7:30pm, in Detective HQ. The hiding place is shown at 8:30pm.");
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

  it("says a door is not ready, and what to fix", () => {
    const e = morning({ today: { door: 8, ready: false, toDo: ["a clue", "the elf's name"], clue1At: C1, snow: false } });
    expect(e.text).toContain("Door 8 is NOT ready: a clue, the elf's name. Fix it in Doors before 5:30pm, or it becomes a snow day.");
  });

  it("says a snow day, and that nobody found an elf", () => {
    expect(morning({ today: { door: 8, ready: false, toDo: [], clue1At: C1, snow: true } }).text).toContain("Door 8 is a snow day.");
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
