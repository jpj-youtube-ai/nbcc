// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { renderPledgeExtras } from "../../src/pledges/render";
import { pledgeDeclarationWording } from "../../src/pledges/model";

// Sponsor pledges: the script on a fundraiser's page (assets/js/fundraiser-pledge.js). It shows the
// pledge form, keeps the Gift Aid declaration in step with the amount typed, sends the pledge as
// JSON, and says thank you in place. Kept apart from fundraiser.js so each can change without the
// other. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const { initPledgeForm } = createRequire(import.meta.url)(resolve(ROOT, "assets/js/fundraiser-pledge.js")) as {
  initPledgeForm: (doc: Document, win: unknown) => unknown;
};

const html = renderPledgeExtras({
  slug: "robins-santa-dash",
  title: "Robin's Santa Dash",
  organiserFirstName: "Robin",
  eventDate: "2026-12-05",
  open: true,
  minimumPence: 200,
  pledges: [],
  openCount: 0,
  openPence: 0,
  today: "2026-11-04",
  now: new Date("2026-11-04T12:00:00Z"),
}).giveHtml;

const $ = <T extends Element = HTMLInputElement>(sel: string) => document.querySelector(sel) as T;
const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};
const type = (id: string, value: string) => {
  const el = document.getElementById(id) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const tick = (id: string, on = true) => {
  const el = document.getElementById(id) as HTMLInputElement;
  el.checked = on;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};

let fetchMock: ReturnType<typeof vi.fn>;
function start(answer: { status: number; body: unknown } = { status: 201, body: { status: "pledged", confirm: true, amountPence: 1000 } }) {
  document.body.innerHTML = `<main>${html}</main>`;
  fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/fundraise/captcha") return { ok: true, status: 200, json: async () => ({ siteKey: null }) };
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  });
  initPledgeForm(document, { fetch: fetchMock, location: { href: "" } });
}
const fill = () => {
  type("plAmount", "10");
  type("plFirstName", "Alex");
  type("plSurname", "Example");
  type("plEmail", "alex@example.com");
};
const submit = async () => {
  $<HTMLFormElement>("#pledgeForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
};
const sent = () => {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/pledges"));
  return call ? { url: String(call[0]), init: call[1] as RequestInit, body: JSON.parse(String((call[1] as RequestInit).body)) } : null;
};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("the pledge form on the page", () => {
  it("shows the form and hides the note for when there is no script", () => {
    start();
    expect($<HTMLFormElement>("#pledgeForm").hidden).toBe(false);
    expect($<HTMLElement>("#pledge [data-nojs]").hidden).toBe(true);
  });

  it("puts the amount typed into the Gift Aid declaration, as it will be kept", () => {
    start();
    const statement = () => ($(".giftaid-statement").textContent ?? "").replace(/\s+/g, " ").trim();
    expect(statement()).toContain("my donation of the amount I pledge when I pay it");
    type("plAmount", "10");
    expect(statement()).toBe(pledgeDeclarationWording(1000).wording_snapshot);
    type("plAmount", "12.5");
    expect(statement()).toBe(pledgeDeclarationWording(1250).wording_snapshot);
    type("plAmount", "");
    expect(statement()).toContain("the amount I pledge");
  });

  it("asks for the home address only once Gift Aid is ticked, and no postcode for a home abroad", () => {
    start();
    const address = $<HTMLFieldSetElement>("#plDeclaration");
    expect(address.hidden).toBe(true);
    expect(address.disabled).toBe(true);
    tick("plGiftAid");
    expect(address.hidden).toBe(false);
    expect(address.disabled).toBe(false);
    tick("plNonUk");
    expect($<HTMLElement>("#plPostcodeField").hidden).toBe(true);
    expect(($("#plPostcode") as HTMLInputElement).required).toBe(false);
  });

  it("sends the pledge in pence with the choices, to this page's own address", async () => {
    start();
    fill();
    type("plMessage", "Go on Robin!");
    await submit();
    const s = sent()!;
    expect(s.url).toBe("/api/fundraisers/robins-santa-dash/pledges");
    expect(s.init.method).toBe("POST");
    expect(s.body).toEqual({
      amountPence: 1000,
      firstName: "Alex",
      surname: "Example",
      email: "alex@example.com",
      message: "Go on Robin!",
      showName: true,
      showAmount: true,
      giftAid: false,
      company: "",
      captchaToken: "",
    });
  });

  it("sends the home address only with Gift Aid", async () => {
    start();
    fill();
    tick("plGiftAid");
    type("plHouse", "12");
    type("plAddress", "Example Street, Exampleton");
    type("plPostcode", "KA1 1AA");
    tick("plShowNameNo");
    await submit();
    expect(sent()!.body).toMatchObject({ giftAid: true, house: "12", address: "Example Street, Exampleton", postcode: "KA1 1AA", nonUk: false, showName: false });
  });

  it("does not send an amount under £2, and says why", async () => {
    start();
    fill();
    type("plAmount", "1");
    await submit();
    expect(sent()).toBeNull();
    expect($<HTMLElement>("[data-pledge-error]").hidden).toBe(false);
    expect($("[data-pledge-error]").textContent).toContain("£2");
  });

  it("says it is nearly done: an email is on its way with a link to confirm, and nothing is paid today", async () => {
    start();
    fill();
    await submit();
    const done = $<HTMLElement>("[data-pledge-done]");
    expect(done.hidden).toBe(false);
    expect($<HTMLFormElement>("#pledgeForm").hidden).toBe(true);
    const words = (done.textContent ?? "").replace(/\s+/g, " ");
    expect(words).toContain("Nearly done: we've emailed you a link to confirm your pledge.");
    expect(words).toContain("Please press the button in that email, and your £10 pledge will show on this page.");
    expect(words).toContain("There is nothing to pay today.");
    // It is not a pledge yet, so it never says it is in.
    expect(words).not.toContain("pledge is in");
  });

  it("does not send more than £1,000, and says to call", async () => {
    start();
    fill();
    type("plAmount", "1000.01");
    await submit();
    expect(sent()).toBeNull();
    expect($("[data-pledge-error]").textContent).toContain("For a pledge over £1,000, please call us on 01292 811 015.");
  });

  it("writes the sponsor's name as text, never as markup", async () => {
    start();
    fill();
    type("plFirstName", "<img src=x onerror=alert(1)>");
    await submit();
    expect($<HTMLElement>("[data-pledge-done]").hidden).toBe(false);
    expect($("[data-pledge-done]").querySelector("img")).toBeNull();
  });

  it("shows what the server refused beside its field", async () => {
    start({ status: 400, body: { error: "Some of the form needs another look", fields: { email: "Please give an email address, like you@example.com." } } });
    fill();
    await submit();
    expect($<HTMLFormElement>("#pledgeForm").hidden).toBe(false);
    expect(document.body.textContent).toContain("Please give an email address, like you@example.com.");
  });

  it("says so when the page has stopped taking pledges, or the server is down", async () => {
    start({ status: 409, body: { error: "This page is not taking pledges. You can still give on the page." } });
    fill();
    await submit();
    expect($("[data-pledge-error]").textContent).toBe("This page is not taking pledges. You can still give on the page.");
    start({ status: 500, body: {} });
    fill();
    await submit();
    expect($("[data-pledge-error]").textContent).toBe("We could not take your pledge just now. Please try again in a few minutes.");
  });

  it("does nothing on a page with no pledge form", () => {
    document.body.innerHTML = "<main></main>";
    expect(initPledgeForm(document, { fetch: vi.fn() })).toBeNull();
  });
});
