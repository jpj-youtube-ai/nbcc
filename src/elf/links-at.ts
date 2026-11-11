// The moment the main site starts linking to Elf Detective School: 10:00 UK time on Friday 13 November
// 2026 (10:00 UTC, the clocks have gone back), when the big push starts (Jaimie, 11 November 2026).
//
// Elf Detective School is switched on the evening before (elf_settings.school_on), so a teacher who
// has the link in an email can look around and enrol. Its own pages (/elf) answer the moment it is
// switched on. But until this moment nothing on the site links to it: the card on the home page, Get
// involved and Your school (src/elf/promo.ts), the menu's item (src/elf/nav-link.ts) and the site
// maps all wait, and those pages are byte for byte what they are with it switched off. Admin > QR
// codes does not wait: it is for staff, who may make a code before then.
//
// Pure: the time is always handed in, and the only reading of the clock is at the edge, in
// src/routes/site.ts, so a test can stand on either side (as src/site/after-ball.ts does). Once the
// moment has passed, this file and the checks in front of those links can go.

const AT_MS = Date.UTC(2026, 10, 13, 10, 0, 0);

export const ELF_LINKS_AT = new Date(AT_MS);

/** Has the moment come? A time that makes no sense has not: nothing appears by accident. */
export function elfLinksLive(now: Date): boolean {
  return now.getTime() >= AT_MS;
}
