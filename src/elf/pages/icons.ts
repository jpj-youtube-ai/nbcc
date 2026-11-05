// NBCC Elf Detective School: the few small pictures the screens use. The plan is
// docs/superpowers/plans/2026-10-04-elf-detective-a3-screens.md.
//
// Drawn here as inline SVG so a screen needs no icon font and no extra request, and so every icon
// takes its colour from the words around it. They are decoration: each sits beside words that say
// the same thing, so every one is hidden from screen readers.
//
// Pure. Unit tested through the screens that use them.

const LINES: Record<string, string> = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cracked: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/><path d="m8.2 11.2 2 2 3.6-3.8"/>',
  rosette: '<circle cx="12" cy="9" r="5.5"/><path d="M8.6 13.6 7 21l5-2.6 5 2.6-1.6-7.4"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.4"/>',
  padlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  tick: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
};

export type IconName = "clock" | "cracked" | "rosette" | "pin" | "camera" | "padlock" | "tick";

/** A line icon in the colour of the words round it. */
export function icon(name: IconName, size = 18): string {
  return (
    `<svg class="elf-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${LINES[name]}</svg>`
  );
}

/** A wrapped present, for the news that something has arrived in the wardrobe. The lid is a group
 *  of its own so that it can lift when the page opens. */
export function gift(size = 40): string {
  return (
    `<svg class="elf-gift" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<rect x="4.5" y="11" width="15" height="10" rx="1.5" fill="#C02238"/>` +
    `<rect x="10.75" y="11" width="2.5" height="10" fill="#F1DA9A"/>` +
    `<g class="elf-gift__lid"><rect x="3" y="7" width="18" height="4.6" rx="1.2" fill="#800000"/>` +
    `<rect x="10.75" y="7" width="2.5" height="4.6" fill="#F1DA9A"/>` +
    `<path d="M12 7C10.8 4 7.4 3.8 7.2 5.4 7 7 9.6 7.2 12 7zm0 0c1.2-3 4.6-3.2 4.8-1.6C17 7 14.4 7.2 12 7z" fill="#C9A24A"/></g></svg>`
  );
}

/** The candy cane that marks a visit. It keeps its own red and white whatever it sits on. */
export function candyCane(size = 18): string {
  const cane = "M5.5 15V6.5a3 3 0 0 1 6 0V8";
  return (
    `<svg class="elf-icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke-linecap="round" aria-hidden="true" focusable="false">` +
    // The white stripes have square ends: round ones spread until the red all but disappears.
    `<path d="${cane}" stroke="#C02238" stroke-width="2.8"/>` +
    `<path d="${cane}" stroke="#FFFDFA" stroke-width="2.8" stroke-linecap="butt" stroke-dasharray="1.2 2.4" stroke-dashoffset="-1.2"/></svg>`
  );
}
