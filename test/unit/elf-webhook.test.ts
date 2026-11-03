import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

// NBCC Elf Detective School: a payment settling, from Stripe's webhook. Every family is invented.

const { sendElfWelcome, subscribeSelf } = vi.hoisted(() => ({ sendElfWelcome: vi.fn(), subscribeSelf: vi.fn() }));
vi.mock("../../src/clients/email", () => ({ sendElfWelcome, sendElfSignInCode: vi.fn() }));
vi.mock("../../src/newsletter/self-signup", () => ({ subscribeSelf }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "test", PORTAL_BASE_URL: "https://nbcc.scot", BALL_FROM_EMAIL: "events@nbcc.scot" },
}));

import { handleElfEvent } from "../../src/elf/webhook";

/** A pretend database holding one order, as the settle and expire queries see it. */
function fakeClient(order: { status: string; giftAid?: boolean; newsletter?: boolean; familyActive?: boolean }) {
  const state = { ...order, badges: 0 };
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/FROM elf_orders o\s+JOIN elf_families/.test(sql)) {
      return {
        rows: [
          {
            id: 9,
            family_id: 3,
            detective_ids: [100, 101],
            status: state.status,
            gift_aid: state.giftAid ?? false,
            family_active: state.familyActive ?? false,
            email: "sam@example.com",
            grown_up_name: "Sam Example",
            newsletter: state.newsletter ?? false,
          },
        ],
      };
    }
    if (/UPDATE elf_orders SET status = 'paid'/.test(sql)) {
      state.status = "paid";
      return { rows: [] };
    }
    if (/UPDATE elf_orders SET status = 'expired'/.test(sql)) {
      if (state.status === "pending") state.status = "expired";
      return { rows: [] };
    }
    if (/UPDATE elf_detectives/.test(sql)) {
      state.badges += 2;
      return {
        rows: [
          { id: 100, first_name: "Ruby", surname: "Tinselfoot", badge_number: 1 },
          { id: 101, first_name: "Leo", surname: "Frostwhistle", badge_number: 2 },
        ],
      };
    }
    return { rows: [] };
  });
  return { client: { query } as never, state, calls };
}

const completed = (metadata: Record<string, string> = { product: "elf_school", reference: "EDS-K4F9Q2" }, paid = "paid") =>
  ({
    id: "evt_1",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_1", metadata, payment_status: paid, created: 1795000000 } },
  }) as unknown as Stripe.Event;

const expired = () =>
  ({ id: "evt_2", type: "checkout.session.expired", data: { object: { id: "cs_test_1", metadata: { product: "elf_school", reference: "EDS-K4F9Q2" } } } }) as unknown as Stripe.Event;

beforeEach(() => {
  sendElfWelcome.mockReset();
  subscribeSelf.mockReset();
});

describe("settling an Elf Detective School payment", () => {
  it("leaves every other payment alone", async () => {
    const { client, calls } = fakeClient({ status: "pending" });
    expect(await handleElfEvent(client, completed({ product: "event_tickets" }))).toBeNull();
    expect(await handleElfEvent(client, completed({}))).toBeNull();
    expect(await handleElfEvent(client, { id: "e", type: "invoice.paid", data: { object: {} } } as unknown as Stripe.Event)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("marks the order paid, gives the detectives their badges, and sends the welcome after the write", async () => {
    const { client, state, calls } = fakeClient({ status: "pending" });
    const r = await handleElfEvent(client, completed());
    expect(r?.action).toBe("elf-paid");
    expect(state.status).toBe("paid");
    expect(state.badges).toBe(2);
    expect(calls.some((c) => /FOR UPDATE/.test(c.sql))).toBe(true);
    expect(calls.some((c) => /INSERT INTO audit_log/.test(c.sql))).toBe(true);
    expect(sendElfWelcome).not.toHaveBeenCalled();
    await r!.afterCommit!();
    expect(sendElfWelcome).toHaveBeenCalledTimes(1);
    const [, message] = sendElfWelcome.mock.calls[0];
    expect(message.email).toBe("sam@example.com");
    expect(message.from).toBe("events@nbcc.scot");
    expect(message.text).toContain("Detective Ruby Tinselfoot, badge EDS 0001");
  });

  it("does nothing the second time Stripe sends the same payment", async () => {
    const { client, state } = fakeClient({ status: "paid" });
    const r = await handleElfEvent(client, completed());
    expect(r?.action).toBe("elf-already-paid");
    expect(r?.afterCommit).toBeFalsy();
    expect(state.badges).toBe(0);
  });

  it("waits for a payment Stripe has not taken yet", async () => {
    const { client, state } = fakeClient({ status: "pending" });
    const r = await handleElfEvent(client, completed(undefined, "unpaid"));
    expect(r?.action).toBe("elf-not-paid");
    expect(state.status).toBe("pending");
  });

  it("never turns a paid order expired", async () => {
    const { client, state } = fakeClient({ status: "paid" });
    expect((await handleElfEvent(client, expired()))?.action).toBe("elf-expired");
    expect(state.status).toBe("paid");
  });

  it("marks the payment as having opened the account only when the family had none before", async () => {
    const fresh = fakeClient({ status: "pending", familyActive: false });
    await handleElfEvent(fresh.client, completed());
    const paid = fresh.calls.find((c) => /UPDATE elf_orders SET status = 'paid'/.test(c.sql))!;
    expect(paid.params).toContain(true);
    const again = fakeClient({ status: "pending", familyActive: true });
    await handleElfEvent(again.client, completed());
    const paid2 = again.calls.find((c) => /UPDATE elf_orders SET status = 'paid'/.test(c.sql))!;
    expect(paid2.params).toContain(false);
  });

  it("keeps the Gift Aid wording with a gift that has Gift Aid", async () => {
    const { client, calls } = fakeClient({ status: "pending", giftAid: true });
    await handleElfEvent(client, completed());
    const paid = calls.find((c) => /UPDATE elf_orders SET status = 'paid'/.test(c.sql))!;
    expect(JSON.stringify(paid.params)).toContain("hmrc-single-2024-01");
  });

  it("joins the newsletter only when the box was ticked, and without a second welcome", async () => {
    const yes = fakeClient({ status: "pending", newsletter: true });
    await (await handleElfEvent(yes.client, completed()))!.afterCommit!();
    expect(subscribeSelf).toHaveBeenCalledWith({ name: "Sam Example", email: "sam@example.com", phone: null }, "elf");
    subscribeSelf.mockReset();
    const no = fakeClient({ status: "pending", newsletter: false });
    await (await handleElfEvent(no.client, completed()))!.afterCommit!();
    expect(subscribeSelf).not.toHaveBeenCalled();
  });
});

describe("the review's findings", () => {
  it("never joins the newsletter again from a later payment, so someone who left the list stays off it", async () => {
    const later = fakeClient({ status: "pending", newsletter: true, familyActive: true });
    await (await handleElfEvent(later.client, completed()))!.afterCommit!();
    expect(subscribeSelf).not.toHaveBeenCalled();
  });
});
