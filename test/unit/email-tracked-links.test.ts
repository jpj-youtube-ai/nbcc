import { describe, it, expect } from "vitest";
import {
  STAFF_ONLY_KINDS,
  emailLinkTags,
  linkTagsForKind,
  newsletterLinkTags,
  ownSiteHosts,
  tagUrl,
  tagLinksInHtml,
  tagLinksInText,
} from "../../src/email/tracked-links";

// TASK-480: links to our own site in emails gain utm words, so the site analytics can tell a
// visit from a newsletter or an email apart from someone typing the address. Every address,
// token and id here is invented.

const HOSTS = ownSiteHosts(["https://nbcc.scot", "http://localhost:3000"]);
const NEWS = newsletterLinkTags(42);
const BALL = emailLinkTags("ballConfirmation");
const NEWS_QS = "utm_source=newsletter&utm_medium=email&utm_campaign=42";
const BALL_QS = "utm_source=email&utm_medium=email&utm_campaign=ballConfirmation";

describe("the words each kind of email adds", () => {
  it("names a newsletter by its id", () => {
    expect(newsletterLinkTags(42)).toEqual({ source: "newsletter", medium: "email", campaign: "42" });
  });

  it("names any other email by its kind", () => {
    expect(emailLinkTags("receipt")).toEqual({ source: "email", medium: "email", campaign: "receipt" });
  });
});

describe("which hosts count as our own site", () => {
  it("always includes nbcc.scot and www.nbcc.scot", () => {
    const hosts = ownSiteHosts([]);
    expect(hosts.has("nbcc.scot")).toBe(true);
    expect(hosts.has("www.nbcc.scot")).toBe(true);
  });

  it("adds the host of each configured site address, port and all", () => {
    expect(HOSTS.has("localhost:3000")).toBe(true);
  });

  it("ignores a missing or broken configured address", () => {
    expect(() => ownSiteHosts([undefined, "", "not a url"])).not.toThrow();
  });

  it("never counts the newsletter sending subdomain or its click tracker, even if configured", () => {
    const hosts = ownSiteHosts(["https://news.nbcc.scot", "https://click.news.nbcc.scot"]);
    expect(hosts.has("news.nbcc.scot")).toBe(false);
    expect(hosts.has("click.news.nbcc.scot")).toBe(false);
  });
});

