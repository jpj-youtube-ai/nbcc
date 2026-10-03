// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiseSignUp } from "../../src/fundraising/render";
import { ALL_BUILT_IN_CATEGORIES, formCategories, memoryCategories, rememberCategories } from "../../src/fundraising/categories";

// TASK-494: the fundraising sign up form at /fundraise. Every field the design asks for, the spam
// check loaded only when someone starts on the form, plain English errors from the server next to
// the field they belong to, a thank you, and a gentle "not open yet" if fundraising is switched off.
//
// The sign up tidy (Jaimie, 2026-10-03): one step at a time with Next and Back, three paths, and an
// address from everyone raising money or holding an event (test/unit/fundraise-signup-tidy-form.test.ts
// holds those). Here the answers are set, then Next is pressed through to the last step, where Send
// is. Every name, address and number here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const stepsLib = require(resolve(ROOT, "assets/js/fundraise-steps.js"));
const { initFundraiseForm } = require(resolve(ROOT, "assets/js/fundraise.js"));
const template = readFileSync(resolve(ROOT, "fundraise.html"), "utf8");

// A walk through every step is a few seconds in jsdom on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[];
let answer: (url: string) => { status: number; body: unknown };

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

function load(open = true) {
  rememberCategories(ALL_BUILT_IN_CATEGORIES);
  document.documentElement.innerHTML = new DOMParser()
    .parseFromString(renderFundraiseSignUp(template, open, formCategories(), memoryCategories()), "text/html")
    .documentElement.innerHTML;
  calls = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.fetch = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const a = answer(url);
    return json(a.status, a.body);
  });
  w.NBCCFormValidation = { validateForm: shared.validateForm, clearValidation: shared.clearValidation };
  w.NBCCFormSteps = stepsLib;
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
const choose = (id: string, value: string) => {
  const el = $<HTMLSelectElement>(`#${id}`);
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const submit = async () => {
  $("#fundraiseForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
  await flush();
};
const posts = () => calls.filter((c) => c.url === "/api/fundraise");
const sent = () => JSON.parse(String(posts()[0].init?.body));
const nextBtn = () => $<HTMLButtonElement>("[data-next]");
const current = () => document.querySelector<HTMLElement>("[data-step].is-current")!;
const has = (id: string) => current().contains(document.getElementById(id));
const errorOf = (id: string) => document.getElementById(`${id}-error`)?.textContent ?? "";
/** Press Next until the last step, or until a step holds them with something to put right. */
const walk = () => {
  for (let i = 0; i < 40 && !nextBtn().hidden; i++) {
    const before = current();
    nextBtn().click();
    if (current() === before) break;
  }
};
/** To the last step (Check and send), saying which step held them if one did. */
const toEnd = () => {
  walk();
  if (!nextBtn().hidden) {
    const held = [...current().querySelectorAll('[aria-invalid="true"]')].map((n) => n.id).join(", ");
    throw new Error(`held at "${current().querySelector("legend, h2, label")?.textContent}" by: ${held}`);
  }
};

// Every answer someone raising money is asked, in the order the steps come.
function fillRaising() {
  tick("pathRaising");
  tick("over18Yes");
  tick("childMe");
  tick("orgNo");
  // TASK-511: the name in two boxes, and every yes or no answered on purpose.
  type("firstName", "Jo");
  type("lastName", "Example");
  type("email", "jo@example.com");
  type("phone", "07700 900222");
  tick("teamMe");
  tick("sportingYes");
  tick("kind-walk");
  choose("tshirtSize", "adult_l");
  type("title", "Jo's Sponsored Walk");
  type("description", "Forty miles for NBCC.");
  type("eventDate", "2026-11-14");
  type("town", "Exampleton");
  type("target", "250");
  tick("listedYes");
  tick("sharesNo");
  tick("shareNo");
  tick("attendNo");
  type("postLine1", "1 Example Road");
  type("postTown", "Exampleton");
  type("postPostcode", "ex1 1ex");
}

// Every answer someone holding an event must give (TASK-499), and no more.
function fillEvent(o: { card?: boolean } = {}) {
  tick("pathEvent");
  tick("over18Yes");
  tick("orgNo");
  type("firstName", "Jo");
  type("lastName", "Example");
  type("email", "jo@example.com");
  type("phone", "07700 900222");
  tick("kind-quiz");
  type("title", "The Exampleton Quiz Night");
  type("description", "Eight rounds for NBCC.");
  type("eventDate", "2026-11-14");
  if (o.card !== false) {
    type("venue", "Example Village Hall");
    type("cardLine", "Eight rounds, a raffle and a bar, all for NBCC.");
    tick("booking-door");
  }
  tick("listedNo");
  tick("sharesNo");
  tick("shareNo");
  tick("attendNo");
  type("postLine1", "1 Example Road");
  type("postTown", "Exampleton");
  type("postPostcode", "EX1 1EX");
}

beforeEach(() => {
  answer = (url) => (url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: null } } : { status: 200, body: { status: "received" } });
});

