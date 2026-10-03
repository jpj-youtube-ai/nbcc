// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderFundraiserPage } from "../../src/fundraising/render";
import { renderMemoryPage } from "../../src/fundraising/memory-render";
import { meter, type PublicPage } from "../../src/fundraising/model";
import { renderCancelPage, renderConfirmPage, renderPayPage, renderPledgeExtras, renderPledgeNotice, type PledgePageInput } from "../../src/pledges/render";
import { pledgeDeclarationWording } from "../../src/pledges/model";

// Sponsor pledges on a fundraiser's page, and the pay and cancel pages the emailed link opens. Drawn
// on the server, pure. Every name and word here is invented.

const ROOT = resolve(__dirname, "../..");
const template = readFileSync(resolve(ROOT, "fundraiser.html"), "utf8");
const pledgeTemplate = readFileSync(resolve(ROOT, "pledge.html"), "utf8");
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const frag = (html: string) => parse(`<main>${html}</main>`);
const words = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const NOW = new Date("2026-11-04T12:00:00Z");

const input = (over: Partial<PledgePageInput> = {}): PledgePageInput => ({
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
  now: NOW,
  ...over,
});

const some = {
  openCount: 2,
  openPence: 3500,
  pledges: [
    { name: "Alex E.", amountPence: 1000, message: "Go on <Robin>!", createdAt: "2026-11-03T12:00:00.000Z" },
    { name: "Anonymous", amountPence: null, message: null, createdAt: "2026-11-01T12:00:00.000Z" },
  ],
};

describe("the pledge option beside give now", () => {
  it("is a second, quieter button under the give button", () => {
    const doc = frag(renderPledgeExtras(input()).summaryHtml);
    const a = doc.querySelector("a.fr-summary__pledge");
    expect(words(a)).toBe("Sponsor now, pay after");
    expect(a?.getAttribute("href")).toBe("#pledge");
    expect(a?.classList.contains("btn-ghost")).toBe(true);
  });

  it("says what is pledged apart from what is raised, and when it is to be paid", () => {
    const doc = frag(renderPledgeExtras(input(some)).summaryHtml);
    expect(words(doc.querySelector(".fr-pledged"))).toBe(
      "£35 pledged by 2 sponsors, to be paid after Saturday 5 December 2026. Pledges are promises. They join the total once they are paid.",
    );
  });

  it("says 1 sponsor for one, and nothing at all for none", () => {
    expect(words(frag(renderPledgeExtras(input({ ...some, openCount: 1, openPence: 1000 })).summaryHtml).querySelector(".fr-pledged"))).toContain("£10 pledged by 1 sponsor,");
    expect(frag(renderPledgeExtras(input()).summaryHtml).querySelector(".fr-pledged")).toBeNull();
  });

  it("once the day has gone, keeps the line but takes no more pledges", () => {
    const x = renderPledgeExtras(input({ ...some, open: false, today: "2026-12-06" }));
    expect(frag(x.summaryHtml).querySelector(".fr-summary__pledge")).toBeNull();
    expect(words(frag(x.summaryHtml).querySelector(".fr-pledged"))).toContain("£35 pledged by 2 sponsors, still to be paid.");
    expect(x.giveHtml).toBe("");
    expect(frag(x.wallHtml).querySelectorAll(".fr-wall__item").length).toBe(2);
  });

  it("is nothing at all when pledges are closed and there are none", () => {
    expect(renderPledgeExtras(input({ open: false }))).toEqual({ summaryHtml: "", giveHtml: "", wallHtml: "" });
  });
});

