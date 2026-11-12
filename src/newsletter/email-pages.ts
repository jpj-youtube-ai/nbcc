import { siteFooter, siteHeader } from "../site/chrome";
import { confirmPrompt, type UnsubscribeScope } from "./unsubscribe-copy";
import type { OfferableList, PreferenceView } from "./preferences";

// The pages a newsletter's links open: unsubscribing (src/routes/unsubscribe.ts) and choosing which
// emails to have (src/routes/preferences.ts). Pure renders; the routes do the checking and the writing,
// exactly as before.
//
// TASK-615 (Jaimie, 11 November 2026: "every page should have the same banner and the same nav bar
// across the entire site"): they wear the site's banner, menu and footer (src/site/chrome.ts), load the
// site's stylesheet and script, and their routes send them through dressPage like every page. What they
// say and the forms in them are as they were. Their own look, the NBCC palette the two have always
// shared so they read as one thing, now styles only the page itself (.email-page): the old rules for
// the whole body, the page's width and background, and every button, link and box on it, would have
// restyled the site's banner and footer too.

const esc = (s: string): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** The two pages' shared look, for the page itself only. Their forms are not cards: the site's
 *  stylesheet draws every form as one (styles.css form{}), which here would box the buttons inside the
 *  card, so they are reset to the plain form they always were. */
const SHARED_LOOK =
  ".email-page .wrap{max-width:36rem}" +
  ".email-page form{background:none;border:0;border-radius:0;padding:0;box-shadow:none}" +
  ".email-page{color:#2B2723;line-height:1.6}" +
  ".email-page h1{font-size:1.5rem;margin:0 0 .5rem;color:#800000}" +
  ".email-page .card{background:#FFFDFA;border:1px solid #E2D6C4;border-radius:14px;padding:1.25rem;margin:1.25rem 0;box-shadow:none}" +
  ".email-page .muted{color:#6B655E;font-size:.9rem}";

const UNSUBSCRIBE_LOOK =
  SHARED_LOOK +
  ".email-page button{font:inherit;font-weight:600;border-radius:8px;padding:.7rem 1.2rem;cursor:pointer;border:1.4px solid #A8182C;background:#A8182C;color:#FFFDFA}" +
  ".email-page .row{display:flex;gap:.9rem;flex-wrap:wrap;margin-top:1rem;align-items:center}" +
  ".email-page a{color:#800000}";

const PREFERENCES_LOOK =
  SHARED_LOOK +
  ".email-page label{display:flex;gap:.7rem;align-items:flex-start;padding:.7rem 0;border-bottom:1px solid #EDE4D5}" +
  ".email-page label:last-of-type{border-bottom:0}" +
  ".email-page input[type=checkbox]{width:18px;height:18px;margin-top:.2rem;accent-color:#800000;flex:none}" +
  ".email-page b{display:block}" +
  ".email-page button{font:inherit;font-weight:600;border-radius:8px;padding:.6rem 1.1rem;cursor:pointer;border:1.4px solid #E2D6C4;background:#F8F4EB;color:#2B2723}" +
  ".email-page .save{background:#A8182C;border-color:#A8182C;color:#FFFDFA}" +
  ".email-page .row{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1rem;align-items:center}" +
  ".email-page .all{background:none;border:0;color:#800000;text-decoration:underline;padding:.6rem 0}";