describe("tagging one address", () => {
  it("adds the words to a link to our site", () => {
    expect(tagUrl("https://nbcc.scot/events", NEWS, HOSTS)).toBe(`https://nbcc.scot/events?${NEWS_QS}`);
  });

  it("adds them to the www host and to the bare home page", () => {
    expect(tagUrl("https://www.nbcc.scot", BALL, HOSTS)).toBe(`https://www.nbcc.scot?${BALL_QS}`);
    expect(tagUrl("https://nbcc.scot/", BALL, HOSTS)).toBe(`https://nbcc.scot/?${BALL_QS}`);
  });

  it("matches the host whatever its case", () => {
    expect(tagUrl("https://NBCC.scot/donate", BALL, HOSTS)).toBe(`https://NBCC.scot/donate?${BALL_QS}`);
  });

  it("adds them to the configured site address", () => {
    expect(tagUrl("http://localhost:3000/ball", BALL, HOSTS)).toBe(`http://localhost:3000/ball?${BALL_QS}`);
  });

  it("keeps an existing query string and puts the words after it", () => {
    expect(tagUrl("https://nbcc.scot/events?month=december", NEWS, HOSTS)).toBe(
      `https://nbcc.scot/events?month=december&${NEWS_QS}`,
    );
  });

  it("keeps a #fragment at the end, after the words", () => {
    expect(tagUrl("https://nbcc.scot/ball#tables", NEWS, HOSTS)).toBe(`https://nbcc.scot/ball?${NEWS_QS}#tables`);
    expect(tagUrl("https://nbcc.scot/ball?x=1#tables", NEWS, HOSTS)).toBe(
      `https://nbcc.scot/ball?x=1&${NEWS_QS}#tables`,
    );
  });

  it("does not leave a stray separator after an empty query", () => {
    expect(tagUrl("https://nbcc.scot/ball?", NEWS, HOSTS)).toBe(`https://nbcc.scot/ball?${NEWS_QS}`);
    expect(tagUrl("https://nbcc.scot/ball?x=1&", NEWS, HOSTS)).toBe(`https://nbcc.scot/ball?x=1&${NEWS_QS}`);
  });

  it("encodes a campaign that has unusual characters in it", () => {
    const odd = emailLinkTags("a b&c");
    expect(tagUrl("https://nbcc.scot/", odd, HOSTS)).toBe(
      "https://nbcc.scot/?utm_source=email&utm_medium=email&utm_campaign=a%20b%26c",
    );
  });

  it("leaves a link that already has any utm word exactly as it is", () => {
    const own = "https://nbcc.scot/donate?utm_campaign=christmas";
    expect(tagUrl(own, NEWS, HOSTS)).toBe(own);
    const upper = "https://nbcc.scot/donate?UTM_Source=poster";
    expect(tagUrl(upper, NEWS, HOSTS)).toBe(upper);
  });

  it("leaves other websites alone", () => {
    for (const url of [
      "https://example.org/page",
      "https://news.nbcc.scot/anything",
      "https://click.news.nbcc.scot/CL0/https:%2F%2Fnbcc.scot",
      "https://nbcc.scot.example.com/trick",
      "https://notnbcc.scot/",
      "https://checkout.stripe.com/pay/cs_test_invented",
    ]) {
      expect(tagUrl(url, NEWS, HOSTS)).toBe(url);
    }
  });

  it("leaves mail, phone, anchor and relative links alone", () => {
    for (const url of ["mailto:hello@nbcc.scot", "tel:+441234567890", "#top", "/donate", "donate.html", ""]) {
      expect(tagUrl(url, NEWS, HOSTS)).toBe(url);
    }
  });

  it("leaves unsubscribe, preferences and portal links alone", () => {
    for (const url of [
      "https://nbcc.scot/unsubscribe/preview",
      "https://nbcc.scot/unsubscribe/abc",
      "https://nbcc.scot/preferences/abc",
      "https://nbcc.scot/portal/access",
      "https://nbcc.scot/portal",
    ]) {
      expect(tagUrl(url, NEWS, HOSTS)).toBe(url);
    }
  });

  it("leaves personal pages alone: letters, guest details, certificates, set password, admin", () => {
    for (const url of [
      "https://nbcc.scot/thank-you/letter/abc",
      "https://nbcc.scot/ball/guests/abc",
      "https://nbcc.scot/business/certificate/abc",
      "https://nbcc.scot/business/thank-you",
      "https://nbcc.scot/gift-aid/declare",
      "https://nbcc.scot/g/abc",
      "https://nbcc.scot/admin/set-password",
      "https://nbcc.scot/admin",
      "https://nbcc.scot/api/anything",
    ]) {
      expect(tagUrl(url, NEWS, HOSTS)).toBe(url);
    }
  });

  it("leaves hosted files and images alone, where no page could count the visit", () => {
    expect(tagUrl("https://nbcc.scot/assets/booklet.pdf", NEWS, HOSTS)).toBe("https://nbcc.scot/assets/booklet.pdf");
    expect(tagUrl("https://nbcc.scot/media/newsletter/7", NEWS, HOSTS)).toBe("https://nbcc.scot/media/newsletter/7");
  });

  it("leaves any link carrying a token style query parameter alone", () => {
    for (const name of ["token", "t", "key", "code", "sig", "signature", "session_id", "otp", "auth"]) {
      const url = `https://nbcc.scot/somewhere?${name}=abc`;
      expect(tagUrl(url, NEWS, HOSTS)).toBe(url);
    }
    const mixed = "https://nbcc.scot/somewhere?page=2&TOKEN=abc";
    expect(tagUrl(mixed, NEWS, HOSTS)).toBe(mixed);
  });

  it("leaves a link alone when a query value looks like a long random string", () => {
    const url = "https://nbcc.scot/somewhere?ref=Zq8xT2mV9kLp4RwN7bYc";
    expect(tagUrl(url, NEWS, HOSTS)).toBe(url);
  });

  it("leaves a link alone when a path part looks like a token", () => {
    for (const url of [
      "https://nbcc.scot/somewhere/Zq8xT2mV9kLp4RwN7bYc3dFg",
      "https://nbcc.scot/newsletter/document/3f2b8c1e-9a4d-4e7b-8c2f-1a2b3c4d5e6f",
      "https://nbcc.scot/x/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.c2lnbmF0dXJl",
      "https://nbcc.scot/x/123456789012345",
    ]) {
      expect(tagUrl(url, NEWS, HOSTS)).toBe(url);
    }
  });

  it("still tags ordinary readable addresses with numbers in them", () => {
    expect(tagUrl("https://nbcc.scot/festive-ball-2026", NEWS, HOSTS)).toBe(
      `https://nbcc.scot/festive-ball-2026?${NEWS_QS}`,
    );
    expect(tagUrl("https://nbcc.scot/stories/fundraising-walk-2025.html", NEWS, HOSTS)).toBe(
      `https://nbcc.scot/stories/fundraising-walk-2025.html?${NEWS_QS}`,
    );
  });

  it("changes nothing more when run a second time", () => {
    const once = tagUrl("https://nbcc.scot/events?month=may#top", NEWS, HOSTS);
    expect(tagUrl(once, NEWS, HOSTS)).toBe(once);
    expect(tagUrl(once, BALL, HOSTS)).toBe(once);
  });
});

