import { elfPage, escapeHtml } from "./shell";
import type { ElfSettings } from "../settings";

// NBCC Elf Detective School: the rules, which a grown up agrees to when enrolling (wave 1 plan,
// Task 8). The words are a draft for Jaimie to approve before the school is switched on. They follow
// the designs: docs/superpowers/specs/2026-10-04-elf-detective-school-design.md and
// 2026-11-03-elf-detective-secret-places-design.md. Unit tested in test/unit/elf-page-rules.test.ts.

function pounds(p: number): string {
  return p % 100 === 0 ? `£${p / 100}` : `£${(p / 100).toFixed(2)}`;
}

const section = (id: string, title: string, body: string) => `
  <section class="section elf-rules-part" aria-labelledby="${id}">
    <div class="wrap">
      <h2 id="${id}" class="h-lg">${title}</h2>
      ${body}
    </div>
  </section>`;

export function renderRulesPage(view: { settings: ElfSettings }): string {
  const from = escapeHtml(pounds(view.settings.entryFromPence));
  const suggested = escapeHtml(pounds(view.settings.entrySuggestedPence));
  const main = `
  <section class="section page-top elf-rules-top" aria-labelledby="elf-rules-heading">
    <div class="wrap">
      <h1 id="elf-rules-heading" class="h-xl">The rules of Elf Detective School</h1>
      <p class="lede">24 cheeky elves have run away from the Elves' Workshop in Annbank. From Tuesday 1 December, one hides somewhere local each day. Here is how the hunt works, and how we keep it fair and safe.</p>
    </div>
  </section>
  ${section(
    "elf-rules-how",
    "How the hunt works",
    `<ul class="elf-rules-list">
      <li>Each day from 1 to 24 December, one elf hides in a local shop, cafe or business. Where it hides is a secret.</li>
      <li>Signed in detectives get three clues each day, from hard to nearly a giveaway: at 5:30pm, 6pm and 6:30pm on school days, and at 10am, 10:30am and 11am at weekends and in the holidays.</li>
      <li>Work out where the elf is hiding and type your guess in Detective HQ. A right guess earns new things for your elf.</li>
      <li>The first detective to reach the elf and type the secret word on its tag wins that elf's prize. Each family can win one elf.</li>
      <li>Visit a place after its elf is found to collect a candy cane stamp.</li>
    </ul>`,
  )}
  ${section(
    "elf-rules-pay",
    "Pay what you can",
    `<p>Pay what you can. We suggest ${suggested} for each detective, and any amount from ${from} for each detective is welcome. The entry is a payment to take part, so it cannot have Gift Aid. You can add a gift on top, and that can.</p>`,
  )}
  ${section(
    "elf-rules-safe",
    "Keeping everyone safe",
    `<ul class="elf-rules-list">
      <li>Under 16s must have a grown up with them at every hiding place.</li>
      <li>On the website a child only ever appears by their detective name: a first name and a festive surname, like Detective Ruby Tinselfoot. We never ask for a real surname, a school or an age.</li>
      <li>A first name is shown in full in public only once our team has checked it. Until then the public sees its first letter.</li>
      <li>A photo only goes on the website if the grown up says yes to that photo, and after our team has checked it.</li>
      <li>All photos come down, and children's details are deleted, at the end of January.</li>
    </ul>`,
  )}
  ${section(
    "elf-rules-prize",
    "The grand prize",
    `<p>Every detective who visits all 24 places can send in a drawing or a photo of their naughtiest elf at home. The grand prize is judged by Jodie, Head Elf, taking age into account. It is never drawn at random. We phone the winner's grown up on Christmas Eve and deliver the prize on Christmas Day.</p>`,
  )}
  ${section(
    "elf-rules-contact",
    "Any questions?",
    `<p>Get in touch through <a href="/contact">our contact page</a>, or email events@nbcc.scot, and we will get back to you.</p>
     <p><a class="btn btn-primary" href="/elf/join">Enrol your detectives</a></p>`,
  )}`;
  return elfPage({
    title: "The rules",
    description: "How NBCC Elf Detective School works, how we keep it fair and safe, and how the grand prize is judged.",
    cta: { href: "/elf/join", label: "Join" },
    home: "/elf",
    main,
    listed: true,
  });
}
