import { describe, it, expect } from "vitest";
import { doorState, isClaimable, isOpen, type DoorFacts } from "../../src/elf/doors";

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

  it("stays hunting overnight when the place has no closing time set", () => {
    expect(doorState(door({ revealAt: null }), at("2026-12-08T09:00:00.000Z"))).toBe("hunting");
  });

  it("is found, not revealed, once someone claims a revealed elf", () => {
    const late = door({ foundAt: at("2026-12-08T10:15:00.000Z") });
    expect(doorState(late, at("2026-12-08T10:00:00.000Z"))).toBe("revealed");
    expect(doorState(late, at("2026-12-08T10:15:00.000Z"))).toBe("found");
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
