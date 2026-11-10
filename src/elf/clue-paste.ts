import { isDoor, type Door } from "./calendar";

// NBCC Elf Detective School: every clue pasted in at once. The private clue file is written to
// match this format and the Doors page shows it as help, so the sentences below are exact.

export type ClueN = 1 | 2 | 3;

export interface PastedDoor {
  door: Door;
  line: number;
  clues: { n: ClueN; words: string }[];
}

export type PasteProblemKind =
  | "nothing" | "outside-door" | "bad-door" | "door-twice" | "bad-clue"
  | "clue-twice" | "missing-clue" | "empty-clue" | "too-long" | "clue-out";

export interface PasteProblem {
  kind: PasteProblemKind;
  line: number | null;
  door: Door | null;
  message: string;
}

export interface PasteResult {
  doors: PastedDoor[];
  problems: PasteProblem[];
}

export const CLUE_WORDS_MAX = 500;

export const PASTE_EXAMPLE = [
  "Door 7: anything after the number is a note for people and is ignored",
  "Clue 1: the words of clue 1",
  "Clue 2: the words of clue 2,",
  "which can run on to more lines",
  "Clue 3: the words of clue 3",
].join("\n");

interface Building {
  door: Door;
  line: number;
  clues: Map<ClueN, { words: string; line: number }>;
}

export function parseCluePaste(text: string): PasteResult {
  const problems: PasteProblem[] = [];
  const problem = (kind: PasteProblemKind, line: number | null, door: Door | null, message: string) =>
    problems.push({ kind, line, door, message });

  const lines = String(text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/);
  const built: Building[] = [];
  const seen = new Set<number>();
  let sawDoorLine = false;
  // What a line that is neither a door nor a clue belongs to. null: nothing, and it is ignored.
  let current: Building | null = null;
  let currentClue: { words: string; line: number } | null = null;
  // Inside a door that is refused (no such door, or a repeat), its clues are skipped quietly.
  let skipping = false;

  lines.forEach((raw, i) => {
    const line = i + 1;
    const t = raw.trim();
    if (t === "") return;

    const doorMatch = /^door\s+(\d+)\b/i.exec(t);
    if (doorMatch) {
      sawDoorLine = true;
      const n = Number(doorMatch[1]);
      current = null;
      currentClue = null;
      skipping = true;
      if (!isDoor(n)) {
        problem("bad-door", line, null, `Line ${line}: there is no door ${n}. Doors go from 1 to 24.`);
      } else if (seen.has(n)) {
        problem("door-twice", line, n, `Door ${n} is in the text twice.`);
      } else {
        seen.add(n);
        current = { door: n, line, clues: new Map() };
        built.push(current);
        skipping = false;
      }
      return;
    }

    const clueMatch = /^clue\s+(\d+)\s*:\s*(.*)$/i.exec(t);
    if (clueMatch) {
      if (skipping) return;
      if (current === null) {
        problem("outside-door", line, null, `Line ${line}: this comes before any Door line, so it belongs to no door.`);
        return;
      }
      const n = Number(clueMatch[1]);
      currentClue = null;
      if (n !== 1 && n !== 2 && n !== 3) {
        problem("bad-clue", line, current.door, `Line ${line}: a door has clues 1, 2 and 3 only.`);
        return;
      }
      if (current.clues.has(n)) {
        problem("clue-twice", line, current.door, `Door ${current.door} has clue ${n} twice.`);
        return;
      }
      currentClue = { words: clueMatch[2], line };
      current.clues.set(n, currentClue);
      return;
    }

    if (skipping) return;
    if (current === null) {
      problem("outside-door", line, null, `Line ${line}: this comes before any Door line, so it belongs to no door.`);
      return;
    }
    if (currentClue !== null) currentClue.words += `\n${t}`;
  });

  const doors: PastedDoor[] = built.map((b) => {
    const clues: PastedDoor["clues"] = [];
    for (const n of [1, 2, 3] as const) {
      const c = b.clues.get(n);
      if (!c) {
        problem("missing-clue", b.line, b.door, `Door ${b.door} is missing clue ${n}.`);
        continue;
      }
      const words = c.words.trim();
      if (words === "") problem("empty-clue", c.line, b.door, `Door ${b.door}, clue ${n} has no words.`);
      else if (words.length > CLUE_WORDS_MAX) {
        problem("too-long", c.line, b.door, `Door ${b.door}, clue ${n} is ${words.length} characters long. The most is 500.`);
      }
      clues.push({ n, words });
    }
    return { door: b.door, line: b.line, clues };
  });

  if (!sawDoorLine && problems.length === 0) problem("nothing", null, null, "There are no doors in this text.");
  problems.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return { doors, problems };
}

/** One problem for each pasted clue that is already out. */
export function pasteAgainstDoors(result: PasteResult, isOut: (door: Door, n: ClueN) => boolean): PasteProblem[] {
  const out: PasteProblem[] = [];
  for (const d of result.doors) {
    for (const c of d.clues) {
      if (isOut(d.door, c.n)) {
        out.push({ kind: "clue-out", line: d.line, door: d.door, message: `Door ${d.door}, clue ${c.n} is already out, so it cannot be changed.` });
      }
    }
  }
  return out;
}
