import { clockWords, longDayWords } from "../words";
import { clueNote } from "./hq";
import { candyCane, icon } from "./icons";
import { titleStrip } from "./paper";
import { count, elfPage, escapeHtml, line, real, sitePath } from "./shell";
import type { GoView } from "./types";

// NBCC Elf Detective School: having a go at a door the family missed, on the door's own page in Detective
// HQ. The plan is docs/superpowers/plans/2026-11-12-elf-catch-up.md (Task 6); the design is part 1 of
// docs/superpowers/specs/2026-11-12-elf-catch-up-and-grand-prize-design.md.
//
// The door's elf and who found it, then its clues on a taped note as Detective HQ draws today's case:
// clue 1 first, and Show me the next clue for the next, up to all three. Then one guess. Show me the next
// clue is a plain link (?clues=2, then 3) and the guess a plain form, so the page needs no script. Once
// the family can see the place, the page says how it went: the verdict, where the elf was, and what is left
// to do there.
//
// One rule is kept here whatever the view holds: the place is written only once the family may know it.
// Two locks on the one secret: the view holds how it went only then, and this page writes it only in the
// "done" and "closed" stages, never beside the form. The page's title is the door, never the place.
//
// Pure: no pool, no config, no clock (the time is in the view). Unit tested in
// test/unit/elf-page-go.test.ts.

type Outcome = NonNullable<GoView["outcome"]>;

/** How a go went, in words: the verdict, then where the elf was hiding; or, while it is still hiding with
 *  nobody having found it, where it is and that the prize is still to be won. Words, not markup: escape
 *  them to write them into a page. */
export function goOutcomeWords(o: { elfName: string; verdict: Outcome["verdict"]; place: Outcome["place"]; stillHiding: boolean }): string {
  const elf = o.elfName;
  const where = o.place.town.trim() ? `${o.place.name}, ${o.place.town}` : o.place.name;
  const verdict = o.verdict === "cracked" ? "You cracked it! " : o.verdict === "wrong" ? "Not this time. " : "";
  return (
    verdict +
    (o.stillHiding
      ? `${elf} is hiding at ${where}, and nobody has found ${elf} yet. The first detective to type the word on its tag still wins the prize.`
      : `${elf} was hiding at ${where}.`)
  );
}

/** Who found the elf, and when; or that nobody has yet, or, once the elf has gone home, that nobody did. */
function foundLine(view: GoView): string {
  const found = view.found;
  const elf = escapeHtml(view.elfName);
  if (!found) return line(view.goneHome === true ? `Nobody found ${elf}.` : `Nobody has found ${elf} yet.`, "elf-go__found");
  const at = real(found.at) ? ` at ${clockWords(found.at)}` : "";
  return line(`${icon("rosette", 16)} Found by ${escapeHtml(found.by)}${at}.`, "elf-go__found");
}

/** Why the go sent with no script was not taken (the server's words), as a status line, or nothing. */
function guessErrorLine(view: GoView): string {
  return typeof view.guessError === "string" && view.guessError !== ""
    ? `<p class="elf-guess__status is-error" role="status">${escapeHtml(view.guessError)}</p>`
    : "";
}

/** Having a go: the clues asked for, the link to the next, and the one guess. The form sends how many
 *  clues are showing, so a refused go is drawn again as the family left it. */
function goStage(view: GoView): string {
  const elf = escapeHtml(view.elfName);
  const day = real(view.day) ? longDayWords(view.day) : "";
  const notes = view.clues.length ? `<ol class="elf-ladder">${view.clues.map(clueNote).join("")}</ol>` : "";
  const next = sitePath(view.nextUrl);
  return (
    `<h2 id="elf-go-case-heading">Crack the case</h2>` +
    (day ? line(`The clues came out on ${day}. Read them one at a time, then make your guess.`) : "") +
    (real(view.closesAt) ? line(`The hiding place closes at ${clockWords(view.closesAt)} today.`, "elf-go__closes") : "") +
    notes +
    (next ? `<p class="elf-go__next"><a class="elf-btn elf-btn--holly" href="${next}">Show me the next clue</a></p>` : "") +
    `<form class="elf-guess" method="post" action="${sitePath(view.formUrl) ?? "/"}">` +
    `<input type="hidden" name="clues" value="${count(view.clues.length)}" />` +
    // Ruling F8: "Where is" only while the elf is still out there with nobody having found it.
    `<fieldset><legend>${view.stillHiding ? `Where is ${elf} hiding?` : `Where was ${elf} hiding?`}</legend>` +
    // A go is one final guess, matched once capitals, spaces, accents, marks and a leading "the" are taken off
    // (src/elf/place-names.ts), so the hint promises no more than that. Detective HQ's night guess says spelling
    // does not have to be perfect: it can be changed until the place is shown.
    `<label class="elf-guess__hint" for="go-text">Type the name of the place. Capitals and spaces do not matter. Check your spelling: you get one guess.</label>` +
    `<input class="elf-guess__text" id="go-text" name="text" type="text" required maxlength="80" autocomplete="off" autocapitalize="words" enterkeyhint="done" />` +
    `</fieldset>` +
    line("You get one guess at this door.", "elf-go__one") +
    guessErrorLine(view) +
    `<button class="elf-btn elf-btn--crimson" type="submit">Lock in my guess</button>` +
    `</form>`
  );
}