// The sign up tidy (Jaimie, 2026-10-03): "asks for a target only when raising money" is gone. Someone
// holding an event is asked the amount they hope to raise too (fundraise-signup-tidy-form.test.ts).
describe("the paths", () => {
  beforeEach(() => load());

  it("needs a date for an event, and says so in the label", () => {
    tick("pathEvent");
    expect($("#eventDate").required).toBe(true);
    expect($("[data-date-required]").hidden).toBe(false);
    expect($("[data-date-optional]").hidden).toBe(true);
    tick("pathRaising");
    expect($("#eventDate").required).toBe(false);
    expect($("[data-date-required]").hidden).toBe(true);
    expect($("label[for=eventDate] > span").textContent).toBe("When is it happening?");
    expect($("[data-date-optional]").textContent).toBe("(if there's a date)");
  });
});

describe("what they would like", () => {
  beforeEach(() => load());

  // TASK-499: posters, leaflets, buckets and tins each have their own number. The sign up tidy: the
  // address is always asked of someone raising money or holding an event, for the welcome pack (it
  // was only asked when something was to be posted); what they ask for comes to it too.
  it("says anything asked for comes to the address too, once posters, leaflets, buckets or tins are asked for", () => {
    tick("pathRaising");
    expect($("[data-address-field]").hidden).toBe(false);
    expect($("[data-posted-note]").hidden).toBe(true);
    for (const id of ["posters", "leaflets", "buckets", "tins"]) {
      type(id, "2");
      expect($("[data-posted-note]").hidden, id).toBe(false);
      expect($("[data-address-field]").hidden, id).toBe(false);
      type(id, "0");
      expect($("[data-posted-note]").hidden, id).toBe(true);
      expect($("[data-address-field]").hidden, id).toBe(false);
    }
    expect($("[data-posted-note]").textContent).toBe("Anything you asked for comes here too. If you are local, we may drop it off instead.");
  });

  it("asks for each on its own, with sensible limits", () => {
    expect([...document.querySelectorAll<HTMLInputElement>(".fr-count")].map((i) => [i.id, i.max])).toEqual([
      // The sign up tidy: collection envelopes, only in memory of someone.
      ["envelopes", "500"],
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
  // The sign up tidy: Send is only on the last step, so nothing can be sent from an empty form
  // (Enter there is Next). With an answer taken out again, Send flags each one and sends nothing.
  it("sends nothing while required answers are missing, and flags each one", async () => {
    load();
    await submit();
    expect(posts()).toHaveLength(0);
    expect($("#pathRaising").getAttribute("aria-invalid")).toBe("true");
    fillRaising();
    toEnd();
    type("title", "");
    type("phone", "");
    await submit();
    expect(posts()).toHaveLength(0);
    expect($("#title").getAttribute("aria-invalid")).toBe("true");
    expect($("#phone").getAttribute("aria-invalid")).toBe("true");
    expect(errorOf("phone")).toBe("Almost! Just add a phone number, so we can give you a call.");
  });

  it("sends exactly what the API asks for", async () => {
    load();
    fillRaising();
    type("leaflets", "25");
    type("tins", "2");
    tick("shareShout");
    type("instagram", "@jo.walks");
    tick("newsletterOk");
    toEnd();
    await submit();
    expect(posts()).toHaveLength(1);
    expect(posts()[0].init?.method).toBe("POST");
    expect(sent()).toEqual({
      path: "raising",
      kind: "walk",
      title: "Jo's Sponsored Walk",
      description: "Forty miles for NBCC.",
      eventDate: "2026-11-14",
      dateTbc: false,
      startTime: "",
      venue: "",
      town: "Exampleton",
      targetPence: 25000,
      // The sign up tidy: every sign up gets a page; listed says whether it goes on Get involved.
      public: true,
      listed: true,
      kindOther: "",
      firstName: "Jo",
      lastName: "Example",
      email: "jo@example.com",
      phone: "07700 900222",
      instagram: "@jo.walks",
      facebook: "",
      socialOk: true,
      over18: true,
      sharesWithOther: false,
      nbccSharePercent: null,
      otherCauseName: "",
      splitConfirmed: false,
      // In memory (Jaimie, 2026-10-03): a path of its own; someone raising money sends none of it.
      inMemory: false,
      memoryName: "",
      memoryDates: "",
      memorySetupBy: "",
      memoryPermission: false,
      memoryShowTarget: null,
      memoryDirectorBusiness: "",
      memoryFamilyContactName: "",
      memoryFamilyContactEmail: "",
      callTime: "",
      // The sign up tidy: sport and the t-shirt, who is fundraising, and a business, school or group.
      isSporting: true,
      tshirtSize: "adult_l",
      childFundraiser: "me",
      childFirstName: "",
      childConsent: false,
      forOrganisation: false,
      orgName: "",
      employerMatch: null,
      wants: { posterCount: 0, leafletCount: 25, bucketCount: 0, tinCount: 2, qrCount: 0, envelopeCount: 0, shoutOut: true, attend: false },
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
      nbccCheck: "",
      formVersion: 2,
      captchaToken: "",
    });
  });

  // The sign up tidy (Jaimie, 2026-10-03): was "sends no target and no address for an event with
  // nothing posted". An event has a page now, so its amount is sent; and everyone holding one gives
  // an address, for the welcome pack.
  it("sends an event's amount and address, and none of what only raising money is asked", async () => {
    load();
    fillEvent();
    type("target", "400");
    toEnd();
    await submit();
    expect(sent()).toMatchObject({
      path: "event",
      targetPence: 40000,
      public: true,
      listed: false,
      postLine1: "1 Example Road",
      postTown: "Exampleton",
      postPostcode: "EX1 1EX",
      inMemory: null,
      isSporting: null,
      tshirtSize: "",
      childFundraiser: null,
      team: "me",
    });
  });

  it("says thank you by first name, and what happens next", async () => {
    load();
    fillRaising();
    toEnd();
    await submit();
    const thanks = $("[data-fundraise-thanks]");
    expect(thanks.hidden).toBe(false);
    expect($("[data-fundraise-open]").hidden).toBe(true);
    expect(thanks.textContent).toContain("Thank you, Jo.");
    // The sign up tidy: one list for raising money and an event (each has a page), another in memory.
    expect($("[data-thanks-steps]").hidden).toBe(false);
    expect($("[data-thanks-memory]").hidden).toBe(true);
    expect($("[data-thanks-listed]").hidden).toBe(false);
    expect($("[data-thanks-team]").hidden).toBe(true);
    expect($("[data-thanks-eyebrow]").textContent).toBe("Sign up received");
    expect(document.activeElement).toBe(thanks);
  });

  it("puts each server message next to its field, and goes back to the first", async () => {
    load();
    fillRaising();
    toEnd();
    answer = (url) =>
      url === "/api/fundraise"
        ? { status: 400, body: { error: "Some of the form needs another look", fields: { phone: "That does not look like a phone number.", "wants.buckets": "We can lend up to 20 buckets or tins." } } }
        : { status: 200, body: { siteKey: null } };
    await submit();
    expect($("#phone").getAttribute("aria-invalid")).toBe("true");
    expect(errorOf("phone")).toBe("That does not look like a phone number.");
    expect(errorOf("buckets")).toBe("We can lend up to 20 buckets or tins.");
    expect(has("phone")).toBe(true);
    expect($<HTMLButtonElement>("[data-submit]").disabled).toBe(false);
  });

  it("asks for the robot check again when the server refuses it", async () => {
    load();
    fillRaising();
    toEnd();
    answer = (url) => (url === "/api/fundraise" ? { status: 400, body: { error: "captcha" } } : { status: 200, body: { siteKey: null } });
    await submit();
    expect($("#formStatus").textContent).toMatch(/robot/);
    expect($("#formStatus").className).toContain("is-error");
  });

  it("shows the gentle not open yet message if fundraising is switched off meanwhile", async () => {
    load();
    fillRaising();
    toEnd();
    answer = (url) => (url === "/api/fundraise" ? { status: 404, body: { error: "Fundraising is not open yet" } } : { status: 200, body: { siteKey: null } });
    await submit();
    expect($("[data-fundraise-closed]").hidden).toBe(false);
    expect($("[data-fundraise-open]").hidden).toBe(true);
  });

  it("asks them to wait a little after too many tries", async () => {
    load();
    fillRaising();
    toEnd();
    answer = (url) => (url === "/api/fundraise" ? { status: 429, body: {} } : { status: 200, body: { siteKey: null } });
    await submit();
    expect($("#formStatus").textContent).toMatch(/few minutes/);
  });

  it("keeps everything they typed when the network fails", async () => {
    load();
    fillRaising();
    toEnd();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn((url: string) => (url === "/api/fundraise" ? Promise.reject(new Error("offline")) : json(200, { siteKey: null })));
    await submit();
    expect($("#formStatus").textContent).toMatch(/could not send/);
    expect($<HTMLInputElement>("#title").value).toBe("Jo's Sponsored Walk");
    expect(has("newsletterOk")).toBe(true);
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
    $("#pathRaising").dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(document.querySelectorAll('script[src*="challenges.cloudflare.com"]')).toHaveLength(1);
  });

  it("holds a send until the check has passed", async () => {
    answer = (url) => (url === "/api/fundraise/captcha" ? { status: 200, body: { siteKey: "site-key-for-tests" } } : { status: 200, body: {} });
    load();
    await flush();
    await flush();
    fillRaising();
    toEnd();
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
    for (const id of ["pathRaising", "pathMemory"]) {
      tick(id);
      expect($("[data-event-questions]").hidden, id).toBe(true);
      expect($("[data-event-times]").hidden, id).toBe(true);
    }
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
      "NBCC sells the tickets for me",
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
    toEnd();
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
    fillEvent();
    tick("booking-away");
    type("ticketUrl", "https://tickets.example.com/quiz");
    tick("booking-door");
    toEnd();
    await submit();
    expect(sent().booking).toBe("door");
    expect(sent().ticketUrl).toBe("");
  });

  // The sign up tidy: Next holds them on the step with something missing, so Send is never reached.
  it("hold them on each step while the event questions are missing, and flag each one", async () => {
    fillEvent({ card: false });
    walk();
    expect(has("venue")).toBe(true);
    expect($("#venue").getAttribute("aria-invalid")).toBe("true");
    expect(errorOf("venue")).toBe("Almost! Just tell us where it is.");
    type("venue", "Example Village Hall");
    walk();
    expect(has("cardLine")).toBe(true);
    expect($("#cardLine").getAttribute("aria-invalid")).toBe("true");
    expect($("#booking-away").getAttribute("aria-invalid")).toBe("true");
    expect(errorOf("cardLine")).toBe("Almost! Just add a line for the front of the card.");
    expect(errorOf("booking")).toBe("Almost! Just choose how people get in.");
    // Enter there is Next, and Next stays put: nothing is sent.
    await submit();
    expect(posts()).toHaveLength(0);
    expect(has("cardLine")).toBe(true);
  });

  it("send nothing when the finish is before the start", async () => {
    fillEvent();
    type("startTime", "19:30");
    type("endTime", "18:00");
    walk();
    expect(has("endTime")).toBe(true);
    expect(errorOf("endTime")).toBe("The finish time is before the start.");
    // Put right, on to the last step, then made wrong again: Send goes back to it.
    type("endTime", "22:00");
    toEnd();
    type("endTime", "18:00");
    await submit();
    expect(posts()).toHaveLength(0);
    expect(has("endTime")).toBe(true);
    expect(errorOf("endTime")).toBe("The finish time is before the start.");
  });

  it("send nothing with a ticket link that is not https, or a postcode that is not one", async () => {
    fillEvent();
    tick("booking-away");
    type("ticketUrl", "http://tickets.example.com/quiz");
    type("venuePostcode", "12345");
    walk();
    expect(has("ticketUrl")).toBe(true);
    expect($("#ticketUrl").getAttribute("aria-invalid")).toBe("true");
    expect($("#venuePostcode").getAttribute("aria-invalid")).toBe("true");
    await submit();
    expect(posts()).toHaveLength(0);
  });

  it("put the server's message for a new answer next to it", async () => {
    fillEvent();
    type("posters", "3");
    toEnd();
    answer = (url) =>
      url === "/api/fundraise"
        ? { status: 400, body: { error: "x", fields: { postPostcode: "Tell us the postcode.", "access.0": "Tick only the access listed.", "wants.tinCount": "We can lend up to 20 tins." } } }
        : { status: 200, body: { siteKey: null } };
    await submit();
    expect(errorOf("postPostcode")).toBe("Tell us the postcode.");
    expect(errorOf("tins")).toBe("We can lend up to 20 tins.");
    expect($("#access-0").getAttribute("aria-invalid")).toBe("true");
    // Back to the first of them: the event's card.
    expect(has("access-0")).toBe(true);
  });
});