describe("the pledge form", () => {
  const doc = frag(renderPledgeExtras(input()).giveHtml);
  const section = doc.querySelector("section#pledge");

  it("says plainly that it is a promise to pay after, with nothing to pay today", () => {
    expect(words(section?.querySelector("h2"))).toBe("Sponsor now, pay after");
    expect(words(section?.querySelector(".give-step-sub"))).toBe(
      "Promise an amount today and pay it once Robin has finished. We will email you a link to pay the day after Saturday 5 December 2026. There is nothing to pay today.",
    );
  });

  it("with no date, says the link comes when they have finished", () => {
    const sub = words(frag(renderPledgeExtras(input({ eventDate: null })).giveHtml).querySelector(".give-step-sub"));
    expect(sub).toContain("We will email you a link to pay when Robin has finished.");
  });

  it("keeps pledge, give now and the paper form apart", () => {
    const ways = words(section?.querySelector(".fr-pledge__ways"));
    expect(ways).toContain("Already on Robin's paper sponsor form? You don't need to pledge here as well.");
    expect(ways).toContain("Want to pay today? Give now instead, and it counts on the total straight away.");
    expect(section?.querySelector('.fr-pledge__ways a[href="#give"]')).not.toBeNull();
  });

  it("is shipped hidden for the script to show, with a note for when there is none", () => {
    const form = section?.querySelector("form#pledgeForm");
    expect(form?.hasAttribute("hidden")).toBe(true);
    expect(form?.getAttribute("data-slug")).toBe("robins-santa-dash");
    expect(form?.getAttribute("data-minimum-pence")).toBe("200");
    expect(section?.querySelector("[data-nojs]")).not.toBeNull();
  });

  it("asks for the amount (£2 or more), first name, surname and email, each labelled", () => {
    for (const id of ["plAmount", "plFirstName", "plSurname", "plEmail"]) {
      const field = section?.querySelector(`#${id}`);
      expect(field, id).not.toBeNull();
      expect(section?.querySelector(`label[for="${id}"]`), `label for ${id}`).not.toBeNull();
      expect(field?.hasAttribute("required")).toBe(true);
    }
    expect(section?.querySelector("#plAmount")?.getAttribute("min")).toBe("2");
    expect(section?.querySelector("#plAmount")?.getAttribute("max")).toBe("1000");
    expect(words(section?.querySelector('label[for="plAmount"]'))).toContain("£2 or more");
  });

  it("offers an optional message and the name choice, as a gift does", () => {
    expect(section?.querySelector("textarea#plMessage")?.getAttribute("maxlength")).toBe("200");
    const radios = section?.querySelectorAll('input[name="plShowName"]');
    expect(radios?.length).toBe(2);
    expect(words(section)).toContain("Robin will see your full name in their private list either way");
    expect(section?.querySelector("#plShowAmount")).not.toBeNull();
  });

  it("shows the Gift Aid declaration around the amount, word for word as it is kept", () => {
    const statement = section?.querySelector(".giftaid-statement");
    const amount = statement?.querySelector("[data-pledge-ga-amount]");
    expect(words(amount)).toBe("the amount I pledge");
    const kept = pledgeDeclarationWording(1000).wording_snapshot;
    expect(words(statement).replace("the amount I pledge", "£10")).toBe(kept);
    expect(words(section?.querySelector(".giftaid-label strong"))).toBe("Yes, add Gift Aid when I pay. I am a UK taxpayer. This gift is my own money.");
    expect(words(section?.querySelector(".giftaid"))).toContain("we only claim it once your pledge is paid");
  });

  it("asks for the home address only for Gift Aid, hidden until it is ticked", () => {
    const address = section?.querySelector("fieldset#plDeclaration");
    expect(address?.hasAttribute("hidden")).toBe(true);
    for (const id of ["plHouse", "plAddress", "plPostcode", "plNonUk"]) expect(address?.querySelector(`#${id}`), id).not.toBeNull();
  });

  it("has the hidden field a robot fills, and room for the spam check", () => {
    const pot = section?.querySelector('input[name="company"]');
    expect(pot?.getAttribute("tabindex")).toBe("-1");
    expect(pot?.closest("[hidden]")).not.toBeNull();
    expect(section?.querySelector("#pledgeCaptcha")).not.toBeNull();
  });

  it("says how long the details are kept", () => {
    expect(words(section)).toContain("We keep your details until your pledge is paid, or for 90 days after we ask.");
    expect(section?.querySelector('a[href="/privacy"]')).not.toBeNull();
  });

  it("ends with Make my pledge, no payment today, and that an email will ask them to confirm", () => {
    expect(words(section?.querySelector("button[type=submit]"))).toBe("Make my pledge");
    expect(words(section?.querySelector(".give-pay-note"))).toBe("No payment today. We will email you a link to confirm your pledge.");
  });

  it("escapes the organiser's name and the page's address", () => {
    const html = renderPledgeExtras(input({ organiserFirstName: "<i>Rob", slug: 'a"b' })).giveHtml;
    expect(html).not.toContain("<i>Rob");
    expect(html).not.toContain('a"b');
  });
});