describe("tagging links in an email's html", () => {
  it("rewrites the href of a link to our site and nothing else in the tag", () => {
    const html = '<p><a href="https://nbcc.scot/donate" style="color:#7a1f2b">Donate</a></p>';
    expect(tagLinksInHtml(html, NEWS, HOSTS)).toBe(
      `<p><a href="https://nbcc.scot/donate?${NEWS_QS.replace(/&/g, "&amp;")}" style="color:#7a1f2b">Donate</a></p>`,
    );
  });

  it("writes the separator as &amp; and does not double encode one already there", () => {
    const html = '<a href="https://nbcc.scot/events?month=may&amp;year=2026">Events</a>';
    expect(tagLinksInHtml(html, NEWS, HOSTS)).toBe(
      '<a href="https://nbcc.scot/events?month=may&amp;year=2026&amp;utm_source=newsletter&amp;utm_medium=email&amp;utm_campaign=42">Events</a>',
    );
  });

  it("reads an encoded token parameter through its &amp; and leaves that link alone", () => {
    const html = '<a href="https://nbcc.scot/somewhere?page=2&amp;token=abc">Go</a>';
    expect(tagLinksInHtml(html, NEWS, HOSTS)).toBe(html);
  });

  it("reads an encoded utm word through &#38; and leaves that link alone", () => {
    const html = '<a href="https://nbcc.scot/x?a=1&#38;utm_source=poster">Go</a>';
    expect(tagLinksInHtml(html, NEWS, HOSTS)).toBe(html);
  });

  it("handles single quoted and upper case href attributes", () => {
    expect(tagLinksInHtml("<a HREF='https://nbcc.scot/ball'>Ball</a>", BALL, HOSTS)).toBe(
      `<a HREF='https://nbcc.scot/ball?${BALL_QS.replace(/&/g, "&amp;")}'>Ball</a>`,
    );
  });

  it("keeps the fragment after the words", () => {
    expect(tagLinksInHtml('<a href="https://nbcc.scot/ball#tables">x</a>', BALL, HOSTS)).toBe(
      `<a href="https://nbcc.scot/ball?${BALL_QS.replace(/&/g, "&amp;")}#tables">x</a>`,
    );
  });

  it("leaves images, other hosts, unsubscribe and mail links untouched", () => {
    const html = [
      '<img src="https://nbcc.scot/media/newsletter/7" alt="">',
      '<a href="https://example.org/">Friends</a>',
      '<a href="https://nbcc.scot/unsubscribe/abc">Unsubscribe</a>',
      '<a href="mailto:hello@nbcc.scot">Email us</a>',
      '<a href="tel:+441234567890">Call</a>',
      '<a href="#top">Top</a>',
      '<a data-href="https://nbcc.scot/x">Not a link</a>',
    ].join("\n");
    expect(tagLinksInHtml(html, NEWS, HOSTS)).toBe(html);
  });

  it("leaves text that merely mentions our address alone", () => {
    const html = "<p>Visit https://nbcc.scot/ball for tickets</p>";
    expect(tagLinksInHtml(html, NEWS, HOSTS)).toBe(html);
  });

  it("tags every link to our site in a longer email", () => {
    const html = '<a href="https://nbcc.scot/a">A</a> and <a href="https://www.nbcc.scot/b">B</a>';
    const out = tagLinksInHtml(html, NEWS, HOSTS);
    expect(out.match(/utm_campaign=42/g)?.length).toBe(2);
  });

  it("changes nothing more when run a second time", () => {
    const html = '<a href="https://nbcc.scot/events?month=may&amp;year=2026#top">Events</a>';
    const once = tagLinksInHtml(html, NEWS, HOSTS);
    expect(once).not.toBe(html);
    expect(tagLinksInHtml(once, NEWS, HOSTS)).toBe(once);
  });
});

