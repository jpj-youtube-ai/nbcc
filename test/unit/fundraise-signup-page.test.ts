// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiseSignUp } from "../../src/fundraising/render";

// TASK-494: the fundraising sign up form at /fundraise. Two paths (raising money, or holding an
// event), every field the design asks for, the address only when something is to be posted, the
// spam check loaded only when someone starts on the form, plain English errors from the server
// next to the field they belong to, a thank you, and a gentle "not open yet" if fundraising is
// switched off. Every name, address and number here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const { initFundraiseForm } = require(resolve(ROOT, "assets/js/fundraise.js"));
const template = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[];
let answer: (url: string) => { status: number; body: unknown };

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

function load(open = true) {
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(renderFundraiseSignUp(template, open), "text/html")
    .documentElement.innerHTML;
  calls = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const a = answer(url);
    return json(a.status, a.body);
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).NBCCFormValidation = { validateForm: shared.validateForm, clearValidation: shared.clearValidation };
  return initFundraiseForm(document, window);
}

const $ = <T extends HTMLElement = HTMLInputElement>(sel: string) => document.querySelector<T>(sel)!;
const flush = () => new Promise((r) => setTimeout(r, 0));
const type = (id: string, value: string) => {
  const el = $<HTMLInputElement>(`#${id}`);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const tick = (id: string) => {
  const el = $<HTMLInputElement>(`#${id}`);
  el.checked = true;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const submit = async () => {
  $("#fundraiseForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
  await flush();
};
const posts = () => calls.filter((c) => c.url === "/api/fundraise");
const sent = () => JSON.parse(String(posts()[0].init?.body));

function fillRaising() {
  tick("pathRaising");
  // Jaimie, 2026-10-03: 18 or over, and not sharing with another cause; and just me, not a team.
  tick("over18Yes");
  tick("inMemoryNo"); // In memory: not this time
  tick("teamMe");
  tick("sharesNo");
  type("title", "Jo's Sponsored Swim");
  tick("kind-walk");
  type("description", "Forty lengths for NBCC.");
  type("eventDate", "2026-11-14");
  type("town", "Exampleton");
  type("target", "250");
  tick("publicYes");
  // TASK-511: the name in two boxes, and every yes or no answered on purpose.
  type("firstName", "Jo");
  type("lastName", "Example");
  type("email", "jo@example.com");
  type("phone", "07700 900222");
  tick("socialOkNo");
  tick("shoutOutNo");
  tick("attendNo");
}

// The event questions (TASK-499), answered.
function fillEvent() {
  type("venue", "Example Village Hall");
  type("cardLine", "Eight rounds, a raffle and a bar, all for NBCC.");
  tick("booking-door");
}

beforeEach(() => {
  answer = (url) => (url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: null } } : { status: 200, body: { status: "received" } });
});

describe("the two paths", () => {
  beforeEach(() => load());

  it("asks for a target only when raising money", () => {
    tick("pathEvent");
    expect($("[data-target-question]").hidden).toBe(true);
    tick("pathRaising");
    expect($("[data-target-question]").hidden).toBe(false);
  });

  it("needs a date for an event, and says so in the label", () => {
    tick("pathEvent");
    expect($("#eventDate").required).toBe(true);
    expect($("[data-date-required]").hidden).toBe(false);
    expect($("[data-date-optional]").hidden).toBe(true);
    tick("pathRaising");
    expect($("#eventDate").required).toBe(false);
  });
});

describe("what they would like", () => {
  beforeEach(() => load());

  // TASK-499: posters, leaflets, buckets and tins each have their own number.
  it("asks for an address only when posters, leaflets, buckets or tins are to be posted", () => {
    expect($("[data-address-field]").hidden).toBe(true);
    for (const id of ["posters", "leaflets", "buckets", "tins"]) {
      type(id, "2");
      expect($("[data-address-field]").hidden).toBe(false);
      type(id, "0");
      expect($("[data-address-field]").hidden).toBe(true);
    }
  });

  it("asks for each on its own, with sensible limits", () => {
    expect([...document.querySelectorAll<HTMLInputElement>(".fr-count")].map((i) => [i.id, i.max])).toEqual([
      ["posters", "1000"],
      ["leaflets", "1000"],
      ["qrCodes", "200"],
      ["buckets", "20"],
      ["tins", "20"],
    ]);
    for (const id of ["posters", "leaflets", "buckets", "tins"]) {
      expect(document.querySelector(`label[for="${id}"]`)?.textContent).toMatch(/how many\?$/);
    }
  });

  it("asks for the address in separate boxes: line one, the town and the postcode needed, line two not", () => {
    expect($("#postLine1").required).toBe(true);
    expect($("#postLine2").required).toBe(false);
    expect($("#postTown").required).toBe(true);
    expect($("#postPostcode").required).toBe(true);
    expect(document.getElementById("postAddress")).toBeNull();
  });
});

describe("the description", () => {
  it("counts down what is left", () => {
    load();
    type("description", "x".repeat(990));
    expect($("#descriptionCount").textContent).toBe("10 characters left.");
  });
});

describe("sending", () => {
  it("sends nothing while required answers are missing, and flags each one", async () => {
    load();
    await submit();
    expect(posts()).toHaveLength(0);
    expect($("[data-form-error]").hidden).toBe(false);
    expect($("#title").getAttribute("aria-invalid")).toBe("true");
    expect($("#phone").getAttribute("aria-invalid")).toBe("true");
  });

  it("sends exactly what the API asks for", async () => {
    load();
    fillRaising();
    type("leaflets", "25");
    type("tins", "2");
    type("postLine1", "1 Example Road");
    type("postTown", "Exampleton");
    type("postPostcode", "ex1 1ex");
    tick("shoutOutYes");
    tick("socialOkYes");
    type("instagram", "@jo.swims");
    tick("newsletterOk");
    await submit();
    expect(posts()).toHaveLength(1);
    expect(posts()[0].init?.method).toBe("POST");
    expect(sent()).toEqual({
      path: "raising",
      kind: "walk",
      title: "Jo's Sponsored Swim",
      description: "Forty lengths for NBCC.",
      eventDate: "2026-11-14",
      startTime: "",
      venue: "",
      town: "Exampleton",
      targetPence: 25000,
      public: true,
      kindOther: "",
      firstName: "Jo",
      lastName: "Example",
      email: "jo@example.com",
      phone: "07700 900222",
      instagram: "@jo.swims",
      facebook: "",
      socialOk: true,
      over18: true,
      sharesWithOther: false,
      nbccSharePercent: null,
      otherCauseName: "",
      // In memory (Jaimie, 2026-10-03): asked of someone raising money; a No sends none of it.
      inMemory: false,
      memoryName: "",
      memoryDates: "",
      memorySetupBy: "",
      memoryPermission: false,
      memoryShowTarget: null,
      wants: { posterCount: 0, leafletCount: 25, bucketCount: 0, tinCount: 2, qrCount: 0, shoutOut: true, attend: false },
      postLine1: "1 Example Road",
      postLine2: "",
      postTown: "Exampleton",
      postPostcode: "ex1 1ex",
      newsletterOk: true,
      // Asked only of an event: someone raising money sends none of them.
      cardLine: "",
      endTime: "",
      timeTbc: false,
      venueAddress: "",
      venuePostcode: "",
      access: [],
      price: "",
      booking: "",
      ticketUrl: "",
      ageLimit: "",
      dressCode: "",
      included: "",
      creditName: "",
      // Team pages: just me, so no split mode and nobody to invite.
      team: "me",
      teamShareMode: null,
      teamMembers: [],
      company: "",
      captchaToken: "",
    });
  });

  it("sends no target and no address for an event with nothing posted", async () => {
    load();
    fillRaising();
    tick("pathEvent");
    fillEvent();
    tick("publicNo");
    await submit();
    expect(sent().path).toBe("event");
    expect(sent().targetPence).toBeNull();
    expect(sent().public).toBe(false);
    expect(sent().postLine1).toBe("");
  });

  it("says thank you by first name, and what happens next", async () => {
    load();
    fillRaising();
    await submit();
    const thanks = $("[data-fundraise-thanks]");
    expect(thanks.hidden).toBe(false);
    expect($("[data-fundraise-open]").hidden).toBe(true);
    expect(thanks.textContent).toContain("Thank you, Jo.");
    expect($("[data-thanks-raising]").hidden).toBe(false);
    expect($("[data-thanks-event]").hidden).toBe(true);
    expect(document.activeElement).toBe(thanks);
  });

  it("puts each server message next to its field", async () => {
    load();
    fillRaising();
    answer = (url) =>
      url === "/api/fundraise"
        ? { status: 400, body: { error: "Some of the form needs another look", fields: { phone: "That does not look like a phone number.", "wants.buckets": "We can lend up to 20 buckets or tins." } } }
        : { status: 200, body: { siteKey: null } };
    await submit();
    expect($("#phone").getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("phone-error")?.textContent).toBe("That does not look like a phone number.");
    expect(document.getElementById("buckets-error")?.textContent).toBe("We can lend up to 20 buckets or tins.");
    expect($("[data-form-error]").hidden).toBe(false);
    expect($<HTMLButtonElement>("[data-submit]").disabled).toBe(false);
  });

  it("asks for the robot check again when the server refuses it", async () => {
    load();
    fillRaising();
    answer = (url) => (url === "/api/fundraise" ? { status: 400, body: { error: "captcha" } } : { status: 200, body: { siteKey: null } });
    await submit();
    expect($("#formStatus").textContent).toMatch(/robot/);
    expect($("#formStatus").className).toContain("is-error");
  });

  it("shows the gentle not open yet message if fundraising is switched off meanwhile", async () => {
    load();
    fillRaising();
    answer = (url) => (url === "/api/fundraise" ? { status: 404, body: { error: "Fundraising is not open yet" } } : { status: 200, body: { siteKey: null } });
    await submit();
    expect($("[data-fundraise-closed]").hidden).toBe(false);
    expect($("[data-fundraise-open]").hidden).toBe(true);
  });

  it("asks them to wait a little after too many tries", async () => {
    load();
    fillRaising();
    answer = (url) => (url === "/api/fundraise" ? { status: 429, body: {} } : { status: 200, body: { siteKey: null } });
    await submit();
    expect($("#formStatus").textContent).toMatch(/few minutes/);
  });

  it("keeps everything they typed when the network fails", async () => {
    load();
    fillRaising();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn((url: string) => (url === "/api/fundraise" ? Promise.reject(new Error("offline")) : json(200, { siteKey: null })));
    await submit();
    expect($("#formStatus").textContent).toMatch(/could not send/);
    expect($<HTMLInputElement>("#title").value).toBe("Jo's Sponsored Swim");
  });
});

describe("the spam check", () => {
  it("loads nothing from Cloudflare while the check is off", async () => {
    load();
    await flush();
    $("#title").dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
  });

  it("loads Cloudflare's script only once someone starts on the form", async () => {
    answer = (url) => (url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: "site-key-for-tests" } } : { status: 200, body: {} });
    load();
    await flush();
    await flush();
    expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
    $("#title").dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(document.querySelectorAll('script[src*="challenges.cloudflare.com"]')).toHaveLength(1);
  });

  it("holds a send until the check has passed", async () => {
    answer = (url) => (url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: "site-key-for-tests" } } : { status: 200, body: {} });
    load();
    await flush();
    await flush();
    fillRaising();
    await submit();
    expect(posts()).toHaveLength(0);
    expect($("#formStatus").textContent).toMatch(/robot/);
  });
});

