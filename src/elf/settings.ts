// NBCC Elf Detective School: the settings staff set in the admin (one row, elf_settings), as the
// pure code sees them. Read and written by src/db/elf.ts.

export interface ElfSettings {
  /** The switch. Off: every /elf page and /api/elf route answers 404. */
  schoolOn: boolean;
  year: number;
  /** The least a family pays for each detective. */
  entryFromPence: number;
  /** What is suggested for each detective. */
  entrySuggestedPence: number;
  /** The sha256 of the private preview link's code, or null when there is no preview link. */
  previewHash?: string | null;
  /** The number shown on the staff card for a place to ring, or null when none is set. */
  placePhone: string | null;
  /** The December doors' switch. Off: every family route reads as wave 1 (shut doors, no clues). */
  doorsOn: boolean;
  /** When the grand prize entries close on Christmas Eve, or null for the default: 5pm on 24 December
   *  of year (Plan 2c-2). */
  grandPrizeClosesAt: Date | null;
  /** The graduates' video, an https link, or null when there is none, and then Detective HQ shows no
   *  video link (Plan 2c-2). */
  graduateVideoUrl: string | null;
}

/** What the school reads as when its row cannot be read: switched off, from £1, £5 suggested. */
export const ELF_DEFAULTS: Readonly<ElfSettings> = Object.freeze({
  schoolOn: false,
  year: 2026,
  entryFromPence: 100,
  entrySuggestedPence: 500,
  previewHash: null,
  placePhone: null,
  doorsOn: false,
  grandPrizeClosesAt: null,
  graduateVideoUrl: null,
});