describe("tagging links in an email's plain text", () => {
  it("tags a bare address to our site", () => {
    expect(tagLinksInText("Book here: https://nbcc.scot/ball", BALL, HOSTS)).toBe(
      `Book here: https://nbcc.scot/ball?${BALL_QS}`,
    );
  });

  it("tags the address the plain text part prints in brackets after a label", () => {
    expect(tagLinksInText("Donate now (https://nbcc.scot/donate)", NEWS, HOSTS)).toBe(
      `Donate now (https://nbcc.scot/donate?${NEWS_QS})`,
    );
  });

  it("does not swallow a full stop or comma after the address", () => {
    expect(tagLinksInText("See https://nbcc.scot/events. Or https://nbcc.scot/ball, soon", NEWS, HOSTS)).toBe(
      `See https://nbcc.scot/events?${NEWS_QS}. Or https://nbcc.scot/ball?${NEWS_QS}, soon`,
    );
  });

  it("keeps a plain & in text rather than writing &amp;", () => {
    expect(tagLinksInText("https://nbcc.scot/events?month=may&year=2026", NEWS, HOSTS)).toBe(
      `https://nbcc.scot/events?month=may&year=2026&${NEWS_QS}`,
    );
  });

  it("leaves other hosts, tokens and unsubscribe addresses untouched", () => {
    const text = [
      "https://example.org/page",
      "https://nbcc.scot/unsubscribe/abc",
      "https://nbcc.scot/portal/access?token=abc",
      "hello@nbcc.scot",
      "nbcc.scot on its own",
    ].join("\n");
    expect(tagLinksInText(text, NEWS, HOSTS)).toBe(text);
  });

  it("changes nothing more when run a second time", () => {
    const once = tagLinksInText("Go to https://nbcc.scot/ball#tables now", NEWS, HOSTS);
    expect(tagLinksInText(once, NEWS, HOSTS)).toBe(once);
  });
});

describe("staff only emails are never tagged", () => {
  it("lists every kind that only ever goes to staff", () => {
    expect([...STAFF_ONLY_KINDS].sort()).toEqual(
      // TASK-487: ballTransferStaff, the events@ email for each new bank transfer booking.
      // TASK-493: fundraiseStaff, the events@ summary of each new fundraising sign up.
      ["adminInvite", "adminReset", "backupAlert", "ballReport", "ballTransferStaff", "fundraiseStaff", "lapsedAdmin", "loginCode"].sort(),
    );
  });

  it("gives staff only kinds no words, so staff clicks never count as Email visits", () => {
    for (const kind of STAFF_ONLY_KINDS) expect(linkTagsForKind(kind)).toBeNull();
  });

  it("gives every other kind its own words", () => {
    for (const kind of ["donation", "receipt", "ballConfirmation", "ballReminder", "portal", "outreach"]) {
      expect(linkTagsForKind(kind)).toEqual(emailLinkTags(kind));
    }
  });
});

describe("html with untidy or unusual href values", () => {
  const Q = NEWS_QS.replace(/&/g, "&amp;");

  it("writes out the trimmed address when it tags one with spaces around it", () => {
    expect(tagLinksInHtml('<a href=" https://nbcc.scot/ball ">x</a>', NEWS, HOSTS)).toBe(
      `<a href="https://nbcc.scot/ball?${Q}">x</a>`,
    );
  });

  it("trims a newline inside the attribute too", () => {
    expect(tagLinksInHtml('<a href="\n  https://nbcc.scot/ball#tables\n">x</a>', NEWS, HOSTS)).toBe(
      `<a href="https://nbcc.scot/ball?${Q}#tables">x</a>`,
    );
  });

  it("leaves a link it does not tag exactly as it was, spaces and all", () => {
    const html = '<a href=" https://example.org/ ">x</a>';
    expect(tagLinksInHtml(html, NEWS, HOSTS)).toBe(html);
  });

  it("does not throw on a character reference beyond the last code point", () => {
    const html = '<a href="https://nbcc.scot/ball?x=&#1114112;">x</a> <a href="https://nbcc.scot/events">y</a>';
    expect(() => tagLinksInHtml(html, NEWS, HOSTS)).not.toThrow();
    expect(tagLinksInHtml(html, NEWS, HOSTS)).toContain(`https://nbcc.scot/events?${Q}`);
  });
});