describe("the pledges on the wall", () => {
  const doc = frag(renderPledgeExtras(input(some)).wallHtml);

  it("has its own section, apart from Supporters, saying they are promises", () => {
    expect(words(doc.querySelector("section.fr-pledges h2"))).toBe("Pledges");
    expect(words(doc.querySelector(".fr-wall__count"))).toBe("2 sponsors have pledged, newest first. A pledge is a promise to pay after the event.");
  });

  it("shows each as pledged, never as given, with the name and amount rules", () => {
    const items = [...doc.querySelectorAll(".fr-wall__item")];
    expect(words(items[0].querySelector(".fr-wall__who"))).toBe("Alex E.");
    expect(words(items[0].querySelector(".fr-wall__amount"))).toBe("pledged £10");
    expect(words(items[0].querySelector(".fr-wall__msg"))).toBe("Go on <Robin>!");
    expect(words(items[1].querySelector(".fr-wall__who"))).toBe("Anonymous");
    expect(words(items[1].querySelector(".fr-wall__amount"))).toBe("pledged");
    expect(words(items[0].querySelector(".fr-wall__when"))).toBe("yesterday");
  });

  it("is not there with no pledges", () => {
    expect(renderPledgeExtras(input()).wallHtml).toBe("");
  });
});

describe("on the fundraiser's page", () => {
  const page: PublicPage = {
    id: 41,
    slug: "robins-santa-dash",
    path: "raising",
    kind: "santa_dash",
    kindLabel: "A Santa dash",
    title: "Robin's Santa Dash",
    description: "Five kilometres in a red suit for NBCC.",
    eventDate: "2026-12-05",
    startTime: null,
    venue: "",
    town: "Exampleton",
    imageSrc: null,
    organisedBy: "Robin Q.",
    url: "/fundraise/robins-santa-dash",
    meter: meter({ onlinePence: 6000, cashPence: 0, targetPence: 25000 }),
    wall: [],
    giving: { fundraiserId: 41, minimumPence: 200 },
  };
  const opts = { pageUrl: "https://nbcc.test/fundraise/robins-santa-dash", now: NOW };

  it("puts the option under the give button, the form after the give form, and the pledges after the wall", () => {
    const doc = parse(renderFundraiserPage(template, page, { ...opts, pledge: renderPledgeExtras(input(some)) }));
    expect(doc.querySelector(".fr-summary .fr-summary__give + .fr-summary__pledge")).not.toBeNull();
    expect(doc.querySelector(".fr-main #give + #pledge")).not.toBeNull();
    expect(doc.querySelector(".fr-main .fr-wall + .fr-pledges")).not.toBeNull();
  });

  it("leaves the meter exactly as it was: a pledge never counts", () => {
    const withPledges = parse(renderFundraiserPage(template, page, { ...opts, pledge: renderPledgeExtras(input(some)) }));
    const without = parse(renderFundraiserPage(template, page, opts));
    expect(withPledges.querySelector(".fr-meter")?.outerHTML).toBe(without.querySelector(".fr-meter")?.outerHTML);
    expect(words(withPledges.querySelector(".fr-meter__figures"))).toBe("£60 raised of £250");
  });

  it("changes nothing on a page with no pledge extras", () => {
    const html = renderFundraiserPage(template, page, opts);
    expect(html).not.toContain("Sponsor now, pay after");
    expect(html).not.toContain('id="pledge"');
    expect(html).not.toContain("fr-pledges");
  });

  it("is never on a page in memory of someone, whatever is passed", () => {
    const html = renderMemoryPage(template, { ...page, memory: { name: "Sam Example", dates: null, showTarget: false } }, {
      ...opts,
      pledge: renderPledgeExtras(input(some)),
    });
    expect(html).not.toContain("Sponsor now, pay after");
    expect(html).not.toContain("fr-pledges");
  });
});

