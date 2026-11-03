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
}

/** What the school reads as when its row cannot be read: switched off, from £1, £5 suggested. */
export const ELF_DEFAULTS: Readonly<ElfSettings> = Object.freeze({
  schoolOn: false,
  year: 2026,
  entryFromPence: 100,
  entrySuggestedPence: 500,
});
