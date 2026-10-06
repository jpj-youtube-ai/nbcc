import { describe, it, expect } from "vitest";
import { keepQuery, forwardStatus } from "../../src/site/redirect";

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

// TASK-568: a forward to a subdomain is one staff can change or remove, so it must not be the kind
// a browser remembers for good. The site's own pages keep the permanent kind they always had.
describe("forwardStatus", () => {
  it("is temporary for a subdomain and permanent for one of our own pages", () => {
    expect(forwardStatus("https://drop.nbcc.scot")).toBe(302);
    expect(forwardStatus("/donate")).toBe(301);
    expect(forwardStatus("/")).toBe(301);
  });

  it("carries the arriving query across to a subdomain too", () => {
    expect(keepQuery("https://drop.nbcc.scot/collect", "/drop?utm_medium=qr")).toBe(
      "https://drop.nbcc.scot/collect?utm_medium=qr",
    );
  });
});
