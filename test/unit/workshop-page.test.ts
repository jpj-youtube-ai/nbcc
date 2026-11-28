// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALL_PAGES, PRIVATE_PAGES, RESERVED_PREFIXES } from "../../src/site/pages";

// Workshop drop-offs: the tablet page at /workshop (workshop.html) and its script
// (assets/js/workshop.js). See docs/superpowers/specs/2026-11-28-workshop-dropoffs-design.md. Also
// everything a new page needs so it is really served. Every name and address here is invented.

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const HTML = read("workshop.html");
const require_ = createRequire(import.meta.url);
const { initWorkshop } = require_(resolve(ROOT, "assets/js/workshop.js")) as {
  initWorkshop: (doc: Document, win: unknown) => unknown;
};

const body = () => HTML.slice(HTML.indexOf("<body>") + 6, HTML.indexOf("</body>"));
const el = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};
const type = (id: string, value: string) => {
  el(id).value = value;
  el(id).dispatchEvent(new Event("input", { bubbles: true }));
};
const send = () => el<HTMLFormElement>("wsForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

let fetchMock: ReturnType<typeof vi.fn>;
const answer = (status: number, data: unknown) =>
  fetchMock.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(data) });

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = body();
  fetchMock = vi.fn();
  initWorkshop(document, { fetch: fetchMock, setTimeout, clearTimeout });
});
afterEach(() => vi.useRealTimers());

const fillGood = () => {
  type("wsName", "Robin Example");
  type("wsEmail", "robin@example.com");
  type("wsBrought", "Two bags of selection boxes");
};

describe("the page", () => {
  it("is kept out of search engines and has the five boxes, the three suggestions and an unticked newsletter box", () => {
    expect(HTML).toContain('<meta name="robots" content="noindex" />');
    for (const id of ["wsName", "wsEmail", "wsBrought", "wsGroup", "wsPhone"]) expect(document.querySelector(`label[for=${id}]`)).not.toBeNull();
    expect([...document.querySelectorAll("[data-ws-group]")].map((b) => b.textContent)).toEqual(["Individual", "Church group", "Business"]);
    expect(el("wsNewsletter").checked).toBe(false);
    expect(HTML).not.toMatch(/id="wsNewsletter"[^>]*checked/);
    expect(document.querySelector("h1")?.textContent).toBe("Thank you for bringing something in");
    expect(HTML).toContain("Send me the NBCC newsletter (a few emails a year)");
  });

  it("is served at /workshop, in the image, and listed only among the admin's private pages", () => {
    const redirects = read("_redirects");
    expect(redirects).toMatch(/^\/workshop\s+\/workshop\.html\s+200$/m);
    expect(redirects).toMatch(/^\/workshop\.html\s+\/workshop\s+301!$/m);
    expect(read("Dockerfile")).toMatch(/COPY [^\n]* workshop\.html /);
    expect(RESERVED_PREFIXES).toContain("/workshop");
    expect(ALL_PAGES.some((p) => p.path === "/workshop")).toBe(false);
    expect(PRIVATE_PAGES.find((p) => p.path === "/workshop")?.reach).toBe("unlisted");
  });
});

describe("filling it in", () => {
  it("a suggestion fills the box, and typing something else lets it go", () => {
    el("wsGroup").value = "";
    (document.querySelector('[data-ws-group="Church group"]') as HTMLButtonElement).click();
    expect(el("wsGroup").value).toBe("Church group");
    expect(document.querySelector('[data-ws-group="Church group"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-ws-group="Business"]')?.getAttribute("aria-pressed")).toBe("false");
    type("wsGroup", "Rotary Club");
    expect(document.querySelectorAll('[aria-pressed="true"]').length).toBe(0);
  });

  it("says what is missing beside each box and sends nothing", () => {
    send();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(el("wsName").getAttribute("aria-invalid")).toBe("true");
    expect(el("wsName-error").textContent).toBe("Please tell us your name.");
    expect(el("wsEmail-error").textContent).toBe("Please check your email address.");
    expect(el("wsBrought-error").textContent).toBe("Please tell us what you brought in.");
  });

  it("sends the details, and the newsletter only when ticked", async () => {
    fillGood();
    type("wsPhone", "07700 900123");
    (document.querySelector('[data-ws-group="Business"]') as HTMLButtonElement).click();
    el("wsNewsletter").checked = true;
    answer(201, { ok: true, firstName: "Robin" });
    send();
    await flush();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workshop");
    expect(JSON.parse(init.body)).toEqual({
      name: "Robin Example",
      email: "robin@example.com",
      brought: "Two bags of selection boxes",
      groupName: "Business",
      phone: "07700 900123",
      newsletter: true,
    });
  });
});

describe("after Send", () => {
  it("thanks them by first name, then clears everything for the next person", async () => {
    fillGood();
    type("wsGroup", "Church group");
    el("wsNewsletter").checked = true;
    answer(201, { ok: true, firstName: "Robin" });
    send();
    await flush();
    expect(el("wsForm").hidden).toBe(true);
    expect(el("wsDone").hidden).toBe(false);
    expect(el("wsDoneTitle").textContent).toBe("Thank you, Robin!");

    vi.advanceTimersByTime(8000);
    expect(el("wsForm").hidden).toBe(false);
    expect(el("wsDone").hidden).toBe(true);
    for (const id of ["wsName", "wsEmail", "wsBrought", "wsGroup", "wsPhone"]) expect(el(id).value).toBe("");
    expect(el("wsNewsletter").checked).toBe(false);
    expect(el("wsStatus").textContent).toBe("");
    expect(document.querySelectorAll('[aria-pressed="true"]').length).toBe(0);
  });

  it("Next person brings the form back straight away", async () => {
    fillGood();
    answer(201, { ok: true, firstName: null });
    send();
    await flush();
    expect(el("wsDoneTitle").textContent).toBe("Thank you!");
    el<HTMLButtonElement>("wsNext").click();
    expect(el("wsForm").hidden).toBe(false);
    expect(el("wsName").value).toBe("");
  });

  it("shows the server's words when it refuses, and keeps what they typed", async () => {
    fillGood();
    answer(400, { error: "Please check your email address.", field: "email" });
    send();
    await flush();
    expect(el("wsForm").hidden).toBe(false);
    expect(el("wsStatus").textContent).toBe("Please check your email address.");
    expect(el("wsStatus").className).toContain("is-error");
    expect(el("wsEmail").getAttribute("aria-invalid")).toBe("true");
    expect(el("wsName").value).toBe("Robin Example");
  });

  it("says something friendly when it cannot reach us", async () => {
    fillGood();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    send();
    await flush();
    expect(el("wsStatus").textContent).toContain("could not be sent");
    expect(el("wsName").value).toBe("Robin Example");
  });
});
