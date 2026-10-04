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

/** The candy cane that marks a visit. It keeps its own red and white whatever it sits on. */
export function candyCane(size = 18): string {
  const cane = "M5.5 15V6.5a3 3 0 0 1 6 0V8";
  return (
    `<svg class="elf-icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke-linecap="round" aria-hidden="true" focusable="false">` +
    `<path d="${cane}" stroke="#C02238" stroke-width="2.6"/><path d="${cane}" stroke="#FFFDFA" stroke-width="2.6" stroke-dasharray="1.4 2"/></svg>`
  );
}