describe("the page the pay link opens", () => {
  const data = {
    token: "12.abcdefghijklmnopqrstuvwxyz",
    title: "Robin's Santa Dash",
    organiserFirstName: "Robin",
    sponsorFirstName: "Alex",
    amountPence: 1000,
    giftAid: true,
    declaredOn: "1 November 2026",
    pageUrl: "/fundraise/robins-santa-dash",
  };
  const doc = parse(renderPayPage(pledgeTemplate, data));

  it("is a plain form that works without JavaScript, posting the token, never showing it", () => {
    const form = doc.querySelector("form.pl-pay");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("action")).toBe("/pledge/pay");
    expect(form?.querySelector('input[type=hidden][name="t"]')?.getAttribute("value")).toBe(data.token);
    expect(words(doc.querySelector("main"))).not.toContain(data.token);
  });

  it("names the fundraiser and fills in the amount, which they may raise, never lower", () => {
    expect(words(doc.querySelector("h1"))).toBe("Pay your pledge");
    expect(words(doc.querySelector(".lede"))).toBe("Thank you, Alex. You pledged £10 to sponsor Robin for Robin's Santa Dash.");
    const amount = doc.querySelector("input#plPayAmount");
    expect(amount?.getAttribute("value")).toBe("10");
    expect(amount?.getAttribute("min")).toBe("10");
    expect(amount?.getAttribute("name")).toBe("amount");
    expect(words(doc.querySelector('label[for="plPayAmount"]'))).toBe("The amount to pay. You can give more if you would like to.");
  });

  it("shows pence when the pledge has them", () => {
    const odd = parse(renderPayPage(pledgeTemplate, { ...data, amountPence: 1250 })).querySelector("#plPayAmount");
    expect(odd?.getAttribute("value")).toBe("12.50");
    expect(odd?.getAttribute("min")).toBe("12.50");
  });

  it("keeps Gift Aid on, ticked, saying when it was declared, and lets them take it off", () => {
    const box = doc.querySelector('input[type=checkbox][name="giftAid"]');
    expect(box?.hasAttribute("checked")).toBe(true);
    expect(words(doc.querySelector(".pl-pay__giftaid strong"))).toBe("Keep Gift Aid on my donation. I am Alex and this is my own money. I am still a UK taxpayer.");
    expect(words(doc.querySelector(".pl-pay__giftaid"))).toContain("You made your Gift Aid declaration with your pledge on 1 November 2026.");
    expect(words(doc.querySelector(".pl-pay__giftaid"))).toContain("it is my responsibility to pay any difference");
  });

  it("without a name it can safely say, still asks that it is the sponsor's own money", () => {
    const anon = parse(renderPayPage(pledgeTemplate, { ...data, sponsorFirstName: null }));
    expect(words(anon.querySelector(".pl-pay__giftaid strong"))).toBe(
      "Keep Gift Aid on my donation. I am the person who made this pledge and this is my own money. I am still a UK taxpayer.",
    );
    expect(words(anon.querySelector(".pl-pay__giftaid"))).toContain("If someone else is paying, please untick this.");
  });

  it("has no Gift Aid box at all when none was declared", () => {
    expect(parse(renderPayPage(pledgeTemplate, { ...data, giftAid: false })).querySelector('[name="giftAid"]')).toBeNull();
  });

  it("offers to cover the card fee, and goes to Stripe", () => {
    expect(doc.querySelector('input[type=checkbox][name="coverFee"]')).not.toBeNull();
    expect(words(doc.querySelector("button[type=submit]"))).toBe("Pay now");
    expect(words(doc.querySelector(".give-pay-note"))).toBe("Secure payment by Stripe. Card or Apple Pay.");
  });

  it("links to saying they cannot pay after all", () => {
    expect(doc.querySelector('a[href="/pledge/cancel?t=12.abcdefghijklmnopqrstuvwxyz"]')).not.toBeNull();
  });

  it("is never indexed", () => {
    expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
  });

  it("says what went wrong above the form when the amount was refused", () => {
    const bad = parse(renderPayPage(pledgeTemplate, { ...data, error: "You pledged £10, so that is the least you can pay here." }));
    expect(words(bad.querySelector('[role="alert"]'))).toBe("You pledged £10, so that is the least you can pay here.");
  });
});

