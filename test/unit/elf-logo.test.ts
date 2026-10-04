// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { SCHOOL_LOGO_SRC, SCHOOL_NAME, schoolLogo, schoolLogoData } from "../../src/elf/logo";
import { renderCalendarPage } from "../../src/elf/pages/calendar";
import { renderHqPage } from "../../src/elf/pages/hq";
import { renderPosterPage } from "../../src/elf/pages/poster";
import { renderWardrobePage } from "../../src/elf/pages/wardrobe";
import { renderElfCertificate, renderElfPoster, renderElfTag, renderStaffCard, shareCardSvg } from "../../src/elf/print";
import { defaultLook } from "../../src/elf/wardrobe";
import { AFTERNOON, calendarView, hqView, posterView, wardrobeView } from "./elf-fixtures";

// NBCC Elf Detective School: the school's logo, and where it goes. Every shop and detective here
// is invented (see elf-fixtures.ts).

const file = (name: string) => resolve(__dirname, "../../assets/img", name);
const html = (s: string) => new DOMParser().parseFromString(s, "text/html");

describe("the logo's files", () => {
  const cases = [
    { name: "elf-detective-school.webp", format: "webp", side: 640, most: 90_000 },
    { name: "elf-detective-school-print.webp", format: "webp", side: 1250, most: 170_000 },
    { name: "elf-detective-school-card.png", format: "png", side: 400, most: 70_000 },
  ];

  for (const c of cases) {
    it(`${c.name} is a square ${c.format} with its background cut away, and not too heavy`, async () => {
      const meta = await sharp(file(c.name)).metadata();
      expect(meta.format).toBe(c.format);
      expect(meta.width).toBe(c.side);
      expect(meta.height).toBe(c.side);
      expect(readFileSync(file(c.name)).length).toBeLessThan(c.most);
      const { data, info } = await sharp(file(c.name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
      // The four corners are see through, and the middle of the elf's face is not.
      for (const [x, y] of [[0, 0], [c.side - 1, 0], [0, c.side - 1], [c.side - 1, c.side - 1]]) expect(alphaAt(x, y)).toBe(0);
      expect(alphaAt(Math.round(c.side * 0.42), Math.round(c.side * 0.5))).toBe(255);
    });
  }

  it("the screens' address is the screens' file", () => {
    expect(SCHOOL_LOGO_SRC).toBe("/assets/img/elf-detective-school.webp");
  });
});

describe("the logo on a screen", () => {
  it("is a picture with its size and the school's name", () => {
    const img = html(schoolLogo(64)).querySelector("img")!;
    expect(img.getAttribute("src")).toBe(SCHOOL_LOGO_SRC);
    expect(img.getAttribute("alt")).toBe("NBCC Elf Detective School");
    expect(img.getAttribute("width")).toBe("64");
    expect(img.getAttribute("height")).toBe("64");
    expect(SCHOOL_NAME).toBe("NBCC Elf Detective School");
  });

  it("takes other words, made safe, and a sensible size whatever it is given", () => {
    const img = html(schoolLogo(Number.NaN, '"><script>x</script>')).querySelector("img")!;
    expect(img.getAttribute("alt")).toBe('"><script>x</script>');
    expect(img.getAttribute("width")).toBe("16");
    expect(html(schoolLogo(9999)).querySelector("img")!.getAttribute("width")).toBe("640");
  });

  it("is the heading of the calendar page", () => {
    const doc = html(renderCalendarPage(calendarView(AFTERNOON)));
    const img = doc.querySelector("h1 img")!;
    expect(img.getAttribute("src")).toBe(SCHOOL_LOGO_SRC);
    expect(img.getAttribute("alt")).toBe("NBCC Elf Detective School");
    // The bar across the top does not show it a second time there.
    expect(doc.querySelectorAll(`img[src="${SCHOOL_LOGO_SRC}"]`).length).toBe(1);
  });

  it("takes the charity's place in the bar across the top of every other screen, and leads back to the calendar", () => {
    const pages = [renderHqPage(hqView()), renderWardrobePage(wardrobeView()), renderPosterPage(posterView())];
    for (const page of pages) {
      const doc = html(page);
      const link = doc.querySelector("header.nav a.elf-school")!;
      expect(link.getAttribute("href")).toBe("/elf");
      const img = link.querySelector("img")!;
      expect(img.getAttribute("src")).toBe(SCHOOL_LOGO_SRC);
      expect(img.getAttribute("alt")).toBe("NBCC Elf Detective School");
      expect(doc.querySelectorAll(`img[src="${SCHOOL_LOGO_SRC}"]`).length).toBe(1);
      // One mark in the bar, not two: both logos are the same peeping elf.
      expect(doc.querySelectorAll("header.nav img").length).toBe(1);
    }
  });

  it("keeps the charity's logo, leading to the site, on the calendar and when the way back is not an address on this site", () => {
    for (const page of [renderCalendarPage(calendarView(AFTERNOON)), renderHqPage({ ...hqView(), calendarUrl: "https://elsewhere.example/" })]) {
      const doc = html(page);
      expect(doc.querySelector("a.elf-school")).toBeNull();
      const brand = doc.querySelector("header.nav a.brand")!;
      expect(brand.getAttribute("href")).toBe("/");
      expect(brand.querySelector("img")!.getAttribute("src")).toBe("/assets/img/nbcc-logo.png");
    }
  });

  it("is styled in the elf stylesheet: a fixed size in the bar, and never wider than its column in the heading", () => {
    const css = readFileSync(resolve(__dirname, "../../assets/css/elf.css"), "utf8");
    expect(css).toMatch(/\.elf-page \.elf-school img \{[^}]*height:\s*\d+px/);
    expect(css).toMatch(/\.elf-top__logo \{[^}]*max-width:\s*100%/);
  });
});

describe("the logo on paper and on the share card", () => {
  const place = { placeName: "The Toy Shop", placeTown: "Troon", siteOrigin: "https://nbcc.scot", posterUrl: "https://nbcc.scot/elf/p/toy-shop-k4f9" };
  const cert = { name: "Ruby Tinselfoot", badgeNumber: "EDS 0042", year: 2026, look: defaultLook(), state: { doorsDone: 24 }, awardedOn: new Date("2026-12-24T12:00:00.000Z") };
  const share = { detective: { firstName: "Ruby", surname: "Tinselfoot", approved: false }, rank: "Junior Detective" as const, doorsDone: 6, look: defaultLook(), state: { doorsDone: 6 }, year: 2026 };

  it("holds the whole picture, so nothing is left to fetch", () => {
    expect(schoolLogoData("print")).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/);
    expect(schoolLogoData("card")).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
  });

  it("is on the poster and the certificate, named", () => {
    for (const page of [renderElfPoster(place), renderElfCertificate(cert)]) {
      const img = html(page).querySelector(".page img.elf-logo")!;
      expect(img.getAttribute("src")).toBe(schoolLogoData("print"));
      expect(img.getAttribute("alt")).toBe("NBCC Elf Detective School");
    }
  });

  it("is never on the dark red band, where its dark red letters would be lost", () => {
    const pages = [
      renderElfPoster(place),
      renderStaffCard({ placeName: "The Toy Shop", door: 7, elfName: "Bauble", clueAt: new Date("2026-12-07T17:30:00.000Z"), phone: "01632 960 123" }),
      renderElfTag({ elfName: "Bauble", secretWord: "Snowball 472" }),
    ];
    for (const page of pages) expect(html(page).querySelector(".elf-band img.elf-logo")).toBeNull();
  });

  it("is on the share card as a PNG, which a picture made on the server can read", () => {
    const svg = new DOMParser().parseFromString(shareCardSvg(share), "image/svg+xml");
    const images = svg.querySelectorAll("image");
    expect(images.length).toBe(1);
    expect(images[0].getAttribute("href")).toBe(schoolLogoData("card"));
    expect(Number(images[0].getAttribute("width"))).toBe(Number(images[0].getAttribute("height")));
  });

  it("still turns into a picture, with the logo in it", async () => {
    const png = await sharp(Buffer.from(shareCardSvg(share))).png().toBuffer();
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(1200);
    // The green of the logo's lettering appears somewhere in the picture: the card has no other
    // bright green.
    let green = 0;
    for (let i = 0; i < data.length; i += info.channels) if (data[i + 1] > 150 && data[i] < 90 && data[i + 2] < 90) green++;
    expect(green).toBeGreaterThan(200);
  });
});