describe("switched off", () => {
  it("shows only the not open yet message, and the script leaves it alone", () => {
    load(false);
    expect($("[data-fundraise-closed]").hidden).toBe(false);
    expect($("[data-fundraise-open]").hidden).toBe(true);
  });
});

describe("once the script runs", () => {
  it("shows the form and hides the no JavaScript line", () => {
    load();
    expect($("#fundraiseForm").hidden).toBe(false);
    expect($("[data-nojs]").hidden).toBe(true);
  });
});

// TASK-499: the event questions, worded like the admin's events editor, only for someone holding
// an event.
describe("the event questions", () => {
  beforeEach(() => load());

  it("are asked only when holding an event", () => {
    expect($("[data-event-questions]").hidden).toBe(true);
    expect($("[data-event-times]").hidden).toBe(true);
    tick("pathEvent");
    expect($("[data-event-questions]").hidden).toBe(false);
    expect($("[data-event-times]").hidden).toBe(false);
    tick("pathRaising");
    expect($("[data-event-questions]").hidden).toBe(true);
    expect($("[data-event-times]").hidden).toBe(true);
  });

  it("need the venue for an event, and say so in the label", () => {
    tick("pathEvent");
    expect($("#venue").required).toBe(true);
    expect($("[data-venue-required]").hidden).toBe(false);
    expect($("[data-venue-optional]").hidden).toBe(true);
    tick("pathRaising");
    expect($("#venue").required).toBe(false);
  });

  it("use the events editor's words", () => {
    const text = $("[data-event-questions]").textContent!.replace(/\s+/g, " ");
    for (const words of [
      "A line for the front of the card",
      "One or two sentences. What is it, and why come?",
      "Full address and how to get there",
      "Access: tick only what the venue has confirmed",
      "Printed on the back, so a disabled guest can decide without having to ask.",
      "Step free entry",
      "Accessible toilets",
      "Hearing loop",
      "Blue badge parking",
      "Tickets are sold on another website",
      "Pay on the door, no booking needed",
      "Free, just come along",
      "Want NBCC to sell the tickets for you? Tell us in the description and we’ll be in touch.",
      "Age limit",
      "Dress code",
      "What’s included",
      "Credit it to",
    ]) {
      expect(text).toContain(words);
    }
    expect($("[data-event-times]").textContent).toContain("The time is still to be confirmed");
    expect([...document.querySelectorAll<HTMLInputElement>('input[name="access"]')].map((i) => i.value)).toEqual([
      "step free entry",
      "accessible toilets",
      "a hearing loop",
      "blue badge parking",
    ]);
  });

  it("keep the line for the front to 140 characters, counting down", () => {
    expect($<HTMLTextAreaElement>("#cardLine").maxLength).toBe(140);
    tick("pathEvent");
    type("cardLine", "x".repeat(130));
    expect($("#cardLineCount").textContent).toBe("10 characters left.");
  });

  it("ask for the ticket link only when tickets are sold on another website", () => {
    tick("pathEvent");
    expect($("[data-ticket-field]").hidden).toBe(true);
    tick("booking-away");
    expect($("[data-ticket-field]").hidden).toBe(false);
    expect($("#ticketUrl").required).toBe(true);
    tick("booking-free");
    expect($("[data-ticket-field]").hidden).toBe(true);
  });

  it("send every answer for an event", async () => {
    fillRaising();
    tick("pathEvent");
    fillEvent();
    type("startTime", "19:30");
    type("endTime", "22:30");
    tick("timeTbc");
    type("venueAddress", "Main Street, Exampleton");
    type("venuePostcode", "ka1 1aa");
    tick("access-1");
    tick("access-3");
    type("price", "£5 on the door");
    tick("booking-away");
    type("ticketUrl", "https://tickets.example.com/quiz");
    type("ageLimit", "18 and over");
    type("dressCode", "Festive jumpers");
    type("included", "A mince pie");
    type("creditName", "The Quiz Team");
    await submit();
    expect(sent()).toMatchObject({
      path: "event",
      venue: "Example Village Hall",
      cardLine: "Eight rounds, a raffle and a bar, all for NBCC.",
      startTime: "19:30",
      endTime: "22:30",
      timeTbc: true,
      venueAddress: "Main Street, Exampleton",
      venuePostcode: "ka1 1aa",
      access: ["accessible toilets", "blue badge parking"],
      price: "£5 on the door",
      booking: "away",
      ticketUrl: "https://tickets.example.com/quiz",
      ageLimit: "18 and over",
      dressCode: "Festive jumpers",
      included: "A mince pie",
      creditName: "The Quiz Team",
    });
  });

  it("send no ticket link for the door", async () => {
    fillRaising();
    tick("pathEvent");
    fillEvent();
    tick("booking-away");
    type("ticketUrl", "https://tickets.example.com/quiz");
    tick("booking-door");
    await submit();
    expect(sent().booking).toBe("door");
    expect(sent().ticketUrl).toBe("");
  });

  it("send nothing while the event questions are missing, and flag each one", async () => {
    fillRaising();
    tick("pathEvent");
    await submit();
    expect(posts()).toHaveLength(0);
    expect($("#venue").getAttribute("aria-invalid")).toBe("true");
    expect($("#cardLine").getAttribute("aria-invalid")).toBe("true");
    expect($("#booking-away").getAttribute("aria-invalid")).toBe("true");
  });

  it("send nothing when the finish is before the start", async () => {
    fillRaising();
    tick("pathEvent");
    fillEvent();
    type("startTime", "19:30");
    type("endTime", "18:00");
    await submit();
    expect(posts()).toHaveLength(0);
    expect(document.getElementById("endTime-error")?.textContent).toBe("The finish time is before the start.");
  });

  it("send nothing with a ticket link that is not https, or a postcode that is not one", async () => {
    fillRaising();
    tick("pathEvent");
    fillEvent();
    tick("booking-away");
    type("ticketUrl", "http://tickets.example.com/quiz");
    type("venuePostcode", "12345");
    await submit();
    expect(posts()).toHaveLength(0);
    expect($("#ticketUrl").getAttribute("aria-invalid")).toBe("true");
    expect($("#venuePostcode").getAttribute("aria-invalid")).toBe("true");
  });

  it("put the server's message for a new answer next to it", async () => {
    fillRaising();
    tick("pathEvent");
    fillEvent();
    type("posters", "3");
    type("postLine1", "1 Example Road");
    type("postTown", "Exampleton");
    type("postPostcode", "EX1 1EX");
    answer = (url) =>
      url === "/api/fundraise"
        ? { status: 400, body: { error: "x", fields: { postPostcode: "Tell us the postcode.", "access.0": "Tick only the access listed.", "wants.tinCount": "We can lend up to 20 tins." } } }
        : { status: 200, body: { siteKey: null } };
    await submit();
    expect(document.getElementById("postPostcode-error")?.textContent).toBe("Tell us the postcode.");
    expect(document.getElementById("tins-error")?.textContent).toBe("We can lend up to 20 tins.");
    expect($("#access-0").getAttribute("aria-invalid")).toBe("true");
  });
});