describe("the page the can't pay link opens", () => {
  const data = { token: "12.abcdefghijklmnopqrstuvwxyz", title: "Robin's Santa Dash", organiserFirstName: "Robin", amountPence: 1000 };

  it("asks first, with a button: a link in an email never cancels by itself", () => {
    const doc = parse(renderCancelPage(pledgeTemplate, data));
    const form = doc.querySelector("form.pl-cancel");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("action")).toBe("/pledge/cancel");
    expect(form?.querySelector('input[name="t"]')?.getAttribute("value")).toBe(data.token);
    expect(words(doc.querySelector("h1"))).toBe("Can't pay your pledge after all?");
    expect(words(form?.querySelector("button"))).toBe("Cancel my £10 pledge");
    expect(doc.querySelector('a[href="/pledge/pay?t=12.abcdefghijklmnopqrstuvwxyz"]')).not.toBeNull();
    // Never an offer to pay less than was pledged.
    expect(words(doc.querySelector("main"))).not.toMatch(/smaller|less/i);
  });
});

describe("the page the confirm link opens", () => {
  const data = { token: "12.abcdefghijklmnopqrstuvwxyz", title: "Robin's Santa Dash", organiserFirstName: "Robin", amountPence: 1000 };
  const doc = parse(renderConfirmPage(pledgeTemplate, data));

  it("asks first, with a button: a link opened by a mail scanner never confirms by itself", () => {
    const form = doc.querySelector("form.pl-confirm");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("action")).toBe("/pledge/confirm");
    expect(form?.querySelector('input[name="t"]')?.getAttribute("value")).toBe(data.token);
    expect(words(doc.querySelector("h1"))).toBe("Confirm your pledge");
    expect(words(doc.querySelector(".lede"))).toBe("You pledged £10 to sponsor Robin for Robin's Santa Dash. Press the button to confirm it was you.");
    expect(words(form?.querySelector("button"))).toBe("Confirm my £10 pledge");
  });

  it("says nothing is paid today, and what happens if it was not them", () => {
    const text = words(doc.querySelector("main"));
    expect(text).toContain("There is nothing to pay today. We will email you a link to pay once Robin has finished.");
    expect(text).toContain("Not you? You don't need to do anything. A pledge that isn't confirmed is deleted after 7 days.");
  });
});

describe("a plain notice page", () => {
  it("carries a heading and words, escaped, and an optional way on", () => {
    const doc = parse(renderPledgeNotice(pledgeTemplate, { heading: "Your pledge is cancelled", body: ["That's okay. <Thank you>."], link: { href: "/get-involved", label: "See what's on" } }));
    expect(words(doc.querySelector("h1"))).toBe("Your pledge is cancelled");
    expect(words(doc.querySelector(".pl-notice p"))).toBe("That's okay. <Thank you>.");
    expect(doc.querySelector('.pl-notice a.btn[href="/get-involved"]')).not.toBeNull();
    expect(doc.title).toContain("Your pledge is cancelled");
  });
});
