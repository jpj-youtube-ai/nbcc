import { LINK_DAYS } from "./model";

// Joining the mailing list: the three pages the emailed link opens, drawn on the server into
// newsletter.html (the sign up page itself), so they share its header, footer and styles. What is
// between each pair of markers in that file is swapped for the page's own words.
//
//   renderConfirmPage    asks first, with a button: a link opened by a mail scanner adds nobody.
//   renderThanksPage     after the button is pressed.
//   renderLinkGonePage   the link has expired, been used, or never existed.
//   renderTroublePage    we could not add them just now; the link still works.
//
// None of them shows the email address, and none is ever indexed. Pure: no database, no config.

const region = (name: string): RegExp => new RegExp(`<!-- newsletter:${name} -->[\\s\\S]*?<!-- /newsletter:${name} -->`);

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function page(template: string, title: string, lede: string, body: string): string {
  const intro =
    '<span class="eyebrow">Mailing list</span>' +
    `<h1 id="newsletter-heading">${esc(title)}</h1>` +
    '<div class="rule"><i></i></div>' +
    (lede ? `<p class="lede">${esc(lede)}</p>` : "");
  return template
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(title)} | Night Before Christmas Campaign</title>\n    <meta name="robots" content="noindex, nofollow" />`)
    .replace(region("intro"), () => intro)
    .replace(region("page"), () => body);
}

const notice = (paragraphs: string[], link?: { href: string; label: string }): string =>
  '<div class="card card-lg nl-panel nl-notice">' +
  paragraphs.map((p) => `<p>${esc(p)}</p>`).join("") +
  (link ? `<p class="nl-actions"><a class="btn btn-holly" href="${esc(link.href)}">${esc(link.label)}</a></p>` : "") +
  "</div>";

export function renderConfirmPage(template: string, d: { token: string }): string {
  const body =
    '<form class="nl-confirm" method="post" action="/newsletter/confirm">' +
    `<input type="hidden" name="t" value="${esc(d.token)}" />` +
    '<button class="btn btn-holly" type="submit">Yes, add me</button>' +
    '<p class="form-privacy">We will send you occasional news about the difference your support makes and what is coming up across South West Scotland: a few emails a year. You can unsubscribe at any time.</p>' +
    '<p class="form-privacy">Not you? You don\'t need to do anything, and nothing will happen.</p>' +
    "</form>";
  return page(template, "One more step", "Press the button and we will add you to the NBCC mailing list.", body);
}

export function renderThanksPage(template: string): string {
  return page(
    template,
    "Thank you for joining us",
    "",
    notice(
      [
        "That is everything. We will be in touch a few times a year with news about the difference your support makes and what is coming up.",
        "You can unsubscribe at any time, using the link at the bottom of any email we send you.",
      ],
      { href: "/", label: "Back to the home page" },
    ),
  );
}

export function renderLinkGonePage(template: string): string {
  return page(
    template,
    "This link no longer works",
    "",
    notice([`A link to join our mailing list works once, and for ${LINK_DAYS} days. If you would still like to join, you can start again and we will send you a new one.`], {
      href: "/newsletter",
      label: "Start again",
    }),
  );
}

export function renderTroublePage(template: string): string {
  return page(
    template,
    "Something went wrong",
    "",
    notice(["We could not add you to our mailing list just now. Please go back to the email and press the button again in a few minutes."]),
  );
}
