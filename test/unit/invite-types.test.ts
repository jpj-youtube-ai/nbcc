import { describe, it, expect } from "vitest";
import {
  INVITE_MEMORY_WAITING,
  INVITE_TYPES,
  INVITE_TYPE_LABELS,
  INVITE_WORDING_KEYS,
  inviteMaySend,
  invitePrefill,
  inviteSchema,
  inviteTypeOf,
  inviteWordingKey,
} from "../../src/fundraising/invite";
import { buildInviteEmail } from "../../src/fundraising/team-emails";
import { quoteBox, signOffAs } from "../../src/email/brand";

// Invite types (Jaimie, B1 + I1): staff say what they are inviting someone to do. The rules, and the
// four emails. Every name and address here is invented.

const URL = "https://nbcc.test/fundraise?invite=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const body = (over: Record<string, unknown> = {}) => ({ firstName: "Mary", lastName: "Sample", email: "mary@example.com", signedBy: 3, ...over });

describe("what someone can be invited to do", () => {
  it("is one of four things, each with its words in the drop-down", () => {
    expect(INVITE_TYPES).toEqual(["raising", "team", "event", "memory"]);
    expect(INVITE_TYPES.map((t) => INVITE_TYPE_LABELS[t])).toEqual(["Raising money", "A team", "Hosting an event", "In memory"]);
  });

  it("is taken from the form, and kept", () => {
    for (const type of INVITE_TYPES) {
      const parsed = inviteSchema.safeParse(body({ type }));
      expect(parsed.success && parsed.data.type).toBe(type);
    }
  });

  it("is none for a page loaded before the drop-down, which sends no type", () => {
    const parsed = inviteSchema.safeParse(body());
    expect(parsed.success && parsed.data.type).toBeNull();
    const old = inviteSchema.safeParse({ name: "Mary Sample", email: "mary@example.com", signedBy: 3 });
    expect(old.success && old.data.type).toBeNull();
  });

  it("refuses anything else, naming the drop-down", () => {
    for (const type of ["", "wedding", 4]) {
      const parsed = inviteSchema.safeParse(body({ type }));
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].path).toEqual(["type"]);
        expect(parsed.error.issues[0].message).toBe("Choose what you are inviting them to do.");
      }
    }
  });

  it("reads a stored value, and anything unknown as none", () => {
    expect(inviteTypeOf("memory")).toBe("memory");
    expect(inviteTypeOf(null)).toBeNull();
    expect(inviteTypeOf(undefined)).toBeNull();
    expect(inviteTypeOf("wedding")).toBeNull();
  });
});

describe("where the sign up form opens", () => {
  const row = { name: "Mary Sample", firstName: "Mary", lastName: "Sample", email: "mary@example.com" };
  const who = { name: "Mary Sample", firstName: "Mary", lastName: "Sample", email: "mary@example.com" };

  it("is as it always was for an invite with no type: the name and email, and nothing else", () => {
    expect(invitePrefill(row)).toEqual(who);
    expect(invitePrefill({ ...row, inviteType: null })).toEqual(who);
  });

  it("is on raising money", () => {
    expect(invitePrefill({ ...row, inviteType: "raising" })).toEqual({ ...who, path: "raising" });
  });

  it("is on raising money, with A team chosen at the team step", () => {
    expect(invitePrefill({ ...row, inviteType: "team" })).toEqual({ ...who, path: "raising", team: "team" });
  });

  it("is on holding an event", () => {
    expect(invitePrefill({ ...row, inviteType: "event" })).toEqual({ ...who, path: "event" });
  });

  it("is on a page in memory of someone", () => {
    expect(invitePrefill({ ...row, inviteType: "memory" })).toEqual({ ...who, path: "memory" });
  });

  it("never carries an answer about age, a consent or a permission", () => {
    for (const type of INVITE_TYPES) {
      const keys = Object.keys(invitePrefill({ ...row, inviteType: type }));
      expect(keys.filter((k) => !["name", "firstName", "lastName", "email", "path", "team"].includes(k))).toEqual([]);
    }
  });
});

describe("the in memory invite's sign off", () => {
  it("is the only invite wording that needs one", () => {
    expect(INVITE_WORDING_KEYS).toEqual(["invite_memory"]);
    expect(inviteWordingKey("memory")).toBe("invite_memory");
    for (const t of ["raising", "team", "event", null] as const) expect(inviteWordingKey(t)).toBeNull();
  });

  it("holds an in memory invite until its wording is approved, and no other", () => {
    const none = new Set<string>();
    expect(inviteMaySend("memory", none)).toBe(false);
    expect(inviteMaySend("memory", new Set(["invite_memory"]))).toBe(true);
    for (const t of ["raising", "team", "event", null] as const) expect(inviteMaySend(t, none)).toBe(true);
  });

  it("says why in plain words", () => {
    expect(INVITE_MEMORY_WAITING).toBe("The in memory invite wording is waiting for sign off. Read it and approve it first.");
  });
});

