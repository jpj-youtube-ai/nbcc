import { SINGLE_DONATION_WORDING } from "../../declarations/wording";
import { FORM_ROWS } from "../join";
import { elfPage, escapeHtml } from "./shell";
import type { JoinView } from "./types";

// NBCC Elf Detective School: the page where a grown up enrols their detectives and pays what they
// can (wave 1 plan, Task 4). It works without a script: the form posts to /api/elf/join, which
// sends the browser on to Stripe. assets/js/elf-join.js only makes it nicer: it hides the empty
// detective rows behind "Add another detective", spins a surname, and keeps the amounts in step.
//
// A detective is a first name and a festive surname from the list. There is no field for a real
// surname, a school or an age, by design. The only last name on the page is the grown up's own,
// for Gift Aid, and only for a gift: the entry is a payment to take part and is never Gift Aided.
//
// Unit tested in test/unit/elf-page-join.test.ts and test/unit/elf-pages-house-rules.test.ts.

function pounds(p: number): string {
  return p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2);
}

export function renderJoinPage(view: JoinView): string {
  const v = view.values ?? {};
  const value = (name: string, fallback = "") => ` value="${escapeHtml(v[name] ?? fallback)}"`;
  const { entryFromPence, entrySuggestedPence } = view.settings;

  const errors = view.errors?.length
    ? `<div class="elf-join-errors" role="alert"><h2 class="h-sm">Please check these</h2><ul>${view.errors
        .map((e) => `<li>${escapeHtml(e)}</li>`)
        .join("")}</ul></div>`
    : "";

  const surnameOptions = (chosen: string) =>
    view.surnames
      .map((s) => `<option value="${escapeHtml(s)}"${s === chosen ? " selected" : ""}>${escapeHtml(s)}</option>`)
      .join("");

  const rows = Array.from({ length: FORM_ROWS }, (_, i) => {
    const n = i + 1;
    const first = `detective-${n}-first`;
    const surname = `detective-${n}-surname`;
    const extra = n > 1 && !(v[first] ?? "") ? " elf-join-detective--extra" : "";
    return (
      `<div class="elf-join-detective${extra}" data-row="${n}">` +
      `<p class="elf-join-detective__n">Detective ${n}</p>` +
      `<div class="elf-field"><label for="${first}">First name</label>` +
      `<input id="${first}" name="${first}" type="text" maxlength="20" autocomplete="off"${n === 1 ? " required" : ""}${value(first)} /></div>` +
      `<div class="elf-field"><label for="${surname}">Festive surname</label>` +
      `<select id="${surname}" name="${surname}">${surnameOptions(v[surname] ?? view.surnames[(n - 1) % view.surnames.length] ?? "")}</select></div>` +
      `</div>`
    );
  }).join("");

  const captcha = view.captchaSiteKey
    ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(view.captchaSiteKey)}"></div>`
    : "";

  const main = `
  <section class="section page-top elf-join-top" aria-labelledby="elf-join-heading">
    <div class="wrap">
      <h1 id="elf-join-heading" class="h-xl">${view.signedIn ? "Add a detective" : "Enrol your detectives"}</h1>
      <p class="lede">${
        view.signedIn
          ? "Add another detective to your family. They pick a festive surname too, so online they are only ever Detective Ruby Tinselfoot, never their real name."
          : "One grown up enrols the whole family. Each detective picks a festive surname, so online they are only ever Detective Ruby Tinselfoot, never their real name."
      }</p>
    </div>
  </section>

  <section class="section elf-join-body" aria-label="The enrol form">
    <div class="wrap">
      ${errors}
      <form class="elf-join-form" method="post" action="/api/elf/join" data-api="/api/elf/join" data-suggested-pence="${entrySuggestedPence}" novalidate>
        ${
          view.signedIn
            ? `<div class="elf-join-you"><p>Enrolling for <b>${escapeHtml(view.signedIn.grownUpName)}</b> (${escapeHtml(view.signedIn.email)}). Your welcome email for them goes there too.</p></div>`
            : `<fieldset class="elf-join-you">
          <legend class="h-md">You, the grown up</legend>
          <div class="elf-field"><label for="elf-grown-up">Your name</label>
          <input id="elf-grown-up" name="grownUpName" type="text" maxlength="80" autocomplete="name" required${value("grownUpName")} /></div>
          <div class="elf-field"><label for="elf-email">Your email</label>
          <input id="elf-email" name="email" type="email" maxlength="200" autocomplete="email" required${value("email")} /></div>
        </fieldset>`
        }

        <fieldset class="elf-join-detectives">
          <legend class="h-md">Your detectives</legend>
          <p class="elf-hint">Just a first name for each. Never a real surname, school or age.</p>
          ${rows}
        </fieldset>

        <div class="elf-join-pay">
          <h2 class="h-md">Pay what you can</h2>
          <p>We suggest £${pounds(entrySuggestedPence)} for each detective. Any amount from £${pounds(entryFromPence)} for each detective is welcome.</p>
          <div class="elf-field"><label for="elf-entry">The entry, in pounds</label>
          <input id="elf-entry" name="entry" type="text" inputmode="decimal" maxlength="9" required${value("entry", pounds(entrySuggestedPence))} /></div>
        </div>

        <div class="elf-join-gift">
          <h2 class="h-md">Add a gift, if you like</h2>
          <p>A gift could help a child wake up to a Red Bag Full of Joy on Christmas morning.</p>
          <div class="elf-field"><label for="elf-donation">A gift to NBCC, in pounds</label>
          <input id="elf-donation" name="donation" type="text" inputmode="decimal" maxlength="9"${value("donation")} /></div>
          <p class="elf-tick"><input id="elf-gift-aid" name="giftAid" type="checkbox" /><label for="elf-gift-aid">Add Gift Aid to my gift</label></p>
          <p class="elf-hint">Gift Aid can go on your gift, but never on the entry.</p>
          <fieldset class="elf-join-declaration">
            <legend>Your Gift Aid declaration</legend>
            <p class="elf-declaration-words">${escapeHtml(SINGLE_DONATION_WORDING.wording_snapshot)}</p>
            <div class="elf-field"><label for="decl-firstName">First name</label><input id="decl-firstName" name="decl-firstName" type="text" maxlength="60" autocomplete="given-name"${value("decl-firstName")} /></div>
            <div class="elf-field"><label for="decl-lastName">Last name</label><input id="decl-lastName" name="decl-lastName" type="text" maxlength="60" autocomplete="family-name"${value("decl-lastName")} /></div>
            <div class="elf-field"><label for="decl-houseNameNumber">House name or number</label><input id="decl-houseNameNumber" name="decl-houseNameNumber" type="text" maxlength="60"${value("decl-houseNameNumber")} /></div>
            <div class="elf-field"><label for="decl-address">The rest of your home address</label><input id="decl-address" name="decl-address" type="text" maxlength="200" autocomplete="street-address"${value("decl-address")} /></div>
            <div class="elf-field"><label for="decl-postcode">Postcode</label><input id="decl-postcode" name="decl-postcode" type="text" maxlength="10" autocomplete="postal-code"${value("decl-postcode")} /></div>
            <p class="elf-tick"><input id="decl-nonUk" name="decl-nonUk" type="checkbox" /><label for="decl-nonUk">My home is outside the UK</label></p>
          </fieldset>
        </div>

        <div class="elf-join-last">
          <p class="elf-tick"><input id="elf-cover-fee" name="coverFee" type="checkbox" /><label for="elf-cover-fee">Cover the card fee, so all of it reaches NBCC</label></p>
          <p class="elf-tick"><input id="elf-newsletter" name="newsletter" type="checkbox" /><label for="elf-newsletter">Send me NBCC's newsletter now and then</label></p>
          <p class="elf-tick"><input id="elf-agreed" name="agreed" type="checkbox" required /><label for="elf-agreed">I have read <a href="/elf/rules">the rules</a> and agree to them</label></p>
          <div class="elf-trap" aria-hidden="true"><label for="elf-website">Leave this empty</label><input id="elf-website" name="website" type="text" tabindex="-1" autocomplete="off" /></div>
          ${captcha}
          <p><button class="btn btn-primary" type="submit">Go to payment</button></p>
          <p class="elf-hint">You pay securely by card with Stripe. You come straight back here afterwards.</p>
        </div>
      </form>
    </div>
  </section>`;

  return elfPage({
    title: "Enrol your detectives",
    description: "Enrol your detectives in NBCC Elf Detective School and pay what you can.",
    cta: { href: "/elf/sign-in", label: "Sign in" },
    home: "/elf",
    main,
    scripts: ["elf-join.js"],
  });
}
