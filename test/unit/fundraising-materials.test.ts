import { describe, it, expect } from "vitest";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";
import { qrSvg } from "../../src/fundraising/qr";
import {
  MATERIALS,
  SPONSOR_DECLARATION,
  materialAllowed,
  materialFacts,
  renderCertificate,
  renderPoster,
  renderSocial,
  renderSponsorForm,
  type MaterialAssets,
} from "../../src/fundraising/materials";

// TASK-504: the fundraising materials, drawn from a fundraiser's APPROVED details (the stored record;
// a change waiting for staff lives elsewhere and is never passed in). Pure renders, so every piece is
// checked here without a database: the words, the QR code's link, the print set up, and that every
// value a person typed is escaped. Every name and place is invented.

const ASSETS: MaterialAssets = {
  fontCss: "/* fonts */",
  logo: "data:image/png;base64,TE9HTw==",
  logoOnDark: "data:image/png;base64,REFSSw==",
};
const PAGE = "https://nbcc.test/fundraise/sams-santa-dash";
const INVOLVED = "https://nbcc.test/get-involved";

function record(over: Partial<FundraiserRecord> = {}): FundraiserRecord & { meter: ReturnType<typeof meter> } {
  return {
    id: 12,
    slug: "sams-santa-dash",
    path: "raising",
    kind: "santa_dash",
    title: "Sam's Santa Dash",
    description: "Five kilometres round the North Inch in a red suit. Every mile for the children, young people and vulnerable adults NBCC helps. Please give what you can.",
    eventDate: "2026-12-05",
    startTime: "10:00",
    venue: "North Inch",
    town: "Perth",
    targetPence: 50000,
    public: true,
    status: "approved",
    name: "Sam Example",
    email: "sam.example@example.com",
    phone: "07700 900123",
    socialLink: null,
    socialOk: false,
    wants: { leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    postAddress: null,
    postLine1: "1 Example Street",
    postLine2: null,
    postTown: "Perth",
    postPostcode: "PH1 1AA",
    newsletterOk: false,
    imageSrc: null,
    declinedReason: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    approvedAt: "2026-10-02T10:00:00.000Z",
    approvedBy: "admin:staff@example.com",
    updatedAt: "2026-10-02T10:00:00.000Z",
    updatedBy: null,
    cardLine: null,
    endTime: null,
    timeTbc: false,
    venueAddress: null,
    venuePostcode: null,
    access: [],
    price: null,
    booking: null,
    ticketUrl: null,
    ageLimit: null,
    dressCode: null,
    included: null,
    creditName: null,
    meter: meter({ onlinePence: 44000, cashPence: 10000, targetPence: 50000, giftAidPence: 4500 }),
    ...over,
  } as FundraiserRecord & { meter: ReturnType<typeof meter> };
}

const facts = (over: Partial<FundraiserRecord> = {}) => {
  const f = record(over);
  return materialFacts(f, f.meter, { pageUrl: PAGE, getInvolvedUrl: INVOLVED });
};

const HOSTILE = '<img src=x onerror="alert(1)">&"\'';

describe("the facts a piece is drawn from", () => {
  it("are the approved record's own: title, organiser, date, time and place", () => {
    const d = facts();
    expect(d.title).toBe("Sam's Santa Dash");
    expect(d.organiser).toBe("Sam Example");
    expect(d.when).toBe("Saturday 5 December 2026, 10am");
    expect(d.where).toBe("North Inch, Perth");
    expect(d.targetPence).toBe(50000);
    expect(d.raisedPence).toBe(54000);
    expect(d.giftAidPence).toBe(4500);
  });

  it("take the short line from the card line when there is one", () => {
    expect(facts({ cardLine: "Mince pies and a ceilidh." }).line).toBe("Mince pies and a ceilidh.");
  });

  it("otherwise take the description's first sentence", () => {
    expect(facts().line).toBe("Five kilometres round the North Inch in a red suit.");
  });

  it("trim a long first sentence to whole words", () => {
    const line = facts({ description: "word ".repeat(80).trim() }).line ?? "";
    expect(line.length).toBeLessThanOrEqual(141);
    expect(line.endsWith("…")).toBe(true);
  });

  it("leave out what was not given", () => {
    const d = facts({ eventDate: null, startTime: null, venue: "", town: "", targetPence: null });
    expect(d.when).toBeNull();
    expect(d.where).toBeNull();
    expect(d.targetPence).toBeNull();
  });

  it("point a page's code at its public page", () => {
    const d = facts();
    expect(d.link).toBe(PAGE);
    expect(d.linkWords).toBe("nbcc.test/fundraise/sams-santa-dash");
  });

  // Event pages: a public event has its own page now, and the caller gives its /event/ address.
  it("point a public event's code at its own page, as a fundraiser's", () => {
    const f = record({ path: "event" });
    const d = materialFacts(f, f.meter, { pageUrl: "https://nbcc.test/event/sams-santa-dash", getInvolvedUrl: INVOLVED });
    expect(d.link).toBe("https://nbcc.test/event/sams-santa-dash");
    expect(d.linkKind).toBe("page");
    expect(d.linkWords).toBe("nbcc.test/event/sams-santa-dash");
  });

  it("give no code at all to a fundraiser that is not on the website", () => {
    const d = facts({ public: false });
    expect(d.link).toBeNull();
    expect(d.linkWords).toBeNull();
  });
});

describe("who may open which piece", () => {
  it("lists the pages (TASK-512 adds the A3 poster and the A5 leaflet)", () => {
    expect([...MATERIALS]).toEqual(["poster", "poster-a3", "leaflet", "social", "sponsor-form", "certificate"]);
  });

  it("gives an organiser every piece of an approved fundraiser except the certificate", () => {
    for (const p of ["poster", "social", "sponsor-form"] as const) expect(materialAllowed(p, "approved", "organiser")).toBe(true);
    expect(materialAllowed("certificate", "approved", "organiser")).toBe(false);
    expect(materialAllowed("certificate", "finished", "organiser")).toBe(true);
  });

  it("lets staff preview the certificate at any time once approved", () => {
    expect(materialAllowed("certificate", "approved", "staff")).toBe(true);
    expect(materialAllowed("certificate", "finished", "staff")).toBe(true);
  });

  it("gives nobody anything for a new or declined sign up, whose details are not approved", () => {
    for (const p of MATERIALS) {
      for (const who of ["organiser", "staff"] as const) {
        expect(materialAllowed(p, "new", who)).toBe(false);
        expect(materialAllowed(p, "declined", who)).toBe(false);
      }
    }
  });
});

describe("the poster", () => {
  const html = renderPoster(facts(), ASSETS);

  it("is an A4 portrait print page with a print button, never indexed", () => {
    expect(html).toMatch(/@page\{size:A4 portrait;margin:0\}/);
    expect(html).toContain('onclick="window.print()"');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"');
  });

  it("says who it is for and what it is", () => {
    expect(html).toContain("Fundraising for NBCC");
    expect(html).toContain("Sam&#39;s Santa Dash");
    expect(html).toContain("Saturday 5 December 2026, 10am");
    expect(html).toContain("North Inch, Perth");
    expect(html).toContain("Five kilometres round the North Inch in a red suit.");
    expect(html).toContain("£500");
    expect(html).toContain("Every pound helps the children, young people and vulnerable adults we support, all year round.");
    expect(html).toContain(ASSETS.logo);
  });

  // TASK-512: the code is the A4 poster's own short link, which leads to the public page.
  it("carries a big QR code of the A4 poster's own short link, and the page's address in words", () => {
    const path = /<path fill="#000" d="([^"]+)"/.exec(qrSvg("https://nbcc.test/q/12-a4"))?.[1];
    expect(path).toBeTruthy();
    expect(html).toContain(`d="${path}"`);
    expect(html).toContain("nbcc.test/fundraise/sams-santa-dash");
  });

  it("has no code and no address for a fundraiser not on the website", () => {
    const off = renderPoster(facts({ public: false }), ASSETS);
    expect(off).not.toContain("<svg xmlns");
    expect(off).not.toContain("/fundraise/sams-santa-dash");
    expect(off).toContain("nbcc.scot");
  });

  it("leaves out the target when there is none", () => {
    expect(renderPoster(facts({ targetPence: null }), ASSETS)).not.toContain("Help us raise");
  });
});