/** How it went: the verdict and where the elf was, on a slip of paper (holly when the family cracked it),
 *  then what is left to do at the place, and on the door's own day when the place closes. */
function outcomeHtml(view: GoView, o: Outcome): string {
  const cracked = o.verdict === "cracked";
  const said = escapeHtml(goOutcomeWords({ elfName: view.elfName, verdict: o.verdict, place: o.place, stillHiding: o.stillHiding }));
  const visit = o.visited
    ? `${candyCane(16)} Your family has been there. Candy cane collected.`
    : o.goneHome
      ? `${escapeHtml(view.elfName)} has gone home now, so there is nothing to find there.`
      : "Visit the hiding place and scan its poster to collect your candy cane.";
  return (
    line(
      cracked ? `<span class="elf-mark elf-mark--cracked">${icon("cracked", 16)}</span> ${said}` : said,
      `elf-case__verdict elf-go__verdict${cracked ? " is-cracked" : ""}`,
    ) +
    line(visit, "elf-case__hint") +
    (real(view.closesAt) ? line(`${escapeHtml(o.place.name)} closes at ${clockWords(view.closesAt)} today.`, "elf-go__closes") : "")
  );
}

/** The note's words for each stage. A go refused where there is no form still says why. */
function stageHtml(view: GoView, stage: GoView["stage"]): string {
  if (stage === "go") return goStage(view);
  const heading = stage === "done" ? "How it went" : "Having a go closed on Christmas Day.";
  return `<h2 id="elf-go-case-heading">${heading}</h2>` + guessErrorLine(view) + (view.outcome ? outcomeHtml(view, view.outcome) : "");
}

/** The whole of a door's go page. */
export function renderGoPage(view: GoView): string {
  const n = count(view.door);
  const practice = view.practice === true;
  const elf = escapeHtml(view.elfName);
  const title = practice ? "The practice door" : `Door ${n}`;
  const stage: GoView["stage"] = view.stage === "go" || view.stage === "done" ? view.stage : "closed";
  const hq = sitePath(view.hqUrl) ?? "/elf/hq";
  const main = `  <section class="page-top elf-top elf-go-top" aria-labelledby="elf-go-heading">
    <div class="wrap">
      <p class="elf-label">Detective HQ</p>
      ${titleStrip({ text: title, tag: "h1", id: "elf-go-heading" })}
      ${practice ? `<p class="elf-practice"><span class="elf-chip elf-chip--new">Practice</span></p>` : ""}
      <p class="lede elf-go__elf">${practice ? `${elf}, the practice door's elf` : `${elf}, the elf behind door ${n}`}</p>
    </div>
  </section>

  <section class="elf-go-case" aria-labelledby="elf-go-case-heading">
    <div class="wrap">
      <div class="elf-go elf-go--${stage} elf-case elf-note">
        <span class="elf-tape" aria-hidden="true"></span>
        ${foundLine(view)}
        ${stageHtml(view, stage)}
      </div>
      <p class="elf-go__back"><a class="elf-btn" href="${hq}">Back to Detective HQ</a></p>
    </div>
  </section>`;

  return elfPage({
    title,
    description: "Your family's go at a door you missed in NBCC Elf Detective School: its clues one at a time, then one guess.",
    cta: { href: hq, label: "Detective HQ" },
    main,
  });
}
