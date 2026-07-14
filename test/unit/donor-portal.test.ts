// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-104 (REQ-061): portal.html — the self-serve donor portal landing page. A donor reaches it
// via the one-time magic-link token in the URL query string (?token=…); on load initPortal calls
// GET /api/portal/:token and renders the donor's details, subscription plan and Gift Aid state. The
// "cancel monthly gift" action is gated behind a reduce-instead choice (REQ-055), and a Gift Aid
// cancel control posts to /api/portal/:token/gift-aid/cancel (TASK-103). Static markup is parsed
// with jsdom; behaviour runs against the real initPortal from main.js, mirroring contact /
// give-checkout tests. The sitewide accessibility/copy-rules/seo guards cover the page too.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "portal.html"), "utf8");
const doc0 = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("donor portal page markup (REQ-061)", () => {
  it("renders a centred intro mirroring the other pages", () => {
    // TASK-220: the page uses the shared boxed container (like thank-you/supporters) so the
    // intro centres and the content is width-constrained and cleared of the fixed nav.
    expect(doc0.querySelector("main")?.classList.contains("site-main--boxed")).toBe(true);
    const intro = doc0.querySelector("section.portal-intro");
    expect(intro).not.toBeNull();
    expect(norm(intro?.querySelector(".eyebrow")?.textContent).length).toBeGreaterThan(0);
    expect(norm(intro?.querySelector("h1")?.textContent).length).toBeGreaterThan(0);
    expect(intro?.querySelector(".rule")).not.toBeNull();
    expect(norm(intro?.querySelector(".lede")?.textContent).length).toBeGreaterThan(0);
  });

  it("carries the fields initPortal fills, plus the reduce-instead gate and the two cancel controls", () => {
    for (const id of ["portalName", "portalEmail", "portalPlan", "portalGiftAid"]) {
      expect(doc0.getElementById(id), `#${id} missing`).not.toBeNull();
    }
    // The reduce-instead choice is hidden until the donor asks to cancel the subscription; the
    // actual cancel action lives INSIDE it, so it is not reachable before the choice is shown.
    const start = doc0.getElementById("cancelSubStart");
    const choice = doc0.getElementById("reduceChoice");
    const confirm = doc0.getElementById("confirmCancelSub");
    expect(start).not.toBeNull();
    expect(choice?.hasAttribute("hidden"), "#reduceChoice must start hidden").toBe(true);
    expect(choice?.contains(confirm), "#confirmCancelSub must live inside #reduceChoice").toBe(true);
    expect(doc0.getElementById("reduceInstead"), "#reduceInstead missing").not.toBeNull();
    expect(doc0.getElementById("cancelGiftAid"), "#cancelGiftAid missing").not.toBeNull();
  });

  it("offers a self-edit details form (name, email, consent, anonymity) (REQ-061)", () => {
    const form = doc0.getElementById("portalDetailsForm");
    expect(form, "#portalDetailsForm missing").not.toBeNull();
    for (const id of ["pdName", "pdEmail", "pdEmailConsent", "pdAnonymous"]) {
      expect(doc0.getElementById(id), `#${id} missing`).not.toBeNull();
    }
    expect(doc0.getElementById("pdName")?.hasAttribute("required")).toBe(true);
  });

  it("offers a self-serve magic-link request form inside the error card (REQ-061)", () => {
    const err = doc0.getElementById("portalError");
    const form = doc0.getElementById("portalRequestForm");
    const email = doc0.getElementById("portalRequestEmail");
    expect(form, "#portalRequestForm missing").not.toBeNull();
    // The request form must live inside the error card so it is shown exactly when the donor has
    // no usable link (initPortal reveals #portalError on the no-token / failed-load path).
    expect(err?.contains(form), "request form must live inside #portalError").toBe(true);
    expect(email?.getAttribute("type")).toBe("email");
    expect(email?.hasAttribute("required")).toBe(true);
  });
});

// --- Behaviour (jsdom), against the real initPortal --------------------------------------------
const { initPortal, initPortalRequest } = require(resolve(ROOT, "assets/js/main.js"));

const SNAPSHOT = {
  donorId: 42,
  fullName: "Ada Portal",
  email: "ada.portal@example.com",
  emailConsent: true,
  anonymous: false,
  subscriptionPlan: "gold",
  subscriptionId: "sub_test_123",
  giftAid: true,
};

const TOKEN = "tok_abc";

// A fake window carrying the token in the query string + a mocked fetch, so initPortal is exercised
// without a real backend (mirrors the contact test stubbing window.fetch).
function makeWin(fetchImpl: ReturnType<typeof vi.fn>) {
  return {
    fetch: fetchImpl,
    location: { search: `?token=${TOKEN}`, href: "" },
  } as unknown as Window & typeof globalThis;
}

// Resolve a mocked GET response, then flush the promise microtasks initPortal chains.
const flush = () => new Promise((r) => setTimeout(r, 0));

const getFetch = () =>
  vi.fn(async () => ({ ok: true, json: async () => SNAPSHOT }) as unknown as Response);

beforeEach(() => {
  document.body.innerHTML = doc0.querySelector("main")?.outerHTML ?? "";
});

