import { describe, it, expect } from "vitest";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";
import { qrSvg } from "../../src/fundraising/qr";
import { MATERIALS_STATEMENT, MATERIALS_STATEMENT_SHORT } from "../../src/legal/registration";
import {
  ASK_US,
  MATERIALS,
  POSTER_SIZES,
  SOCIAL_SIZES,
  materialAllowed,
  materialFacts,
  posterLogoMm,
  renderCertificate,
  renderEverything,
  renderPoster,
  renderSocial,
  renderSponsorForm,
  type MaterialAssets,
} from "../../src/fundraising/materials";

// TASK-512: the fundraising materials, round two. Every printed piece carries the charity statement
// word for word and the logo as big as the layout allows; the poster comes as an A5 leaflet and an A3
// poster too, the same design scaled to each paper with its own @page size; every printed piece's
// QR code is its own short link (/q/<id>-<size>) so a scan says which piece it came from; the
// pictures to share come in the five sizes Facebook and Instagram ask for; every page says how to ask
// us for anything else; and staff get every piece on one print page. Pure renders; every name and
// place here is invented.

const ASSETS: MaterialAssets = {
  fontCss: "/* fonts */",
  logo: "data:image/png;base64,TE9HTw==",
  logoOnDark: "data:image/png;base64,REFSSw==",
};
const PAGE = "https://nbcc.test/fundraise/sams-santa-dash";
const INVOLVED = "https://nbcc.test/get-involved";

function record(over: Partial<FundraiserRecord> = {}) {
  return {
    id: 12,
    slug: "sams-santa-dash",
    path: "raising",
    kind: "santa_dash",
    title: "Sam's Santa Dash",
    description: "Five kilometres round the North Inch in a red suit. Every mile counts.",
    eventDate: "2026-12-05",
    startTime: "10:00",
    venue: "North Inch",
    town: "Perth",
    targetPence: 50000,
    public: true,
    status: "approved",
    name: "Sam Example",
    cardLine: null,
    meter: meter({ onlinePence: 44000, cashPence: 10000, targetPence: 50000, giftAidPence: 4500 }),
    ...over,
  } as FundraiserRecord & { meter: ReturnType<typeof meter> };
}

const facts = (over: Partial<FundraiserRecord> = {}) => {
  const f = record(over);
  return materialFacts(f, f.meter, { pageUrl: PAGE, getInvolvedUrl: INVOLVED });
};

/** The drawing of a QR code for a link, as it appears inside a piece. */
const qrPath = (link: string) => /<path fill="#000" d="([^"]+)"/.exec(qrSvg(link))?.[1] ?? "missing";

