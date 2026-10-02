// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";
import { materialFacts, renderSocial } from "../../src/fundraising/materials";

// TASK-504: the social media pictures, drawn in the browser on a canvas and downloaded as PNGs.
// jsdom has no canvas, so a stand in context records what is drawn; what is checked is the words
// on each picture, the optional meter, and that each Download button saves its own PNG under a
// sensible name. Every name and place is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initSocial } = require(resolve(ROOT, "assets/js/fundraise-social.js"));

const ASSETS = { fontCss: "", logo: "data:image/png;base64,TE9HTw==", logoOnDark: "data:image/png;base64,REFSSw==" };

function facts(over: Partial<FundraiserRecord> = {}) {
  const f = {
    id: 12,
    slug: "sams-santa-dash",
    path: "raising",
    kind: "santa_dash",
    title: "Sam's Santa Dash",
    description: "Five kilometres in a red suit.",
    eventDate: "2026-12-05",
    startTime: "10:00",
    venue: "North Inch",
    town: "Perth",
    targetPence: 50000,
    public: true,
    status: "approved",
    name: "Sam Example",
    cardLine: null,
    ...over,
  } as FundraiserRecord;
  const m = meter({ onlinePence: 44000, cashPence: 10000, targetPence: f.targetPence });
  return materialFacts(f, m, { pageUrl: "https://nbcc.test/fundraise/sams-santa-dash", getInvolvedUrl: "https://nbcc.test/get-involved" });
}

// A stand in 2D context: remembers every piece of text drawn on its canvas.
const drawn = new Map<HTMLCanvasElement, string[]>();
function fakeContext(canvas: HTMLCanvasElement) {
  const texts: string[] = [];
  drawn.set(canvas, texts);
  const noop = () => undefined;
  const gradient = { addColorStop: noop };
  return new Proxy(
    {
      font: "10px sans-serif",
      fillText: (t: string) => texts.push(t),
      measureText: function (this: { font: string }, t: string) {
        const size = Number(/(\d+)px/.exec(this.font)?.[1] ?? 10);
        return { width: t.length * size * 0.5 };
      },
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
    } as Record<string, unknown>,
    {
      get: (target, key) => (key in target ? target[key as string] : noop),
      set: (target, key, value) => ((target[key as string] = value), true),
    },
  );
}

let saved: Array<{ name: string; href: string }>;

async function open(over: Partial<FundraiserRecord> = {}) {
  const html = renderSocial(facts(over), ASSETS, "");
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, "text/html").documentElement.innerHTML;
  const api = initSocial(document, window, { loadImage: () => Promise.resolve(null) });
  await api.ready;
  return api;
}

const canvas = (kind: string) => document.querySelector<HTMLCanvasElement>(`canvas[data-social="${kind}"]`)!;
const textOn = (kind: string) => (drawn.get(canvas(kind)) ?? []).join(" ");

beforeEach(() => {
  drawn.clear();
  saved = [];
  vi.restoreAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    return fakeContext(this) as unknown as CanvasRenderingContext2D;
  } as never);
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, type?: string) {
    expect(type).toBe("image/png");
    cb(new Blob(["png"], { type: "image/png" }));
  };
  URL.createObjectURL = vi.fn(() => "blob:nbcc.test/picture");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, href: this.href });
  });
});

describe("the social pictures", () => {
  it("draw the title, Fundraising for NBCC and the page address on both", async () => {
    await open();
    for (const kind of ["square", "story"]) {
      expect(textOn(kind)).toContain("Sam's Santa Dash");
      expect(textOn(kind).toLowerCase()).toContain("fundraising for nbcc");
      expect(textOn(kind)).toContain("nbcc.test/fundraise/sams-santa-dash");
    }
  });

  it("show the meter, raised and target, while the box is ticked", async () => {
    await open();
    expect(textOn("square")).toContain("£540 raised");
    expect(textOn("square")).toContain("of £500 target");
  });

  it("leave the meter off once the box is unticked", async () => {
    await open();
    const box = document.querySelector<HTMLInputElement>("[data-social-meter]")!;
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(textOn("square")).not.toContain("raised");
    expect(textOn("story")).not.toContain("raised");
  });

  it("say nbcc.scot when the fundraiser has no page", async () => {
    await open({ public: false });
    expect(textOn("square")).toContain("nbcc.scot");
    expect(textOn("square")).not.toContain("/fundraise/");
  });

  it("save the square picture as a PNG when its Download button is pressed", async () => {
    await open();
    document.querySelector<HTMLButtonElement>('[data-social-download="square"]')!.click();
    expect(saved).toEqual([{ name: "nbcc-sams-santa-dash-square.png", href: "blob:nbcc.test/picture" }]);
  });

  it("save the story picture as its own PNG", async () => {
    await open();
    document.querySelector<HTMLButtonElement>('[data-social-download="story"]')!.click();
    expect(saved.map((s) => s.name)).toEqual(["nbcc-sams-santa-dash-story.png"]);
  });

  it("say so when the browser cannot make the picture", async () => {
    await open();
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(null);
    };
    document.querySelector<HTMLButtonElement>('[data-social-download="square"]')!.click();
    expect(saved).toEqual([]);
    expect(document.querySelector("[data-social-status]")!.textContent).toMatch(/could not/i);
  });
});