/** A whole page: the site's banner and footer round `body`. */
function emailPage(o: { title: string; noindex: boolean; look: string; label: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />${o.noindex ? '\n<meta name="robots" content="noindex" />' : ""}
<title>${o.title}</title>
<link rel="stylesheet" href="/assets/css/styles.css" />
<style>${o.look}</style>
<script defer src="/assets/js/main.js"></script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
${siteHeader()}
<main class="site-main" id="main" tabindex="-1">
<section class="page-top email-page" aria-label="${o.label}">
<div class="wrap">
${o.body}
</div>
</section>
</main>
${siteFooter()}
</body>
</html>`;
}

const unsubscribePage = (body: string): string =>
  emailPage({ title: "Newsletter | Night Before Christmas Campaign", noindex: true, look: UNSUBSCRIBE_LOOK, label: "Your newsletter emails", body });

const preferencesShell = (body: string): string =>
  emailPage({ title: "Your emails | Night Before Christmas Campaign", noindex: false, look: PREFERENCES_LOOK, label: "Your emails", body });

// TASK-291: every page offers the preference centre. On the confirmation that is what you can do
// NEXT; on the ask it is the gentler alternative to leaving altogether — never a gate in front of it.
function manageLink(token: string, label: string): string {
  return `<p><a href="/preferences/${encodeURIComponent(token)}">${label}</a></p>`;
}

/** The unsubscribe link's answer: `message`, and the way to the email choices when `token` is given. */
export function unsubscribeMessagePage(message: string, token?: string): string {
  const manage = token ? manageLink(token, "Choose which emails you get — you can keep some and stop others.") : "";
  return unsubscribePage(`<h1>Newsletter</h1><div class="card"><p>${message}</p>${manage}</div>`);
}

/** The unsubscribe link's question (TASK-297: the link asks, and only the button acts). */
export function unsubscribeConfirmPage(token: string, scope: UnsubscribeScope): string {
  return unsubscribePage(
    `<h1>Unsubscribe</h1>
<div class="card">
  <p>${confirmPrompt(scope)}</p>
  <form method="post" action="/unsubscribe/${esc(token)}" class="row">
    <button type="submit">Yes, unsubscribe me</button>
    <a href="https://nbcc.scot">No, keep my emails</a>
  </form>
</div>
${manageLink(token, "Or choose which emails you get — you can keep some and stop others.")}
<p class="muted">We ask because security software at some workplaces opens every link in an email
automatically. Without this step it could unsubscribe you without you ever clicking.</p>`,
  );
}

/** The email choices link's answer when its link is not valid. */
export function preferencesInvalidPage(): string {
  return preferencesShell("<h1>Your emails</h1><p>This link is not valid.</p>");
}

/** The email choices page: what this address is on, what it may join, and whether it was just saved. */
export function preferencesPage(view: PreferenceView, offers: OfferableList[], token: string, saved: boolean): string {
  const nothingLeft = view.lists.length === 0 && !view.donor && offers.length === 0;
  if (nothingLeft) {
    return preferencesShell(
      `<h1>Your emails</h1><div class="card"><p>We are not sending anything to
       <b>${esc(view.email)}</b>. Nothing more to turn off.</p></div>`,
    );
  }
  const listRows = view.lists
    .map(
      (l) =>
        `<label><input type="checkbox" name="keep" value="${l.listId}" checked>
         <span><b>${esc(l.listName)}</b><span class="muted">Emails for this group only.</span></span></label>`,
    )
    .join("");
  const donorRows = view.donor
    ? `<label><input type="checkbox" name="newsletter"${view.donor.newsletter ? " checked" : ""}>
       <span><b>Newsletter</b><span class="muted">A few updates a year about the campaign.</span></span></label>
       <label><input type="checkbox" name="thankyou"${view.donor.thankYou ? " checked" : ""}>
       <span><b>Thank-you letters</b><span class="muted">A personal thank you when you give.</span></span></label>`
    : "";
  return preferencesShell(
    `<h1>Your emails</h1>
     <p class="muted">For <b>${esc(view.email)}</b>. Tick what you would like to keep.</p>
     ${saved ? '<div class="card"><b>Saved.</b> Your choices are in effect now.</div>' : ""}
     <form method="post" action="/preferences/${encodeURIComponent(token)}">
       <div class="card">${donorRows}${listRows}</div>
       <div class="row">
         <button type="submit" class="save">Save my choices</button>
         <button type="submit" name="all" value="off" class="all">Or stop all emails</button>
       </div>
       ${
         offers.length
           ? `<h2 style="font-size:1.05rem;margin:1.5rem 0 .25rem">Would you like anything else?</h2>
              <p class="muted">Only if you want it — nothing here is on unless you tick it.</p>
              <div class="card">${offers
                .map(
                  (o) =>
                    `<label><input type="checkbox" name="join" value="${o.id}">
                     <span><b>${esc(o.name)}</b></span></label>`,
                )
                .join("")}</div>`
           : ""
       }
     </form>
     <p class="muted">Donation receipts still come through whatever you choose — those are records of
     your gift, not marketing.</p>`,
  );
}
