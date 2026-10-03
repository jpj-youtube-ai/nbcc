// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { renderFundraiserPage } from "../../src/fundraising/render";
import { renderTeamExtras } from "../../src/fundraising/team-render";
import { teamMemberList, type TeamMemberRow } from "../../src/fundraising/teams";
import { meter, type PublicPage } from "../../src/fundraising/model";

// Profile pictures (Jaimie, 2026-10-03): the organiser's round photo on the public pages, once staff
// have approved it. On a fundraiser's or event's page it sits beside "Organised by Robin O."; on a
// team page every member and the team organiser show theirs, or the NBCC elf in the same round frame
// until they have one. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const template = readFileSync(resolve(ROOT, "fundraiser.html"), "utf8");
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const PHOTO = "/media/fundraiser-profile/0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";
const NOW = new Date(Date.UTC(2026, 9, 2, 12, 0, 0));
const PAGE_URL = "https://nbcc.test/fundraise/robins-santa-dash";

const page = (over: Partial<PublicPage> = {}): PublicPage => ({
  id: 41,
  slug: "robins-santa-dash",
  path: "raising",
  kind: "santa_dash",
  kindLabel: "A Santa dash",
  title: "Robin's Santa Dash",
  description: "Five kilometres in a red suit.",
  eventDate: null,
  startTime: null,
  venue: "",
  town: "Exampleton",
  imageSrc: null,
  organisedBy: "Robin O.",
  url: "/fundraise/robins-santa-dash",
  meter: meter({ onlinePence: 6000, cashPence: 0, targetPence: 25000 }),
  wall: [],
  giving: { fundraiserId: 41, minimumPence: 200 },
  ...over,
});

const render = (p: PublicPage, photo?: string | null) =>
  parse(renderFundraiserPage(template, p, { pageUrl: PAGE_URL, now: NOW, organiserPhotoSrc: photo }));

describe("the organiser's round photo on their page", () => {
  it("sits beside Organised by, in place of the person icon, described by their name", () => {
    const doc = render(page(), PHOTO);
    const by = doc.querySelector(".fr-facts .fr-facts__by")!;
    expect(by.textContent).toContain("Organised by Robin O.");
    const img = by.querySelector("img.fr-avatar")!;
    expect(img.getAttribute("src")).toBe(PHOTO);
    expect(img.getAttribute("alt")).toBe("A photo of Robin O.");
    expect(img.getAttribute("width")).toBe("48");
    expect(img.getAttribute("height")).toBe("48");
    expect(by.querySelector("svg")).toBeNull();
  });

  it("is on an event's page too", () => {
    const doc = render(page({ path: "event" }), PHOTO);
    expect(doc.querySelector(".fr-facts__by img.fr-avatar")?.getAttribute("src")).toBe(PHOTO);
  });

  it("is on a team page, beside Team organiser", () => {
    const doc = render(page({ teamName: "Exampleton Juniors" } as Partial<PublicPage>), PHOTO);
    expect(doc.querySelector(".fr-facts__by")!.textContent).toContain("Team organiser: Robin O.");
  });

  it("without an approved photo, the page is as it was: the person icon", () => {
    const doc = render(page(), null);
    const by = Array.from(doc.querySelectorAll(".fr-facts li")).find((li) => /Organised by/.test(li.textContent ?? ""))!;
    expect(by.querySelector("svg")).not.toBeNull();
    expect(doc.querySelector("img.fr-avatar")).toBeNull();
  });

  it("escapes the name in the description, and takes only a profile photo's own address", () => {
    const doc = render(page({ organisedBy: 'Robin "O." <b>' }), PHOTO);
    expect(doc.querySelector("img.fr-avatar")!.getAttribute("alt")).toBe('A photo of Robin "O." <b>');
    expect(doc.querySelector(".fr-facts b")).toBeNull();
    const elsewhere = render(page(), "https://elsewhere.example/x.jpg");
    expect(elsewhere.querySelector("img.fr-avatar")).toBeNull();
  });

  it("keeps the page's main photo where it was", () => {
    const doc = render(page({ imageSrc: "/media/events/1b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d" }), PHOTO);
    expect(doc.querySelector(".fr-photo img")?.getAttribute("src")).toBe("/media/events/1b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d");
  });
});

describe("the team on a team page", () => {
  const m = meter({ onlinePence: 1000, cashPence: 0, targetPence: 5000 });
  const members = [
    { name: "Ava S.", url: "/fundraise/as", meter: m, photoSrc: PHOTO },
    { name: "Ben <E.>", url: "/fundraise/be", meter: m, photoSrc: null },
  ];
  const doc = parse(
    renderTeamExtras({
      slug: "ej",
      title: "Exampleton Juniors",
      organisedBy: "Robin O.",
      organiserPhotoSrc: null,
      finished: false,
      members,
      joinUrl: "https://nbcc.scot/fundraise/ej/join",
    }).mainHtml,
  );

  it("shows a member's approved round photo, described by their name", () => {
    const ava = doc.querySelectorAll(".fr-team__member")[0];
    const img = ava.querySelector("img.fr-avatar")!;
    expect(img.getAttribute("src")).toBe(PHOTO);
    expect(img.getAttribute("alt")).toBe("A photo of Ava S.");
  });

  it("shows the NBCC elf in the same round frame for a member without one", () => {
    const ben = doc.querySelectorAll(".fr-team__member")[1];
    const img = ben.querySelector("img.fr-avatar")!;
    expect(img.getAttribute("src")).toBe("/assets/img/nbcc-elf-96.png");
    // A small copy made for this frame, not the 80 KB original.
    expect(statSync(resolve(ROOT, "assets/img/nbcc-elf-96.png")).size).toBeLessThan(15_000);
    expect(img.classList.contains("fr-avatar--elf")).toBe(true);
    // The name is right beside it, so the elf says nothing to a screen reader.
    expect(img.getAttribute("alt")).toBe("");
    expect(ben.textContent).toContain("Ben <E.>");
  });

  it("shows the team organiser's photo, or the elf, beside Team organiser", () => {
    const line = doc.querySelector(".fr-team__organiser")!;
    expect(line.textContent).toContain("Team organiser: Robin O.");
    expect(line.querySelector("img.fr-avatar--elf")).not.toBeNull();
    const withPhoto = parse(
      renderTeamExtras({ slug: "ej", title: "E", organisedBy: "Robin O.", organiserPhotoSrc: PHOTO, finished: false, members: [], joinUrl: "j" }).mainHtml,
    );
    expect(withPhoto.querySelector(".fr-team__organiser img.fr-avatar")!.getAttribute("alt")).toBe("A photo of Robin O.");
  });

  it("takes each member's approved photo from the list of them, by their page", () => {
    const row = (id: number, name: string) =>
      ({ id, name, firstName: name.split(" ")[0], slug: `p${id}`, status: "approved", public: true, path: "raising", teamLeftAt: null, meter: m }) as unknown as TeamMemberRow;
    const list = teamMemberList([row(1, "Ava Sample"), row(2, "Ben Example")], new Map([[1, "0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d"]]));
    expect(list.map((c) => c.photoSrc)).toEqual([PHOTO, null]);
    expect(teamMemberList([row(1, "Ava Sample")]).map((c) => c.photoSrc)).toEqual([null]);
  });
});