const escapedStatement = MATERIALS_STATEMENT.replace(/'/g, "&#39;");

describe("the pieces", () => {
  it("are the A4 poster, the A3 poster, the A5 leaflet, the pictures, the sponsor form and the certificate", () => {
    expect([...MATERIALS]).toEqual(["poster", "poster-a3", "leaflet", "social", "sponsor-form", "certificate"]);
  });

  it("gives an organiser the new sizes once approved, like the poster", () => {
    for (const p of ["poster-a3", "leaflet"] as const) {
      expect(materialAllowed(p, "approved", "organiser")).toBe(true);
      expect(materialAllowed(p, "finished", "organiser")).toBe(true);
      expect(materialAllowed(p, "new", "organiser")).toBe(false);
    }
  });
});

describe("the poster in three sizes", () => {
  it("knows each paper's size", () => {
    expect(POSTER_SIZES).toEqual({
      a5: { label: "A5 leaflet", paper: "A5", widthMm: 148, heightMm: 210 },
      a4: { label: "A4 poster", paper: "A4", widthMm: 210, heightMm: 297 },
      a3: { label: "A3 poster", paper: "A3", widthMm: 297, heightMm: 420 },
    });
  });

  for (const size of ["a5", "a4", "a3"] as const) {
    const { paper, widthMm, heightMm } = POSTER_SIZES[size];
    const html = renderPoster(facts(), ASSETS, size);

    it(`${size}: prints on ${paper} portrait, its page exactly that size`, () => {
      expect(html).toContain(`@page{size:${paper} portrait;margin:0}`);
      expect(html).toMatch(new RegExp(`\\.size-${size}\\{width:${widthMm}mm;height:${heightMm}mm\\}`));
      expect(html).toContain(`class="page size-${size} poster"`);
    });

    it(`${size}: fits, the A4 design scaled to the paper and never bigger than it`, () => {
      const scale = Number(new RegExp(`\\.size-${size} \\.p-scale\\{transform:scale\\(([0-9.]+)\\)\\}`).exec(html)?.[1]);
      expect(scale).toBeGreaterThan(0);
      expect(210 * scale).toBeLessThanOrEqual(widthMm + 0.05);
      expect(297 * scale).toBeLessThanOrEqual(heightMm + 0.05);
      // Within half a millimetre of filling the paper's width.
      expect(widthMm - 210 * scale).toBeLessThan(0.5);
    });

    it(`${size}: carries the charity statement word for word`, () => {
      expect(html).toContain(escapedStatement);
    });

    it(`${size}: carries the logo`, () => {
      expect(html).toMatch(new RegExp(`<img class="p-logo" src="${ASSETS.logo}"`));
    });

    it(`${size}: its QR code is its own short link, never the page's address`, () => {
      const code = size === "a5" ? "a5" : size;
      expect(html).toContain(`d="${qrPath(`https://nbcc.test/q/12-${code}`)}"`);
      expect(html).not.toContain(`d="${qrPath(PAGE)}"`);
      // People still read the page's address in words.
      expect(html).toContain("nbcc.test/fundraise/sams-santa-dash");
    });

    it(`${size}: says how to ask us for anything else, on screen only`, () => {
      expect(html).toContain(ASK_US.replace(/'/g, "&#39;"));
      expect(html).toMatch(/@media print\{[^}]*\.ask-us\{display:none\}/);
    });
  }

  it("the A4 poster is still what renderPoster draws when no size is given", () => {
    expect(renderPoster(facts(), ASSETS)).toContain("@page{size:A4 portrait;margin:0}");
  });

  it("each size names itself in its toolbar", () => {
    expect(renderPoster(facts(), ASSETS, "a5")).toContain("Your A5 leaflet");
    expect(renderPoster(facts(), ASSETS, "a3")).toContain("Your A3 poster");
  });

  it("an event's poster still has a code of its own, which leads to Get involved", () => {
    const html = renderPoster(facts({ path: "event" }), ASSETS, "a3");
    expect(html).toContain(`d="${qrPath("https://nbcc.test/q/12-a3")}"`);
    expect(html).toContain("nbcc.test/get-involved");
  });

  it("no code at all for a fundraiser not on the website", () => {
    expect(renderPoster(facts({ public: false }), ASSETS, "a5")).not.toContain("<svg xmlns");
  });
});

describe("the logo, as big as the layout allows", () => {
  it("is far bigger than before on a short poster", () => {
    expect(posterLogoMm(facts())).toBeGreaterThanOrEqual(50);
  });

  it("gives way a little when the words are long, never below a good size", () => {
    const long = facts({
      title: "The Great Annual Christmas Jumper Sponsored Walk Around the Whole of the Loch and Back",
      cardLine: "A long line ".repeat(11).trim(),
    });
    expect(posterLogoMm(long)).toBeLessThan(posterLogoMm(facts()));
    expect(posterLogoMm(long)).toBeGreaterThanOrEqual(38);
  });

  it("is drawn at that height", () => {
    const d = facts();
    expect(renderPoster(d, ASSETS)).toContain(`.p-logo{height:${posterLogoMm(d)}mm`);
  });
});

describe("the charity statement on every printed piece", () => {
  it("is on the sponsor form, on both pages", () => {
    const html = renderSponsorForm(facts(), ASSETS);
    expect(html.split(escapedStatement).length - 1).toBe(2);
  });

  it("is on the blank sponsor form", () => {
    expect(renderSponsorForm(null, ASSETS)).toContain(escapedStatement);
  });

  it("is on the certificate", () => {
    expect(renderCertificate(facts({ status: "finished" }), ASSETS, { date: "1 January 2027", preview: false })).toContain(escapedStatement);
  });

  it("each carries the logo bigger than before", () => {
    const sponsor = renderSponsorForm(facts(), ASSETS);
    const height = Number(/\.sf-head img\{height:(\d+)mm/.exec(sponsor)?.[1]);
    expect(height).toBeGreaterThanOrEqual(22);
    const cert = renderCertificate(facts({ status: "finished" }), ASSETS, { date: "1 January 2027", preview: false });
    expect(Number(/\.c-logo\{height:(\d+)mm/.exec(cert)?.[1])).toBeGreaterThanOrEqual(36);
  });

  it("every piece says how to ask us for anything else", () => {
    for (const html of [
      renderSponsorForm(facts(), ASSETS),
      renderCertificate(facts({ status: "finished" }), ASSETS, { date: "1 January 2027", preview: false }),
      renderSocial(facts(), ASSETS, ""),
    ]) {
      expect(html).toContain(ASK_US.replace(/'/g, "&#39;"));
    }
  });
});

describe("the policy line", () => {
  it("is Jaimie's words", () => {
    expect(ASK_US).toBe(
      "Need something else, like a banner or a different size? Give us a call on 01292 811 015 or email events@nbcc.scot and we'll make it for you. Please don't make your own versions of our logo or materials.",
    );
  });
});

describe("the pictures to share, in five sizes", () => {
  it("are the sizes Instagram and Facebook ask for", () => {
    expect(SOCIAL_SIZES.map((s) => [s.kind, s.width, s.height])).toEqual([
      ["square", 1080, 1080],
      ["portrait", 1080, 1350],
      ["story", 1080, 1920],
      ["facebook", 1200, 630],
      ["cover", 1920, 1005],
    ]);
  });

  const html = renderSocial(facts(), ASSETS, "");

  it("each has its own canvas at its exact size and its own download", () => {
    for (const s of SOCIAL_SIZES) {
      expect(html).toMatch(new RegExp(`<canvas[^>]*data-social="${s.kind}"[^>]*width="${s.width}" height="${s.height}"`));
      expect(html).toMatch(new RegExp(`<button[^>]*data-social-download="${s.kind}"`));
    }
  });

  it("can be downloaded all at once, as a zip", () => {
    expect(html).toMatch(/<button[^>]*data-social-zip/);
  });

  it("hands the drawing the shorter charity statement", () => {
    const json = /<script type="application\/json" id="socialData">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(JSON.parse(json).statement).toBe(MATERIALS_STATEMENT_SHORT);
  });
});

describe("everything on one page, for staff", () => {
  const approved = renderEverything(facts(), ASSETS, { date: "1 January 2027", script: "/* drawing */" });

  it("has every printed piece one after another, each on its own paper size", () => {
    expect(approved).toContain("@page a4p{size:A4 portrait;margin:0}");
    expect(approved).toContain("@page a4l{size:A4 landscape;margin:0}");
    expect(approved).toContain("@page a3p{size:A3 portrait;margin:0}");
    expect(approved).toContain("@page a5p{size:A5 portrait;margin:0}");
    const pages = approved.match(/<div class="page [^"]*"/g) ?? [];
    expect(pages).toEqual([
      '<div class="page size-a4 poster"',
      '<div class="page size-a3 poster"',
      '<div class="page size-a5 poster"',
      '<div class="page landscape"',
      '<div class="page landscape"',
    ]);
  });

  it("keeps each poster's own QR code", () => {
    for (const code of ["a4", "a3", "a5"]) expect(approved).toContain(`d="${qrPath(`https://nbcc.test/q/12-${code}`)}"`);
  });

  it("adds the certificate only once the fundraiser is finished", () => {
    expect(approved).not.toContain("Certificate of thanks</h1>");
    const finished = renderEverything(facts({ status: "finished" }), ASSETS, { date: "1 January 2027", script: "" });
    expect(finished).toContain("Certificate of thanks</h1>");
    expect(finished.match(/<div class="page [^"]*"/g)?.length).toBe(6);
  });

  it("has one print button and a zip of every picture", () => {
    expect(approved.match(/onclick="window\.print\(\)"/g)?.length).toBe(1);
    expect(approved).toMatch(/<button[^>]*data-social-zip/);
    expect(approved).toContain("/* drawing */");
  });

  it("carries the statement on every printed page", () => {
    expect(approved.split(escapedStatement).length - 1).toBe(5);
  });
});

describe("each piece's QR code scans", () => {
  // Read back the way a phone would: the code drawn as pixels, then decoded.
  it("as its own short link, even at the leaflet's size", async () => {
    const { default: sharp } = await import("sharp");
    const { default: jsQR } = await import("jsqr");
    for (const [size, code] of [["a5", "a5"], ["a4", "a4"], ["a3", "a3"]] as const) {
      const html = renderPoster(facts(), ASSETS, size);
      const svg = /<div class="p-qr">(<svg[\s\S]*?<\/svg>)<\/div>/.exec(html)?.[1] ?? "";
      // The leaflet's code is 66mm x 0.705, about 47mm: drawn at 300 dots an inch, about 550 pixels.
      const png = await sharp(Buffer.from(svg)).resize(550, 550).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const found = jsQR(new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length), png.info.width, png.info.height);
      expect(found?.data, size).toBe(`https://nbcc.test/q/12-${code}`);
    }
  });
});

describe("the note on every materials page", () => {
  it("is a fully bordered box, with no coloured stripe down one side", () => {
    const html = renderPoster(facts(), ASSETS, "a4");
    const rule = /\.ask-us\{([^}]*)\}/.exec(html)?.[1] ?? "";
    expect(rule).toMatch(/border:1\.6px solid/);
    expect(rule).not.toMatch(/border-left/);
  });
});

describe("the page address in words", () => {
  // Whatever the page is called NOW: a short initials address (TASK-511) prints as it is.
  it("is the fundraiser's current address on every piece", () => {
    const f = record({ slug: "ssd" });
    const d = materialFacts(f, f.meter, { pageUrl: "https://nbcc.test/fundraise/ssd", getInvolvedUrl: INVOLVED });
    for (const size of ["a5", "a4", "a3"] as const) expect(renderPoster(d, ASSETS, size)).toContain("or visit nbcc.test/fundraise/ssd<");
    const json = /<script type="application\/json" id="socialData">([\s\S]*?)<\/script>/.exec(renderSocial(d, ASSETS, ""))?.[1] ?? "";
    expect(JSON.parse(json).linkWords).toBe("nbcc.test/fundraise/ssd");
    expect(renderEverything(d, ASSETS, { date: "1 January 2027", script: "" }).split("or visit nbcc.test/fundraise/ssd<").length - 1).toBe(3);
  });
});
