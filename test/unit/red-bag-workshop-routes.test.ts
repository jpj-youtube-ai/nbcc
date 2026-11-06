// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { redBagPageHandler, type WorkshopFor } from "../../src/routes/red-bag";
import { workshopView } from "../../src/red-bag/workshop";

// /fill and a company's own /fill/<slug> (Jaimie, 6 November 2026). The Workshop is the night look's:
// before the Ball's moment the page is exactly as it was and no company link works. Invented names.
const template = readFileSync(resolve(__dirname, "../../fill-a-red-bag.html"), "utf8");

function fakeRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
      return this;
    },
    type() {
      return this;
    },
    send(b: string) {
      this.body = b;
      return this;
    },
  };
}

async function ask(o: { slug?: string; night?: boolean; workshop?: WorkshopFor }) {
  const res = fakeRes();
  const next = vi.fn();
  const workshop: WorkshopFor =
    o.workshop ??
    (async (slug) => {
      if (slug === undefined) return { view: workshopView(5000 * 40, "everyone") };
      if (slug === "brightwater-engineering") return { view: { ...workshopView(5000 * 4, "small", "Brightwater Engineering"), slug } };
      return null;
    });
  const handler = redBagPageHandler({
    template: () => template,
    notFound: () => "<html><head></head><body>We cannot find that page</body></html>",
    decorate: async (h) => h,
    live: () => true,
    indexable: true,
    list: async () => null,
    isAfterBall: () => o.night !== false,
    workshop,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await handler({ headers: {}, query: {}, params: o.slug === undefined ? {} : { slug: o.slug } } as any, res as any, next);
  return { res, next, doc: new DOMParser().parseFromString(res.body, "text/html") };
}

describe("GET /fill at night: everyone's Workshop", () => {
  it("shows everyone's bags on the sign, with no company named", async () => {
    const { doc, res } = await ask({});
    expect(res.statusCode).toBe(200);
    expect(doc.querySelector(".fn-sign b")?.textContent).toBe("40 bags filled");
    expect(doc.querySelector(".fn-sign i")).toBeNull();
    expect(doc.querySelector("[data-rb-workshop]")).toBeNull();
  });

  it("is still the page when the Workshop cannot be read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { doc, res } = await ask({ workshop: async () => Promise.reject(new Error("away")) });
    expect(res.statusCode).toBe(200);
    expect(doc.querySelector(".fn-workshop")).not.toBeNull();
    expect(doc.querySelector(".fn-sign")).toBeNull();
    log.mockRestore();
  });
});

describe("GET /fill/<slug>: a company's own Workshop", () => {
  it("shows only their bags, their name on the sign, and tells the gift whose it is", async () => {
    const { doc, res } = await ask({ slug: "brightwater-engineering" });
    expect(res.statusCode).toBe(200);
    expect(doc.querySelector(".fn-sign i")?.textContent).toBe("Brightwater Engineering");
    expect(doc.querySelector(".fn-sign b")?.textContent).toBe("4 bags filled");
    expect(doc.querySelector("[data-rb-workshop]")?.getAttribute("data-rb-workshop")).toBe("brightwater-engineering");
  });

  it("is never listed by search engines", async () => {
    const { res } = await ask({ slug: "brightwater-engineering" });
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });

  it("hands on to the site's 404 for a company it does not know, or before the Ball's moment", async () => {
    expect((await ask({ slug: "someone-else" })).next).toHaveBeenCalled();
    expect((await ask({ slug: "brightwater-engineering", night: false })).next).toHaveBeenCalled();
  });

  it("hands on to the 404 when the companies cannot be read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await ask({ slug: "brightwater-engineering", workshop: async () => Promise.reject(new Error("away")) })).next).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("GET /fill before the Ball's moment", () => {
  it("draws no Workshop at all", async () => {
    const { doc } = await ask({ night: false });
    expect(doc.querySelector(".fn-workshop")).toBeNull();
  });
});