describe("the social images page", () => {
  const html = renderSocial(facts(), ASSETS, "/* drawing script */");

  it("has a download button for the square and the story picture", () => {
    expect(html).toMatch(/<button[^>]*data-social-download="square"/);
    expect(html).toMatch(/<button[^>]*data-social-download="story"/);
    expect(html).toMatch(/<canvas[^>]*data-social="square"[^>]*width="1080" height="1080"/);
    expect(html).toMatch(/<canvas[^>]*data-social="story"[^>]*width="1080" height="1920"/);
    expect(html).toContain("/* drawing script */");
  });

  it("hands the drawing script the approved facts as data", () => {
    const json = /<script type="application\/json" id="socialData">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    const data = JSON.parse(json);
    expect(data).toMatchObject({
      title: "Sam's Santa Dash",
      linkWords: "nbcc.test/fundraise/sams-santa-dash",
      raisedPence: 54000,
      targetPence: 50000,
      slug: "sams-santa-dash",
      logoOnDark: ASSETS.logoOnDark,
    });
    // Only the logo with white lettering is drawn; the colour one would be dead weight.
    expect(data).not.toHaveProperty("logo");
    expect(data).not.toHaveProperty("email");
    expect(data).not.toHaveProperty("phone");
  });
});

describe("the sponsor form", () => {
  const html = renderSponsorForm(facts(), ASSETS);

  it("is A4 landscape, two pages, with a print button", () => {
    expect(html).toMatch(/@page\{size:A4 landscape;margin:0\}/);
    expect(html.match(/class="sheet sf-sheet/g)?.length).toBe(2);
    expect(html).toContain('onclick="window.print()"');
  });

  it("carries HMRC's sponsorship declaration word for word at the head of each page", () => {
    expect(SPONSOR_DECLARATION).toContain("If I have ticked the box headed ‘Gift Aid? √’, I confirm that I am a UK Income or Capital Gains taxpayer");
    expect(SPONSOR_DECLARATION).toContain(
      "I understand that if I pay less Income Tax / or Capital Gains tax in the current tax year than the amount of Gift Aid claimed on all of my donations it is my responsibility to pay any difference.",
    );
    expect(html.split(SPONSOR_DECLARATION.replace(/'/g, "&#39;")).length - 1).toBe(2);
  });

  it("has the Gift Aid columns HMRC asks for", () => {
    for (const heading of ["Full name", "Home address", "Postcode", "Gift Aid", "Amount", "Date paid"]) expect(html).toContain(heading);
    expect(html).toContain("first name or initial, and surname");
    expect(html).toMatch(/Total/);
  });

  it("has about twenty rows to fill in, more on the second page", () => {
    const rows = html.match(/<tr class="sf-row">/g)?.length ?? 0;
    expect(rows).toBeGreaterThanOrEqual(22);
  });

  it("names the charity, its number and the fundraiser, and asks for the form back", () => {
    expect(html).toContain("Night Before Christmas Campaign");
    expect(html).toContain("SC047995");
    expect(html).toContain("Sam&#39;s Santa Dash");
    expect(html).toContain("Please send this form back to us once you have paid the money in, so we can claim Gift Aid");
  });

  it("has a blank version for anyone, with nobody's details on it", () => {
    const blank = renderSponsorForm(null, ASSETS);
    expect(blank).toContain(SPONSOR_DECLARATION.replace(/'/g, "&#39;"));
    expect(blank).not.toContain("Santa Dash");
    expect(blank).not.toContain("Sam Example");
  });
});

describe("the thank you certificate", () => {
  const html = renderCertificate(facts({ status: "finished" }), ASSETS, { date: "12 December 2026", preview: false });

  it("is A4 landscape with a print button", () => {
    expect(html).toMatch(/@page\{size:A4 landscape;margin:0\}/);
    expect(html).toContain('onclick="window.print()"');
  });

  it("thanks the organiser by name for the fundraiser and its final total, Gift Aid apart", () => {
    expect(html).toContain("Certificate of thanks");
    expect(html).toContain("Sam Example");
    expect(html).toContain("Sam&#39;s Santa Dash");
    expect(html).toContain("£540");
    expect(html).toContain("+ £45 Gift Aid");
    expect(html).toContain("12 December 2026");
    expect(html).toContain("NBCC Team");
    expect(html).toContain("SC047995");
  });

  it("says nothing about Gift Aid when there was none", () => {
    const f = record({ status: "finished", meter: meter({ onlinePence: 30000, cashPence: 0, targetPence: null }) });
    const none = renderCertificate(materialFacts(f, f.meter, { pageUrl: PAGE, getInvolvedUrl: INVOLVED }), ASSETS, { date: "1 January 2027", preview: false });
    expect(none).toContain("£300");
    expect(none).not.toContain("Gift Aid");
  });

  it("marks a staff preview as one, on screen only", () => {
    const preview = renderCertificate(facts(), ASSETS, { date: "12 December 2026", preview: true });
    expect(preview).toMatch(/class="toolbar[^"]*"[\s\S]*Preview/);
  });
});

describe("everything a person typed is escaped, on every piece", () => {
  const f = facts({
    title: `Title ${HOSTILE}`,
    name: `Name ${HOSTILE}`,
    venue: `Venue ${HOSTILE}`,
    town: `Town ${HOSTILE}`,
    description: `Story ${HOSTILE}. More.`,
  });
  const pieces = {
    poster: renderPoster(f, ASSETS),
    social: renderSocial(f, ASSETS, ""),
    sponsor: renderSponsorForm(f, ASSETS),
    certificate: renderCertificate(f, ASSETS, { date: "1 January 2027", preview: false }),
  };
  for (const [name, html] of Object.entries(pieces)) {
    it(`never lets markup through on the ${name}`, () => {
      expect(html).not.toContain("<img src=x");
      expect(html).not.toContain('onerror="alert');
    });
  }

  it("keeps the social data from closing its script", () => {
    const g = facts({ title: "</script><script>alert(1)</script>" });
    const html = renderSocial(g, ASSETS, "");
    expect(html).not.toContain("</script><script>alert(1)");
    const json = /<script type="application\/json" id="socialData">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(JSON.parse(json).title).toBe("</script><script>alert(1)</script>");
  });
});
