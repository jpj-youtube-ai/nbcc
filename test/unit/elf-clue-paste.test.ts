import { describe, it, expect } from "vitest";
import { parseCluePaste, pasteAgainstDoors, PASTE_EXAMPLE, CLUE_WORDS_MAX } from "../../src/elf/clue-paste";

const GOOD = [
  "Door 7: Pine Cone Cafe",
  "Clue 1: Look where the kettle sings.",
  "Clue 2: Behind the tall green door,",
  "which has a brass knocker.",
  "Clue 3: Under the blue sign.",
  "",
  "Door 8: Invented Bookshop",
  "Clue 1: Words one.",
  "Clue 2: Words two.",
  "Clue 3: Words three.",
].join("\n");

const kinds = (t: string) => parseCluePaste(t).problems.map((p) => p.kind);

describe("parseCluePaste", () => {
  it("reads a good text", () => {
    const r = parseCluePaste(GOOD);
    expect(r.problems).toEqual([]);
    expect(r.doors.map((d) => d.door)).toEqual([7, 8]);
    expect(r.doors.flatMap((d) => d.clues)).toHaveLength(6);
    expect(r.doors[0].clues[0]).toEqual({ n: 1, words: "Look where the kettle sings." });
  });
  it("reads Windows line endings and a byte order mark the same", () => {
    expect(parseCluePaste("\uFEFF" + GOOD.replace(/\n/g, "\r\n"))).toEqual(parseCluePaste(GOOD));
  });
  it("reads DOOR in capitals", () => {
    const r = parseCluePaste("DOOR 7: Pine Cone Café\nCLUE 1: a\nclue 2: b\nClue 3: c");
    expect(r.doors[0].door).toBe(7);
    expect(r.problems).toEqual([]);
  });
  it("joins continuation lines with a newline", () => {
    expect(parseCluePaste(GOOD).doors[0].clues[1].words).toBe("Behind the tall green door,\nwhich has a brass knocker.");
  });
  it("says when there is nothing", () => {
    const p = parseCluePaste("   \n").problems;
    expect(p).toHaveLength(1);
    expect(p[0].kind).toBe("nothing");
    expect(p[0].message).toBe("There are no doors in this text.");
  });
  it("says when words come before any door", () => {
    const p = parseCluePaste("Hello\nDoor 1\nClue 1: a\nClue 2: b\nClue 3: c").problems;
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ kind: "outside-door", line: 1, message: "Line 1: this comes before any Door line, so it belongs to no door." });
  });
  it("says when a door does not exist", () => {
    const p = parseCluePaste("Door 25\nClue 1: a").problems;
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ kind: "bad-door", line: 1, message: "Line 1: there is no door 25. Doors go from 1 to 24." });
    expect(kinds("Door 0")).toEqual(["bad-door"]);
  });
  it("says when a door comes twice", () => {
    const p = parseCluePaste(GOOD + "\nDoor 7\nClue 1: x").problems;
    expect(p.map((x) => x.kind)).toEqual(["door-twice"]);
    expect(p[0].message).toBe("Door 7 is in the text twice.");
    expect(p[0].door).toBe(7);
  });
  it("says when a clue number is wrong", () => {
    const p = parseCluePaste("Door 3\nClue 4: a\nClue 1: a\nClue 2: b\nClue 3: c").problems;
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ kind: "bad-clue", line: 2, message: "Line 2: a door has clues 1, 2 and 3 only." });
  });
  it("says when a clue comes twice", () => {
    const p = parseCluePaste("Door 3\nClue 1: a\nClue 1: b\nClue 2: b\nClue 3: c").problems;
    expect(p.map((x) => x.kind)).toEqual(["clue-twice"]);
    expect(p[0].message).toBe("Door 3 has clue 1 twice.");
  });
  it("says when a clue is missing", () => {
    const p = parseCluePaste("Door 3\nClue 1: a\nClue 3: c").problems;
    expect(p.map((x) => x.kind)).toEqual(["missing-clue"]);
    expect(p[0].message).toBe("Door 3 is missing clue 2.");
  });
  it("says when a clue has no words", () => {
    const p = parseCluePaste("Door 3\nClue 1:\nClue 2: b\nClue 3: c").problems;
    expect(p.map((x) => x.kind)).toEqual(["empty-clue"]);
    expect(p[0].message).toBe("Door 3, clue 1 has no words.");
  });
  it("counts length after trimming", () => {
    const ok = `Door 3\nClue 1:   ${"a".repeat(CLUE_WORDS_MAX)}   \nClue 2: b\nClue 3: c`;
    expect(parseCluePaste(ok).problems).toEqual([]);
    const p = parseCluePaste(`Door 3\nClue 1: ${"a".repeat(501)}\nClue 2: b\nClue 3: c`).problems;
    expect(p.map((x) => x.kind)).toEqual(["too-long"]);
    expect(p[0].message).toBe("Door 3, clue 1 is 501 characters long. The most is 500.");
  });
  it("has an example that parses cleanly apart from needing all clues", () => {
    expect(PASTE_EXAMPLE).toContain("Door 7:");
    expect(parseCluePaste(PASTE_EXAMPLE).problems).toEqual([]);
  });
});

describe("pasteAgainstDoors", () => {
  it("flags only clues already out", () => {
    const r = parseCluePaste(GOOD);
    const p = pasteAgainstDoors(r, (d, n) => d === 7 && n === 1);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ kind: "clue-out", door: 7, message: "Door 7, clue 1 is already out, so it cannot be changed." });
  });
});
