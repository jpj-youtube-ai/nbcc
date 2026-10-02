import { describe, it, expect } from "vitest";
import { keepQuery } from "../../src/site/redirect";

// TASK-492: a spare address (or an old address) sends its visitor on to the page with the query
// string it arrived with, so the tags that say where a visit came from survive the hop: a QR
// code's utm_medium=qr, a newsletter's utm_source. The target is always one of our own paths.

describe("sending a visitor on, query and all", () => {
  it("keeps the query string the visitor arrived with", () => {
    expect(keepQuery("/donate", "/give?utm_medium=qr&utm_campaign=give")).toBe("/donate?utm_medium=qr&utm_campaign=give");
  });

  it("adds nothing when there was no query", () => {
    expect(keepQuery("/donate", "/give")).toBe("/donate");
    expect(keepQuery("/donate", "/give?")).toBe("/donate");
  });

  it("joins a target that has its own query", () => {
    expect(keepQuery("/donate?x=1", "/give?utm_medium=qr")).toBe("/donate?x=1&utm_medium=qr");
  });

  it("never lets the query change where the visitor goes", () => {
    expect(keepQuery("/donate", "/give?//evil.example.com")).toBe("/donate?//evil.example.com");
    expect(keepQuery("/donate", "/give?a=1#frag")).toBe("/donate?a=1");
  });
});
