import { describe, it, expect } from "vitest";
import { entryLine, entryWords } from "../../src/fundraising/entry";

// Event clarity: how people get in, in a few words, for an event's page and poster. Every address
// here is invented.
describe("an event's entry line", () => {
  it("says the price and that it is paid on the door", () => {
    expect(entryWords({ booking: "door", price: "£5" })).toBe("Entry: £5, paid on the door");
    expect(entryWords({ booking: "door", price: null })).toBe("Entry: paid on the door");
  });

  it("never says Free, paid on the door", () => {
    expect(entryWords({ booking: "door", price: "Free" })).toBe("Entry: free");
    expect(entryWords({ booking: "door", price: " free. " })).toBe("Entry: free");
    expect(entryWords({ booking: "door", price: "Free, donations welcome" })).toBe("Entry: Free, donations welcome");
  });

  it("never says on the door twice", () => {
    expect(entryWords({ booking: "door", price: "£5 on the door" })).toBe("Entry: £5 on the door");
    expect(entryWords({ booking: "door", price: "£4 in advance, £5 at the door" })).toBe("Entry: £4 in advance, £5 at the door");
  });

  it("says free for a free event, whatever the price says", () => {
    expect(entryWords({ booking: "free", price: "£5" })).toBe("Entry: free");
  });

  it("names and links the seller for tickets sold elsewhere", () => {
    expect(entryLine({ booking: "away", price: "£10", ticketUrl: "https://www.tickets.example.com/e/1" })).toEqual({
      lead: "Tickets: £10, from ",
      seller: "tickets.example.com",
      url: "https://www.tickets.example.com/e/1",
    });
    expect(entryWords({ booking: "away", price: "Free", ticketUrl: "https://tickets.example.com/e/1" })).toBe("Tickets: free, from tickets.example.com");
  });

  it("only links a seller's https address", () => {
    for (const ticketUrl of ["http://tickets.example.com/e/1", "javascript:alert(1)", "ftp://tickets.example.com/e/1", "not a link"]) {
      expect(entryLine({ booking: "away", price: null, ticketUrl })).toEqual({ lead: "Tickets: from another website", seller: "", url: null });
    }
  });

  it("says nothing when it was never asked", () => {
    expect(entryLine({ booking: null, price: "£5" })).toBeNull();
  });
});