describe("initPortal behaviour (jsdom)", () => {
  it("exports initPortal from the shared script", () => {
    expect(typeof initPortal).toBe("function");
  });

  it("renders the donor details, subscription plan and Gift Aid state from the GET response", async () => {
    const fetchMock = getFetch();
    const win = makeWin(fetchMock);
    initPortal(document, win);
    await flush();

    // It called GET /api/portal/:token with the URL token.
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/portal/${TOKEN}`);

    expect(norm(document.getElementById("portalName")?.textContent)).toContain("Ada Portal");
    expect(norm(document.getElementById("portalEmail")?.textContent)).toContain(
      "ada.portal@example.com",
    );
    expect(norm(document.getElementById("portalPlan")?.textContent).toLowerCase()).toContain("gold");
    expect(norm(document.getElementById("portalGiftAid")?.textContent).length).toBeGreaterThan(0);
  });

  it("presents the reduce-instead choice before the cancel-subscription action is reachable", async () => {
    const win = makeWin(getFetch());
    initPortal(document, win);
    await flush();

    const choice = document.getElementById("reduceChoice")!;
    const confirm = document.getElementById("confirmCancelSub")!;
    // Before the donor asks to cancel, the reduce-instead choice (which contains the cancel action)
    // is hidden — so the cancel-subscription action is not reachable.
    expect(choice.hidden).toBe(true);

    document.getElementById("cancelSubStart")!.dispatchEvent(new Event("click", { bubbles: true }));
    // Now the reduce-instead choice is shown, exposing both "reduce instead" and the cancel action.
    expect(choice.hidden).toBe(false);
    expect(choice.contains(confirm)).toBe(true);
    expect(document.getElementById("reduceInstead")).not.toBeNull();
  });

  it("prefills the self-edit details form from the GET snapshot", async () => {
    const win = makeWin(getFetch());
    initPortal(document, win);
    await flush();

    expect((document.getElementById("pdName") as HTMLInputElement).value).toBe("Ada Portal");
    expect((document.getElementById("pdEmail") as HTMLInputElement).value).toBe(
      "ada.portal@example.com",
    );
    expect((document.getElementById("pdEmailConsent") as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById("pdAnonymous") as HTMLInputElement).checked).toBe(false);
  });

  it("PATCHes the bare /api/portal/:token with the edited details on submit", async () => {
    const fetchMock = getFetch();
    const win = makeWin(fetchMock);
    initPortal(document, win);
    await flush();
    fetchMock.mockClear();

    (document.getElementById("pdName") as HTMLInputElement).value = "Ada Renamed";
    (document.getElementById("pdEmailConsent") as HTMLInputElement).checked = false;
    (document.getElementById("pdAnonymous") as HTMLInputElement).checked = true;
    document
      .getElementById("portalDetailsForm")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();

    expect(fetchMock).toHaveBeenCalled();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`/api/portal/${TOKEN}`);
    expect((opts as RequestInit)?.method).toBe("PATCH");
    const body = JSON.parse(String((opts as RequestInit)?.body));
    expect(body.fullName).toBe("Ada Renamed");
    expect(body.emailConsent).toBe(false);
    expect(body.anonymous).toBe(true);
    expect(body.email).toBe("ada.portal@example.com");
  });

  it("posts to /api/portal/:token/gift-aid/cancel when the Gift Aid cancel control is used", async () => {
    const fetchMock = getFetch();
    const win = makeWin(fetchMock);
    initPortal(document, win);
    await flush();
    fetchMock.mockClear();

    document.getElementById("cancelGiftAid")!.dispatchEvent(new Event("click", { bubbles: true }));
    await flush();

    expect(fetchMock).toHaveBeenCalled();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`/api/portal/${TOKEN}/gift-aid/cancel`);
    expect((opts as RequestInit)?.method).toBe("POST");
  });

  it("posts accepted:'cancel' with the subscription id when the cancel action is confirmed", async () => {
    const fetchMock = getFetch();
    const win = makeWin(fetchMock);
    initPortal(document, win);
    await flush();
    fetchMock.mockClear();

    document.getElementById("cancelSubStart")!.dispatchEvent(new Event("click", { bubbles: true }));
    document.getElementById("confirmCancelSub")!.dispatchEvent(new Event("click", { bubbles: true }));
    await flush();

    expect(fetchMock).toHaveBeenCalled();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`/api/portal/${TOKEN}/subscription/cancel`);
    const body = JSON.parse(String((opts as RequestInit)?.body));
    expect(body.accepted).toBe("cancel");
    expect(body.subscriptionId).toBe("sub_test_123");
  });

  it("shows an error and never fetches when the URL carries no token", async () => {
    const fetchMock = getFetch();
    const win = { fetch: fetchMock, location: { search: "", href: "" } } as unknown as Window &
      typeof globalThis;
    initPortal(document, win);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    const err = document.getElementById("portalError");
    expect(err?.hidden).toBe(false);
  });
});

describe("initPortalRequest behaviour (jsdom)", () => {
  it("exports initPortalRequest from the shared script", () => {
    expect(typeof initPortalRequest).toBe("function");
  });

  it("posts the email to /api/portal/request and shows the generic reply", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => ({ message: "ok" }) }) as unknown as Response,
    );
    const win = makeWin(fetchMock);
    initPortalRequest(document, win);

    const input = document.getElementById("portalRequestEmail") as HTMLInputElement;
    input.value = "lost.link@example.com";
    document
      .getElementById("portalRequestForm")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();

    expect(fetchMock).toHaveBeenCalled();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/portal/request");
    expect((opts as RequestInit)?.method).toBe("POST");
    expect(JSON.parse(String((opts as RequestInit)?.body)).email).toBe("lost.link@example.com");
    // The reply is the same generic line regardless of match, so no enumeration leaks.
    expect(norm(document.getElementById("portalRequestStatus")?.textContent).length).toBeGreaterThan(
      0,
    );
  });

  it("does not post an empty/invalid email (native validation blocks it)", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, json: async () => ({}) }) as unknown as Response,
    );
    const win = makeWin(fetchMock);
    initPortalRequest(document, win);

    const input = document.getElementById("portalRequestEmail") as HTMLInputElement;
    input.value = "not-an-email";
    document
      .getElementById("portalRequestForm")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