describe("the invite email, for each type", () => {
  const make = (type: "raising" | "team" | "event" | "memory" | null | undefined) =>
    buildInviteEmail({ firstName: "Mary", note: "It was good to talk today.", signer: "Fern", url: URL, type });
  const CHAT = "It was so lovely to chat with you about your plans to raise money for NBCC. Thank you, it honestly means the world to us.";
  const START = "We've given you a head start: press the button below and the form is already started for you. It only takes a few minutes.";
  const ASK = "Need posters, leaflets, a collection bucket or a shout out on our social media? Just ask, we're here to help.";

  it("is the approved wording, unchanged, for raising money and for an invite with no type", () => {
    const plain = buildInviteEmail({ firstName: "Mary", note: "It was good to talk today.", signer: "Fern", url: URL });
    expect(make("raising")).toEqual(plain);
    expect(make(null)).toEqual(plain);
    expect(plain.subject).toBe("We'd love you to fundraise with us");
    expect(plain.text).toContain("You'll get your very own fundraising page, with a meter that fills as gifts come in, a wall for your supporters' messages and your own QR code for posters.");
  });

  it("tells a team about the team page and a page for everyone who joins", () => {
    const mail = make("team");
    expect(mail.subject).toBe("We'd love you to fundraise with us");
    for (const t of [mail.html, mail.text]) {
      expect(t).toContain("We'd love you to fundraise with us!");
      expect(t).toContain("Hi Mary,");
      expect(t).toContain(CHAT);
      expect(t).toContain(START);
      expect(t).toContain("You'll get a team page with a meter for the whole team, and a page for everyone who joins, with a wall for your supporters' messages and your own QR code for posters.");
      expect(t).not.toContain("your very own fundraising page");
      expect(t).toContain(ASK);
    }
    expect(mail.html).toContain(">Make my page</a>");
    expect(mail.html).toContain(signOffAs("Warmest wishes,", "Fern"));
  });

  // Reworded for someone hosting an event (Jaimie): its own subject, heading, chat line, head start
  // line and button; the rest as the raising money invite.
  it("is about their event, for someone hosting one", () => {
    const mail = make("event");
    expect(mail.subject).toBe("We'd love to help with your event");
    for (const t of [mail.html, mail.text]) {
      expect(t).toContain("Fundraising for NBCC");
      expect(t).toContain("We'd love to help with your event!");
      expect(t).toContain("Hi Mary,");
      expect(t).toContain("It was so lovely to chat with you about your plans for your event. Thank you, it honestly means the world to us.");
      expect(t).toContain("We've given you a head start: press the button below and the form is already started for you. It only takes a few minutes.");
      expect(t).toContain("Your event gets its own page on our website, with a meter, posters and a QR code.");
      expect(t).toContain(ASK);
      expect(t).toContain("It was good to talk today.");
      expect(t).toContain(START);
      for (const not of ["We'd love you to fundraise with us", CHAT, "your very own fundraising page", "Make my page"]) expect(t).not.toContain(not);
    }
    expect(mail.html).toContain(`href="${URL}"`);
    expect(mail.html).toContain(">Set up my event</a>");
    expect(mail.text).toContain(`Set up my event: ${URL}`);
    expect(mail.html).toContain(signOffAs("Warmest wishes,", "Fern"));
    expect(mail.html).toContain("Got any questions?");
  });

  describe("in memory", () => {
    const mail = make("memory");

    it("has its own gentle subject and heading", () => {
      expect(mail.subject).toBe("A page in memory of someone you love");
      expect(mail.html).toContain("A page in their memory");
      expect(mail.text).toContain("A page in their memory");
    });

    // Jaimie: "Dear", not "Hi", for someone setting up a page in memory. The others keep "Hi".
    it("says the gentle words, greeting them Dear and their first name", () => {
      for (const t of [mail.html, mail.text]) {
        expect(t).toContain("Dear Mary,");
        expect(t).not.toContain("Hi Mary,");
        expect(t).toContain(
          "Thank you for talking with us. If you would like to set up a page in memory of someone you love, the button below opens it with your details already filled in. Take your time: we will go through it all with you on the phone before anything goes live.",
        );
        expect(t).toContain("It is a quiet page where family and friends can give in their memory, and we can send collection envelopes for the service if you would like them.");
        expect(t).toContain("If you would rather we filled it in with you, call us on 01292 811 015.");
      }
    });

    it("has the Start the page button, linking to the form with the invite", () => {
      expect(mail.html).toContain(`href="${URL}"`);
      expect(mail.html).toContain(">Start the page</a>");
      expect(mail.text).toContain(`Start the page: ${URL}`);
    });

    // The charity, 2026-10-04: it is signed by Jodie, whoever is chosen under Signed by.
    it("shows the personal note, and is signed With warmest thoughts by Jodie", () => {
      expect(mail.html).toContain(quoteBox("It was good to talk today."));
      expect(mail.text).toContain("It was good to talk today.");
      expect(mail.html).toContain(signOffAs("With warmest thoughts,", "Jodie"));
      expect(mail.text).toContain("With warmest thoughts,\nJodie\nNBCC Team");
    });

    it("has no exclamation mark and none of the cheerful invite's words", () => {
      const visible = mail.html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ");
      for (const t of [mail.text, visible, mail.subject]) {
        expect(t).not.toContain("!");
        expect(t).not.toMatch(/love you to fundraise/i);
        expect(t).not.toContain("Make my page");
        expect(t).not.toContain("Got any questions?");
        expect(t).not.toMatch(/[–—]/);
      }
    });
  });
});
