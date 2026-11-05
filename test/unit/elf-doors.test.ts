import { describe, it, expect } from "vitest";
import { doorState, isClaimable, isOpen, openedAt, type DoorFacts } from "../../src/elf/doors";

// NBCC Elf Detective School: where a door is up to. Pure, checked here without a clock.

const CLUE = new Date("2026-12-07T17:30:00.000Z");
const CLOSES = new Date("2026-12-07T21:00:00.000Z");
const at = (iso: string) => new Date(iso);
const door = (over: Partial<DoorFacts> = {}): DoorFacts => ({ clueAt: CLUE, revealAt: CLOSES, foundAt: null, ...over });

describe("where a door is up to", () => {
  it("is shut until its clue comes out", () => {
    expect(doorState(door(), at("2026-12-07T17:29:59.000Z"))).toBe("shut");
    expect(doorState(door(), at("2026-12-01T09:00:00.000Z"))).toBe("shut");
  });

  it("is hunting from the moment the clue is out", () => {
    expect(doorState(door(), CLUE)).toBe("hunting");
    expect(doorState(door(), at("2026-12-07T20:59:59.000Z"))).toBe("hunting");
  });

  it("is found from the moment of the winning claim", () => {
    const found = door({ foundAt: at("2026-12-07T17:47:00.000Z") });
    expect(doorState(found, at("2026-12-07T17:46:59.000Z"))).toBe("hunting");
    expect(doorState(found, at("2026-12-07T17:47:00.000Z"))).toBe("found");
    expect(doorState(found, at("2026-12-20T12:00:00.000Z"))).toBe("found");
  });

  it("is revealed when the place closes with the elf still hiding", () => {
    expect(doorState(door(), CLOSES)).toBe("revealed");
    expect(doorState(door(), at("2026-12-08T09:00:00.000Z"))).toBe("revealed");
  });

  it("is found, not revealed, once someone claims a revealed elf", () => {
    const late = door({ foundAt: at("2026-12-08T10:15:00.000Z") });
    expect(doorState(late, at("2026-12-08T10:00:00.000Z"))).toBe("revealed");
    expect(doorState(late, at("2026-12-08T10:15:00.000Z"))).toBe("found");
  });

  it("does not trust a closing time that is not after the clue, and reveals a day after the clue instead", () => {
    const odd = door({ revealAt: at("2026-12-07T16:00:00.000Z") });
    expect(doorState(odd, CLUE)).toBe("hunting");
    expect(doorState(odd, at("2026-12-08T17:29:59.000Z"))).toBe("hunting");
    expect(doorState(odd, at("2026-12-08T17:30:00.000Z"))).toBe("revealed");
    expect(doorState(door({ revealAt: CLUE }), CLUE)).toBe("hunting");
  });

  it("stays shut when its clue time is not a real date", () => {
    const broken = door({ clueAt: new Date(Number.NaN) });
    expect(doorState(broken, at("2026-12-07T18:00:00.000Z"))).toBe("shut");
    expect(doorState(broken, at("2026-12-20T18:00:00.000Z"))).toBe("shut");
  });
});

describe("the moment a door opened", () => {
  it("is nothing while the door is shut or the elf is still hunted", () => {
    expect(openedAt(door(), at("2026-12-07T17:00:00.000Z"))).toBeNull();
    expect(openedAt(door(), at("2026-12-07T18:00:00.000Z"))).toBeNull();
  });

  it("is the winning claim when the elf is found before the place closes", () => {
    const found = door({ foundAt: at("2026-12-07T17:47:00.000Z") });
    expect(openedAt(found, at("2026-12-07T17:46:00.000Z"))).toBeNull();
    expect(openedAt(found, at("2026-12-07T19:00:00.000Z"))?.toISOString()).toBe("2026-12-07T17:47:00.000Z");
    expect(openedAt(found, at("2026-12-20T12:00:00.000Z"))?.toISOString()).toBe("2026-12-07T17:47:00.000Z");
  });

  it("is the closing time when the place closed with the elf still hiding", () => {
    expect(openedAt(door(), at("2026-12-08T09:00:00.000Z"))?.toISOString()).toBe("2026-12-07T21:00:00.000Z");
  });

  it("stays the closing time when a revealed elf is found later", () => {
    const late = door({ foundAt: at("2026-12-08T10:15:00.000Z") });
    expect(openedAt(late, at("2026-12-08T11:00:00.000Z"))?.toISOString()).toBe("2026-12-07T21:00:00.000Z");
  });

  it("is a day after the clue when the closing time is not after the clue", () => {
    const odd = door({ revealAt: at("2026-12-07T16:00:00.000Z") });
    expect(openedAt(odd, at("2026-12-08T17:00:00.000Z"))).toBeNull();
    expect(openedAt(odd, at("2026-12-09T09:00:00.000Z"))?.toISOString()).toBe("2026-12-08T17:30:00.000Z");
  });
});

describe("what a door's state allows", () => {
  it("shows the place once the door is found or revealed", () => {
    expect(isOpen("shut")).toBe(false);
    expect(isOpen("hunting")).toBe(false);
    expect(isOpen("found")).toBe(true);
    expect(isOpen("revealed")).toBe(true);
  });

  it("lets the elf be claimed while it is hunted or waiting at a revealed place", () => {
    expect(isClaimable("shut")).toBe(false);
    expect(isClaimable("hunting")).toBe(true);
    expect(isClaimable("revealed")).toBe(true);
    expect(isClaimable("found")).toBe(false);
  });
});
